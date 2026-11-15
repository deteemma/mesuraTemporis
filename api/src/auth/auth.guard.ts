import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { accessDenied } from '../errors.js';
import { UsersService } from '../users/users.service.js';
import { ADMIN_REQUIRED, IS_PUBLIC } from './authenticated-user.js';
import { OidcVerifier } from './oidc-verifier.service.js';

/**
 * Guard global : toute route exige un jeton valide, sauf celles marquées
 * @Public(). Les routes marquées @RequireAdmin() exigent l'Administrateur.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: OidcVerifier,
    private readonly users: UsersService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    try {
      request.user = await this.verifier.verify(token);
    } catch {
      throw new UnauthorizedException();
    }
    await this.users.remember(request.user, token);

    if (this.reflector.getAllAndOverride<boolean>(ADMIN_REQUIRED, targets) && !request.user.isAdmin) {
      throw accessDenied();
    }
    return true;
  }
}
