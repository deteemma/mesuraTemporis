import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AdmissionDto } from '@app/shared';

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
    /** Admission de la personne du jeton, calculée par le guard global (ADR-0028). */
    admission?: AdmissionDto;
  }
}

export const IS_PUBLIC = 'isPublic';
/** Route accessible sans jeton. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PENDING_ALLOWED = 'pendingAllowed';
/**
 * Route ouverte à la personne dont la Demande d'accès est en attente
 * (ADR-0028). Toute autre route lui répond 403 `ACCES_REFUSE`.
 */
export const AllowPending = () => SetMetadata(PENDING_ALLOWED, true);

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

export const CurrentAdmission = createParamDecorator((_data: unknown, ctx: ExecutionContext): AdmissionDto => {
  const admission = ctx.switchToHttp().getRequest<FastifyRequest>().admission;
  if (!admission) throw new Error('CurrentAdmission utilisé sur une route publique');
  return admission;
});
