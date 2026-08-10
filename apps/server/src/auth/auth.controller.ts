import { Body, Controller, Delete, Get, Post, Req, Res, UnauthorizedException, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { setRefreshCookie, clearRefreshCookie, readRefreshToken } from './refresh-cookie.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { Public } from '../common/public.decorator.js';
import type { AuthedRequest } from './auth.guard.js';
import { IdentityService, type Provider } from './identity.service.js';
import { OidcVerifier, OidcError } from './oidc.verifier.js';
import { OtpService, OtpError } from './otp.service.js';
import { TokenService, TokenError } from './token.service.js';
import { Db } from '../db/db.js';
import { AuditService } from '../audit/audit.service.js';

const oidcCallbackSchema = z.object({
  provider: z.enum(['google', 'apple']),
  id_token: z.string().min(1),
  nonce: z.string().min(1),
  device_id: z.string().min(1).max(128).optional(),
});

const otpSendSchema = z.object({
  phone_e164: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Must be E.164'),
});

const otpVerifySchema = z.object({
  challenge_id: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
  device_id: z.string().min(1).max(128).optional(),
});

// Optional: browsers send the token in an HttpOnly cookie instead, and must
// not be able to read it in order to echo it back.
const refreshSchema = z.object({ refresh_token: z.string().min(1).optional() });

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly identities: IdentityService,
    private readonly oidc: OidcVerifier,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private get cookieOpts(): { secure: boolean; maxAgeDays: number } {
    // Matches the refresh token's own lifetime; a cookie that expires first
    // would sign people out while the server still considered them valid.
    return { secure: process.env['NODE_ENV'] === 'production', maxAgeDays: 180 };
  }

  /**
   * Issue the pair.
   *
   * Browsers get the refresh token ONLY as an HttpOnly cookie. Returning it in
   * the body as well would hand the long-lived credential straight back to
   * JavaScript and undo the entire reason for HttpOnly — injected script could
   * simply read the sign-in response.
   *
   * Native clients have Keychain/Keystore and no cookie jar, so they declare
   * themselves with `X-Client-Platform: native` and receive it in the body.
   * Defaulting to the SAFE case means a client that forgets the header gets
   * the stricter treatment, not the weaker one.
   */
  private respondWithTokens(
    req: AuthedRequest,
    res: Response,
    pair: { access_token: string; refresh_token: string; expires_in: number; family_id: string },
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    setRefreshCookie(res, pair.refresh_token, this.cookieOpts);
    const isNative = String(req.headers['x-client-platform'] ?? '').toLowerCase() === 'native';
    return {
      access_token: pair.access_token,
      ...(isNative ? { refresh_token: pair.refresh_token } : {}),
      expires_in: pair.expires_in,
      ...extra,
    };
  }

  /** Exchange a provider ID token for SpendWise tokens. */
  @Public()
  @Post('oidc/callback')
  async oidcCallback(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(oidcCallbackSchema)) body: unknown,
  ) {
    const b = body as z.infer<typeof oidcCallbackSchema>;
    try {
      const claims = await this.oidc.verify(b.provider as Provider, b.id_token, b.nonce);
      const user = await this.identities.resolve({
        provider: claims.provider,
        subject: claims.subject,
        email: claims.email,
        email_verified: claims.email_verified,
        display_name: claims.name,
      });
      const pair = await this.tokens.issue(user.user_id, b.device_id ?? null);
      return this.respondWithTokens(req, res, pair, { new_account: user.created });
    } catch (err) {
      if (err instanceof OidcError) {
        // One generic message: telling the caller WHICH check failed helps an
        // attacker tune their forgery. The code is logged, not returned.
        throw new UnauthorizedException('Sign-in failed');
      }
      throw err;
    }
  }

  @Public()
  @Post('otp/send')
  async otpSend(@Req() req: AuthedRequest, @Body(new ZodValidationPipe(otpSendSchema)) body: unknown) {
    const { phone_e164 } = body as z.infer<typeof otpSendSchema>;
    const ip = req.ip ?? '0.0.0.0';
    try {
      const { id } = await this.otp.send(phone_e164, ip);
      // The code is never returned; it goes out by SMS. Returning it would make
      // the endpoint an oracle.
      return { challenge_id: id, expires_in: 300 };
    } catch (err) {
      if (err instanceof OtpError) throw new BadRequestException({ code: err.code });
      throw err;
    }
  }

  @Public()
  @Post('otp/verify')
  async otpVerify(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(otpVerifySchema)) body: unknown,
  ) {
    const b = body as z.infer<typeof otpVerifySchema>;
    try {
      const { target } = await this.otp.verify(b.challenge_id, b.code);
      const user = await this.identities.resolve({
        provider: 'phone',
        subject: target,
        phone_e164: target,
        email_verified: false,
      });
      const pair = await this.tokens.issue(user.user_id, b.device_id ?? null);
      return this.respondWithTokens(req, res, pair, { new_account: user.created });
    } catch (err) {
      if (err instanceof OtpError) throw new UnauthorizedException({ code: err.code });
      throw err;
    }
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(refreshSchema)) body: unknown,
  ) {
    const { refresh_token } = body as z.infer<typeof refreshSchema>;
    const presented = readRefreshToken(req, refresh_token);
    if (!presented) throw new UnauthorizedException({ code: 'invalid_refresh' });
    try {
      const pair = await this.tokens.rotate(presented);
      return this.respondWithTokens(req, res, pair);
    } catch (err) {
      if (err instanceof TokenError) {
        // The old cookie is now useless, and on reuse detection the whole
        // family is dead. Clearing it stops the browser retrying forever with
        // a credential that will never work again.
        clearRefreshCookie(res, this.cookieOpts);
        throw new UnauthorizedException({ code: err.code });
      }
      throw err;
    }
  }

  @Post('logout')
  async logout(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(refreshSchema)) body: unknown,
  ) {
    const { refresh_token } = body as z.infer<typeof refreshSchema>;
    const presented = readRefreshToken(req, refresh_token);
    if (presented) {
      // Kill the whole lineage, not just this token: signing out on one device
      // should not leave a rotation chain alive that an attacker already holds.
      const session = await this.tokens.sessionFor(presented);
      if (session) await this.tokens.revokeFamily(session.family_id, session.user_id);
    }
    clearRefreshCookie(res, this.cookieOpts);
    return { ok: true };
  }

  /** The linked providers for the signed-in user (§9.1 asks for two). */
  @Get('identities')
  async list(@Req() req: AuthedRequest) {
    const rows = await this.identities.listForUser(req.user!.id);
    return { identities: rows, needs_backup: rows.length < 2 };
  }
  /**
   * Erase the account.
   *
   * The id comes from the verified access token, never the body — a user_id in
   * the payload would let anyone delete anyone. Cascades remove every row the
   * account owns; audit entries are kept but stripped of user_id and actor_ip,
   * so the security trail survives without the personal data in it.
   *
   * Irreversible, and there is no soft-delete: "delete my data" that leaves the
   * data in place is not deletion. Signing in with the same Google account
   * afterwards resolves to nobody and creates a fresh user.
   */
  @Delete('account')
  async deleteAccount(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const userId = req.user!.id;

    // Recorded BEFORE the delete: afterwards there is no account to attribute
    // it to, and this is the one event most worth keeping.
    await this.audit.record({
      user_id: userId,
      action: 'account.delete',
      entity: 'user',
      entity_id: userId,
      meta: {},
    });

    await this.db.withUser(userId, async (c) => {
      await c.query('SELECT app_delete_account($1)', [userId]);
    });

    // The refresh cookie would otherwise outlive the account it points at.
    clearRefreshCookie(res, this.cookieOpts);
    return { ok: true };
  }

}
