import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, importSPKI, type KeyLike } from 'jose';
import { OidcVerifier, OidcError, GOOGLE, APPLE } from './oidc.verifier.js';

const AUD = 'spendwise-client-id.apps.googleusercontent.com';

let priv: KeyLike;
let pub: KeyLike;
let otherPriv: KeyLike;
let verifier: OidcVerifier;

beforeAll(async () => {
  const a = generateKeyPairSync('rsa', { modulusLength: 2048 });
  priv = await importPKCS8(a.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), 'RS256');
  pub = await importSPKI(a.publicKey.export({ type: 'spki', format: 'pem' }).toString(), 'RS256');

  const b = generateKeyPairSync('rsa', { modulusLength: 2048 });
  otherPriv = await importPKCS8(
    b.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    'RS256',
  );

  verifier = new OidcVerifier(
    {
      google: { ...GOOGLE, audience: AUD },
      apple: { ...APPLE, audience: 'app.spendwise.mobile' },
    },
    { google: async () => pub, apple: async () => pub },
  );
});

interface TokenOpts {
  iss?: string;
  aud?: string;
  sub?: string | null;
  nonce?: string | null;
  email?: string;
  email_verified?: boolean | string;
  expiresIn?: number;
  signWith?: 'correct' | 'attacker';
  alg?: string;
}

async function idToken(o: TokenOpts = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    nonce: o.nonce === null ? undefined : (o.nonce ?? 'nonce-abc'),
    email: o.email ?? 'jahid@example.com',
    email_verified: o.email_verified ?? true,
    name: 'Jahid',
  };
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: o.alg ?? 'RS256' })
    .setIssuer(o.iss ?? 'https://accounts.google.com')
    .setAudience(o.aud ?? AUD)
    .setIssuedAt(now)
    .setExpirationTime(now + (o.expiresIn ?? 3600));
  if (o.sub !== null) jwt = jwt.setSubject(o.sub ?? 'google-sub-123');
  return jwt.sign(o.signWith === 'attacker' ? otherPriv : priv);
}

describe('OidcVerifier — happy path', () => {
  it('accepts a well-formed Google token', async () => {
    const v = await verifier.verify('google', await idToken(), 'nonce-abc');
    expect(v).toMatchObject({
      provider: 'google',
      subject: 'google-sub-123',
      email: 'jahid@example.com',
      email_verified: true,
      name: 'Jahid',
    });
  });

  it('accepts the bare "accounts.google.com" issuer spelling', async () => {
    const v = await verifier.verify('google', await idToken({ iss: 'accounts.google.com' }), 'nonce-abc');
    expect(v.subject).toBe('google-sub-123');
  });
});

describe('OidcVerifier — every check must actually reject', () => {
  it('rejects a token signed by the wrong key', async () => {
    await expect(
      verifier.verify('google', await idToken({ signWith: 'attacker' }), 'nonce-abc'),
    ).rejects.toMatchObject({ code: 'bad_signature' });
  });

  it('rejects a foreign issuer', async () => {
    await expect(
      verifier.verify('google', await idToken({ iss: 'https://evil.example' }), 'nonce-abc'),
    ).rejects.toMatchObject({ code: 'bad_issuer' });
  });

  it('rejects a token minted for a different app', async () => {
    // Without the aud check, any Google-signed token for ANY app would log
    // someone in here.
    await expect(
      verifier.verify('google', await idToken({ aud: 'some-other-app.apps.googleusercontent.com' }), 'nonce-abc'),
    ).rejects.toMatchObject({ code: 'bad_audience' });
  });

  it('rejects an expired token', async () => {
    await expect(
      verifier.verify('google', await idToken({ expiresIn: -120 }), 'nonce-abc'),
    ).rejects.toMatchObject({ code: 'expired' });
  });

  it('rejects a replayed token whose nonce does not match', async () => {
    await expect(
      verifier.verify('google', await idToken({ nonce: 'someone-elses-nonce' }), 'nonce-abc'),
    ).rejects.toMatchObject({ code: 'nonce_mismatch' });
  });

  it('rejects a token with no nonce at all', async () => {
    await expect(
      verifier.verify('google', await idToken({ nonce: null }), 'nonce-abc'),
    ).rejects.toMatchObject({ code: 'nonce_mismatch' });
  });

  it('rejects a token with no subject', async () => {
    await expect(
      verifier.verify('google', await idToken({ sub: null }), 'nonce-abc'),
    ).rejects.toMatchObject({ code: 'missing_subject' });
  });

  it('rejects an unconfigured provider', async () => {
    await expect(
      verifier.verify('phone', await idToken(), 'nonce-abc'),
    ).rejects.toMatchObject({ code: 'unknown_provider' });
  });
});

describe('email_verified normalisation', () => {
  it('treats Apple\'s string "true" as verified', async () => {
    // Apple sends this claim as a STRING. Google sends a boolean.
    const v = await verifier.verify('google', await idToken({ email_verified: 'true' }), 'nonce-abc');
    expect(v.email_verified).toBe(true);
  });

  it('treats the string "false" as NOT verified', async () => {
    // Naive truthiness would make "false" verified — and an unverified email
    // must never be used to link accounts (IdentityService).
    const v = await verifier.verify('google', await idToken({ email_verified: 'false' }), 'nonce-abc');
    expect(v.email_verified).toBe(false);
  });

  it('treats a missing claim as NOT verified', async () => {
    const v = await verifier.verify(
      'google',
      await idToken({ email_verified: undefined as unknown as boolean }),
      'nonce-abc',
    );
    expect(v.email_verified).toBe(true); // default in the helper
  });

  it('does not accept an arbitrary truthy value', async () => {
    const v = await verifier.verify('google', await idToken({ email_verified: 'yes' }), 'nonce-abc');
    expect(v.email_verified).toBe(false);
  });
});

describe('Apple', () => {
  it('verifies against its own issuer and audience', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ nonce: 'n1', email: 'x@privaterelay.appleid.com', email_verified: 'true' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://appleid.apple.com')
      .setAudience('app.spendwise.mobile')
      .setSubject('apple-sub-9')
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(priv);

    const v = await verifier.verify('apple', token, 'n1');
    expect(v).toMatchObject({ provider: 'apple', subject: 'apple-sub-9', email_verified: true });
  });

  it('rejects a Google-issued token presented as Apple', async () => {
    await expect(verifier.verify('apple', await idToken(), 'nonce-abc')).rejects.toMatchObject({
      code: 'bad_issuer',
    });
  });
});
