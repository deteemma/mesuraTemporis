import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { accessDenied } from '../errors.js';
import { UsersService } from '../users/users.service.js';
import { ADMIN_REQUIRED, IS_PUBLIC, PENDING_ALLOWED } from './authenticated-user.js';
import { OidcVerifier } from './oidc-verifier.service.js';

/**
 * Guard global : toute route exige un jeton valide, sauf celles marquées
 * @Public(). Une personne dont la Demande d'accès est en attente n'atteint que
 * les routes marquées @AllowPending() (ADR-0028). Les routes marquées
 * @RequireAdmin() exigent l'Administrateur.
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
    const admission = await this.users.admit(request.user, token);
    request.admission = admission;
    if (admission.status !== 'admitted' && !this.reflector.getAllAndOverride<boolean>(PENDING_ALLOWED, targets)) {
      throw accessDenied();
    }

    if (this.reflector.getAllAndOverride<boolean>(ADMIN_REQUIRED, targets) && !request.user.isAdmin) {
      throw accessDenied();
    }
    return true;
  }
}
