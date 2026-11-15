import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, type ProjectAction } from '@app/shared';
import type { FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { DatabaseService } from '../db/database.service.js';
import { accessDenied, projectNotFound } from '../errors.js';

const PROJECT_ACTION = 'projectAction';
const uuid = z.uuid();

/**
 * Exige l'accès au Projet `:projectId` pour l'action donnée (règles dans
 * @app/shared). Un non-affecté reçoit 404 `PROJET_INTROUVABLE` : l'existence
 * du Projet ne lui est pas révélée ; un non-Administrateur qui tente une
 * action d'administration reçoit 403 `ACCES_REFUSE`. Première barrière ; la RLS
 * PostgreSQL est la seconde (ADR-0006, ADR-0017).
 */
export const RequireProjectAccess = (action: ProjectAction) =>
  applyDecorators(SetMetadata(PROJECT_ACTION, action), UseGuards(ProjectAccessGuard));

@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const action = this.reflector.get<ProjectAction>(PROJECT_ACTION, ctx.getHandler());
    const request = ctx.switchToHttp().getRequest<FastifyRequest<{ Params: { projectId?: string } }>>();
    const projectId = request.params.projectId;
    const user = request.user;
    if (!user) throw accessDenied();
    // Une opération d'administration refuse le non-Administrateur (403) avant
    // toute question d'affectation (contrat d'API, #11).
    if (!can({ isAdmin: user.isAdmin, isAssigned: true }, action)) throw accessDenied();
    if (!uuid.safeParse(projectId).success) throw projectNotFound();

    const isAssigned = await this.database.asUser(user, async (tx) => {
      const { rows } = await sql<{ assigned: boolean }>`
        SELECT is_project_member(${projectId}::uuid) AS assigned`.execute(tx);
      return rows[0]?.assigned ?? false;
    });

    // Sans accès au Projet, son existence n'est pas révélée.
    if (!can({ isAdmin: user.isAdmin, isAssigned }, action)) throw projectNotFound();
    return true;
  }
}
