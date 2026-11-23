import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, type ErrorCode, type ProjectAction } from '@app/shared';
import type { FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { DatabaseService } from '../db/database.service.js';
import { accessDenied, projectNotFound } from '../errors.js';
import { assertUuid } from '../identifiers.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';

const PROJECT_ACTION = 'projectAction';
const BODY_CHECK = 'projectAccessBodyCheck';

/** Validation du corps à faire avant le contrôle d'accès (le guard passe avant les pipes). */
export interface BodyCheck {
  schema: z.ZodType;
  fallback: ErrorCode;
}

/**
 * Exige l'accès au Projet `:projectId` (ou, à défaut, `projectId` du corps de
 * la requête, comme au démarrage du Chronomètre) pour l'action donnée (règles dans
 * @app/shared). Un non-affecté reçoit 404 `PROJET_INTROUVABLE` : l'existence
 * du Projet ne lui est pas révélée ; un non-Administrateur qui tente une
 * action d'administration reçoit 403 `ACCES_REFUSE`. Première barrière ; la RLS
 * PostgreSQL est la seconde (ADR-0006, ADR-0017).
 *
 * `validateBodyFirst` : le corps est d'abord validé, pour qu'une saisie
 * incomplète reçoive son refus 400 avant toute question d'accès (Saisie
 * manuelle, contrat d'API #11).
 */
export const RequireProjectAccess = (action: ProjectAction, validateBodyFirst?: BodyCheck) =>
  applyDecorators(
    SetMetadata(PROJECT_ACTION, action),
    SetMetadata(BODY_CHECK, validateBodyFirst),
    UseGuards(ProjectAccessGuard),
  );

@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const action = this.reflector.get<ProjectAction>(PROJECT_ACTION, ctx.getHandler());
    const bodyCheck = this.reflector.get<BodyCheck | undefined>(BODY_CHECK, ctx.getHandler());
    const request = ctx
      .switchToHttp()
      .getRequest<FastifyRequest<{ Params: { projectId?: string }; Body: { projectId?: unknown } | undefined }>>();
    const projectId = request.params.projectId ?? request.body?.projectId;
    const user = request.user;
    if (!user) throw accessDenied();
    // Une opération d'administration refuse le non-Administrateur (403) avant
    // toute question d'affectation (contrat d'API, #11).
    if (!can({ isAdmin: user.isAdmin, isAssigned: true }, action)) throw accessDenied();
    if (bodyCheck) new ZodValidationPipe(bodyCheck.schema, bodyCheck.fallback).transform(request.body);
    assertUuid(projectId, projectNotFound);

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
