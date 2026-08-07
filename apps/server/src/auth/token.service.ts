import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, importPKCS8, importSPKI, type KeyLike } from 'jose';
import type { SessionStore } from './session.store.js';

/**
 * Access and refresh tokens (ARCHITECTURE §9.1).
 *
 * Access token  — JWT, RS256, 15 minutes. Stateless, so it cannot be revoked
 *                 mid-life; the short expiry IS the revocation window.
 * Refresh token — opaque 256-bit random, 30 days, stored only as a SHA-256
 *                 hash. Deliberately NOT a JWT: it must be revocable, and only
 *                 a database lookup gives that.
 *
 * The security property that matters most here is reuse detection. See
 * `rotate()`.
 */

export class TokenError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_refresh'
      | 'expired_refresh'
      | 'reuse_detected'
      | 'invalid_access',
  ) {
    super(message);
    this.name = 'TokenError';
  }
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  family_id: string;
}

export interface AccessClaims {
  sub: string;
  jti: string;
  sid: string;
  roles: string[];
}

export interface TokenServiceOptions {
  accessTtlSeconds?: number;
  refreshTtlDays?: number;
  issuer?: string;
  audience?: string;
  now?: () => Date;
}

/** SHA-256 is right here: the token is already 256 bits of entropy, so a slow
 *  hash buys nothing. This is not password hashing. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export class TokenService {
  private readonly accessTtl: number;
  private readonly refreshDays: number;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly now: () => Date;

  private privateKey?: KeyLike;
  private publicKey?: KeyLike;

  constructor(
    private readonly store: SessionStore,
    private readonly privatePem: string,
    private readonly publicPem: string,
    opts: TokenServiceOptions = {},
  ) {
    this.accessTtl = opts.accessTtlSeconds ?? 15 * 60;
    this.refreshDays = opts.refreshTtlDays ?? 30;
    this.issuer = opts.issuer ?? 'https://api.spendwise.app';
    this.audience = opts.audience ?? 'spendwise';
    this.now = opts.now ?? (() => new Date());
  }

  private async keys(): Promise<{ priv: KeyLike; pub: KeyLike }> {
    this.privateKey ??= await importPKCS8(this.privatePem, 'RS256');
    this.publicKey ??= await importSPKI(this.publicPem, 'RS256');
    return { priv: this.privateKey, pub: this.publicKey };
  }

  private newRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private async signAccess(userId: string, sessionId: string, roles: string[]): Promise<string> {
    const { priv } = await this.keys();
    const iat = Math.floor(this.now().getTime() / 1000);
    return new SignJWT({ sid: sessionId, roles })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setSubject(userId)
      .setJti(randomUUID())
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt(iat)
      .setExpirationTime(iat + this.accessTtl)
      .sign(priv);
  }

  /** First tokens after a successful sign-in. Starts a new rotation family. */
  async issue(userId: string, deviceId: string | null, roles: string[] = ['user']): Promise<TokenPair> {
    const familyId = randomUUID();
    return this.mint(userId, deviceId, familyId, roles);
  }

  private async mint(
    userId: string,
    deviceId: string | null,
    familyId: string,
    roles: string[],
  ): Promise<TokenPair> {
    const refresh = this.newRefreshToken();
    const expires = new Date(this.now().getTime() + this.refreshDays * 86_400_000);

    const session = await this.store.create({
      user_id: userId,
      refresh_hash: hashRefreshToken(refresh),
      family_id: familyId,
      device_id: deviceId,
      expires_at: expires,
    });

    return {
      access_token: await this.signAccess(userId, session.id, roles),
      refresh_token: refresh,
      expires_in: this.accessTtl,
      family_id: familyId,
    };
  }

  /**
   * Exchange a refresh token for a new pair.
   *
   * Reuse detection is the point. A refresh token is single-use: rotating it
   * revokes it immediately. If an ALREADY-REVOKED token is later presented,
   * that means two parties hold the same token — the legitimate client and
   * whoever stole it. We cannot tell which one is asking, so we revoke the
   * entire family and force a fresh sign-in. This turns a silent, indefinite
   * account compromise into one failed request and a security email.
   */
  async rotate(presented: string, roles: string[] = ['user']): Promise<TokenPair> {
    const hash = hashRefreshToken(presented);
    const session = await this.store.findByHash(hash);

    if (!session) {
      throw new TokenError('Refresh token not recognised', 'invalid_refresh');
    }

    if (session.revoked_at !== null) {
      const revoked = await this.store.revokeFamily(session.family_id, this.now());
      throw new TokenError(
        `Refresh token reuse detected; revoked ${revoked} session(s) in family ${session.family_id}`,
        'reuse_detected',
      );
    }

    if (session.expires_at.getTime() <= this.now().getTime()) {
      // Retire it so a later replay is treated as expired, not as reuse.
      await this.store.revokeIfActive(session.id, this.now());
      throw new TokenError('Refresh token expired', 'expired_refresh');
    }

    // Compare-and-set. Two concurrent refreshes both reach here; only one wins,
    // and the loser must not be handed a valid pair.
    const won = await this.store.revokeIfActive(session.id, this.now());
    if (!won) {
      await this.store.revokeFamily(session.family_id, this.now());
      throw new TokenError('Concurrent refresh of the same token', 'reuse_detected');
    }

    return this.mint(session.user_id, session.device_id, session.family_id, roles);
  }

  /** Explicit sign-out: kill the whole lineage, not just the current token. */
  async revokeFamily(familyId: string): Promise<number> {
    return this.store.revokeFamily(familyId, this.now());
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    const { pub } = await this.keys();
    try {
      const { payload } = await jwtVerify(token, pub, {
        issuer: this.issuer,
        audience: this.audience,
        // Pinning the algorithm is what prevents "alg: none" and the RS256->HS256
        // confusion attack, where a token is re-signed with the public key.
        algorithms: ['RS256'],
        currentDate: this.now(),
      });
      return {
        sub: String(payload.sub),
        jti: String(payload.jti),
        sid: String(payload['sid']),
        roles: Array.isArray(payload['roles']) ? (payload['roles'] as string[]) : [],
      };
    } catch (err) {
      throw new TokenError(`Access token rejected: ${(err as Error).message}`, 'invalid_access');
    }
  }
}
