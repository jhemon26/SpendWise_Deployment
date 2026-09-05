import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Logout has to work when the access token has expired.
 *
 * It is the one endpoint a stuck user reaches for, and it authenticates with
 * the refresh cookie, not the access token. Requiring the token meant that
 * fifteen minutes after signing in the request 401'd, the cookie survived, and
 * the reload signed the user straight back in with no way out.
 */
describe('POST /v1/auth/logout', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/auth/auth.controller.ts'), 'utf8');

  it('is public', () => {
    const at = src.indexOf("@Post('logout')");
    expect(at).toBeGreaterThan(-1);
    // The decorator must sit immediately above, not merely somewhere in the file.
    const before = src.slice(0, at);
    expect(before.trimEnd().endsWith('@Public()')).toBe(true);
  });

  it('does not read req.user, which a public route has none of', () => {
    const body = src.slice(src.indexOf("@Post('logout')"));
    const handler = body.slice(0, body.indexOf('\n  }'));
    expect(handler).not.toMatch(/req\.user/);
  });
});
