import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokenService } from './token.service.js';
import { IS_PUBLIC_KEY } from '../common/public.decorator.js';

export interface AuthedRequest extends Request {
  user?: { id: string; roles: string[]; sessionId: string };
}

/**
 * Bearer access-token guard.
 *
 * Applied globally, so routes are authenticated by default and must opt out
 * explicitly (ARCHITECTURE §9.2, deny-by-default). A route that someone forgets
 * to annotate is closed, not open — the failure mode points the safe way.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const claims = await this.tokens.verifyAccess(header.slice(7));
      req.user = { id: claims.sub, roles: claims.roles, sessionId: claims.sid };
      return true;
    } catch {
      // Deliberately vague: distinguishing "expired" from "forged" tells an
      // attacker which half of their guess was right.
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
