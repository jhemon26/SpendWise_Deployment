import { jwtVerify, createRemoteJWKSet, errors as joseErrors, type JWTVerifyGetKey } from 'jose';
import type { Provider } from './identity.service.js';

/**
 * OIDC ID-token verification for Google and Apple (ARCHITECTURE §9.1).
 *
 * An ID token is only a credential if every one of these is checked. Skipping
 * any single one turns "signed by Google" into "signed by anyone Google trusts,
 * for any app, at any time" — which is not authentication.
 */

export class OidcError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unknown_provider'
      | 'bad_signature'
      | 'bad_issuer'
      | 'bad_audience'
      | 'expired'
      | 'nonce_mismatch'
      | 'email_unverified'
      | 'missing_subject',
  ) {
    super(message);
    this.name = 'OidcError';
  }
}

export interface ProviderConfig {
  /** Accepted `iss` values. Google historically emits two spellings. */
  issuers: string[];
  /** Our OAuth client id — the `aud` the token must carry. */
  audience: string;
  jwksUri: string;
}

export const GOOGLE: Omit<ProviderConfig, 'audience'> = {
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
};

export const APPLE: Omit<ProviderConfig, 'audience'> = {
  issuers: ['https://appleid.apple.com'],
  jwksUri: 'https://appleid.apple.com/auth/keys',
};

export interface VerifiedIdToken {
  provider: Provider;
  subject: string;
  email: string | null;
  email_verified: boolean;
  name: string | null;
}

type KeyResolver = JWTVerifyGetKey;

export class OidcVerifier {
  private readonly keys = new Map<string, KeyResolver>();

  /**
   * `keyResolvers` lets tests inject a local JWKS. In production the remote
   * sets are created once and cached by jose, which also handles key rotation —
   * fetching per request would add a round trip to every sign-in and hand an
   * attacker a trivial amplification vector.
   */
  constructor(
    private readonly configs: Partial<Record<Provider, ProviderConfig>>,
    keyResolvers?: Partial<Record<Provider, KeyResolver>>,
  ) {
    for (const [p, cfg] of Object.entries(configs) as [Provider, ProviderConfig][]) {
      const injected = keyResolvers?.[p];
      this.keys.set(p, injected ?? createRemoteJWKSet(new URL(cfg.jwksUri)));
    }
  }

  /**
   * @param expectedNonce the nonce this client sent on the authorize request.
   *        Required: without it a token captured from another session of the
   *        same app replays cleanly.
   */
  async verify(
    provider: Provider,
    idToken: string,
    expectedNonce: string,
  ): Promise<VerifiedIdToken> {
    const cfg = this.configs[provider];
    const keys = this.keys.get(provider);
    if (!cfg || !keys) {
      throw new OidcError(`No configuration for provider ${provider}`, 'unknown_provider');
    }

    let payload: Record<string, unknown>;
    try {
      const res = await jwtVerify(idToken, keys, {
        issuer: cfg.issuers,
        audience: cfg.audience,
        // Providers sign ID tokens with RS256 (Apple also ES256). Pinning stops
        // an attacker downgrading to a symmetric alg or to "none".
        algorithms: ['RS256', 'ES256'],
        clockTolerance: 60,
      });
      payload = res.payload as Record<string, unknown>;
    } catch (err) {
      // Map jose's TYPED errors, not its message text. The first version of
      // this regexed for "issuer" while jose actually says
      // `unexpected "iss" claim value`, so every rejection was reported as a
      // bad signature — the token was still refused, but the reason was wrong,
      // which would have made these failures unloggable and undebuggable.
      const m = (err as Error).message;
      if (err instanceof joseErrors.JWTExpired) throw new OidcError(m, 'expired');
      if (err instanceof joseErrors.JWTClaimValidationFailed) {
        if (err.claim === 'iss') throw new OidcError(m, 'bad_issuer');
        if (err.claim === 'aud') throw new OidcError(m, 'bad_audience');
      }
      throw new OidcError(m, 'bad_signature');
    }

    // Replay protection. jose does not check `nonce` for us.
    const nonce = typeof payload['nonce'] === 'string' ? payload['nonce'] : null;
    if (!nonce || nonce !== expectedNonce) {
      throw new OidcError('Nonce does not match the authorize request', 'nonce_mismatch');
    }

    const sub = typeof payload['sub'] === 'string' ? payload['sub'] : null;
    if (!sub) throw new OidcError('ID token has no subject', 'missing_subject');

    const email = typeof payload['email'] === 'string' ? payload['email'] : null;
    // Apple sends this as the STRING "true"; Google sends a boolean. Treating
    // the string as truthy without checking would accept "false" as verified.
    const rawVerified = payload['email_verified'];
    const email_verified = rawVerified === true || rawVerified === 'true';

    return {
      provider,
      subject: sub,
      email,
      email_verified,
      name: typeof payload['name'] === 'string' ? payload['name'] : null,
    };
  }
}
