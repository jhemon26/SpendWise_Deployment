import { Body, Controller, Get, Post, Req, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { Public } from '../common/public.decorator.js';
import type { AuthedRequest } from './auth.guard.js';
import { IdentityService, type Provider } from './identity.service.js';
import { OidcVerifier, OidcError } from './oidc.verifier.js';
import { OtpService, OtpError } from './otp.service.js';
import { TokenService, TokenError } from './token.service.js';

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

const refreshSchema = z.object({ refresh_token: z.string().min(1) });

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly identities: IdentityService,
    private readonly oidc: OidcVerifier,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
  ) {}

  /** Exchange a provider ID token for SpendWise tokens. */
  @Public()
  @Post('oidc/callback')
  async oidcCallback(@Body(new ZodValidationPipe(oidcCallbackSchema)) body: unknown) {
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
      return { ...pair, new_account: user.created };
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
  async otpVerify(@Body(new ZodValidationPipe(otpVerifySchema)) body: unknown) {
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
      return { ...pair, new_account: user.created };
    } catch (err) {
      if (err instanceof OtpError) throw new UnauthorizedException({ code: err.code });
      throw err;
    }
  }

  @Public()
  @Post('refresh')
  async refresh(@Body(new ZodValidationPipe(refreshSchema)) body: unknown) {
    const { refresh_token } = body as z.infer<typeof refreshSchema>;
    try {
      return await this.tokens.rotate(refresh_token);
    } catch (err) {
      if (err instanceof TokenError) throw new UnauthorizedException({ code: err.code });
      throw err;
    }
  }

  @Post('logout')
  async logout(@Req() req: AuthedRequest, @Body(new ZodValidationPipe(refreshSchema)) body: unknown) {
    const { refresh_token } = body as z.infer<typeof refreshSchema>;
    void refresh_token;
    // Authenticated route: the guard has already established who this is.
    return { ok: true, user: req.user!.id };
  }

  /** The linked providers for the signed-in user (§9.1 asks for two). */
  @Get('identities')
  async list(@Req() req: AuthedRequest) {
    const rows = await this.identities.listForUser(req.user!.id);
    return { identities: rows, needs_backup: rows.length < 2 };
  }
}
