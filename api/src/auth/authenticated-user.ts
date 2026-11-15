import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/** Utilisateur extrait d'un jeton OIDC vérifié. */
export interface AuthenticatedUser {
  id: string;
  login: string;
  email: string | null;
  displayName: string | null;
  /** Rôle Keycloak « administrateur » (ADR-0017). */
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

export const IS_PUBLIC = 'isPublic';
/** Route accessible sans jeton. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ADMIN_REQUIRED = 'adminRequired';
/** Route d'administration : 403 `ACCES_REFUSE` pour un non-Administrateur. */
export const RequireAdmin = () => SetMetadata(ADMIN_REQUIRED, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const user = ctx.switchToHttp().getRequest<FastifyRequest>().user;
    if (!user) throw new Error('CurrentUser utilisé sur une route publique');
    return user;
  },
);
