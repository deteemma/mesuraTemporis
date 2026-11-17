import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CreateProjectInput, ProjectImpactDto, ProjectSummaryDto, UserSummaryDto } from '@app/shared';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { projectNotFound, userNotFound } from '../errors.js';

/**
 * Projets et équipes. Les droits sont vérifiés en amont (guards) et en base
 * (RLS) ; ce service vérifie l'existence de ce qu'il touche, car un
 * Administrateur passe le guard sans que le Projet ait été lu.
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Projets visibles : tous pour l'Administrateur, sinon ceux où l'Utilisateur
   * est Affecté. Filtré ici sur l'affectation, pas seulement par la RLS : un
   * Projet quitté resterait visible en base par ses Imputations (#11).
   */
  list(user: AuthenticatedUser): Promise<ProjectSummaryDto[]> {
    return this.database.asUser(user, async (tx) => {
      let query = this.selectProjects(tx);
      if (!user.isAdmin) {
        query = query.where((eb) =>
          eb.exists(
            eb
              .selectFrom('project_member as m')
              .select('m.project_id')
              .whereRef('m.project_id', '=', 'p.id')
              .where('m.user_id', '=', user.id),
          ),
        );
      }
      const rows = await query.orderBy('p.created_at', 'desc').execute();
      return rows.map(toDto);
    });
  }

  /** Accès vérifié en amont par ProjectAccessGuard. */
  get(user: AuthenticatedUser, projectId: string): Promise<ProjectSummaryDto> {
    return this.database.asUser(user, async (tx) => {
      const row = await this.selectProjects(tx).where('p.id', '=', projectId).executeTakeFirst();
      if (!row) throw projectNotFound();
      return toDto(row);
    });
  }

  /** Un Projet naît de son seul nom, avec une équipe vide (#11). */
  create(user: AuthenticatedUser, input: CreateProjectInput): Promise<ProjectSummaryDto> {
    return this.database.asUser(user, async (tx) => {
      const row = await tx
        .insertInto('project')
        .values({ id: input.id ?? randomUUID(), name: input.name })
        .returning(['id', 'name', 'status', 'created_at'])
        .executeTakeFirstOrThrow();
      return toDto(row);
    });
  }

  /** Emporte Activités, Imputations (Chronomètres compris) et équipe, par cascade en base. */
  remove(user: AuthenticatedUser, projectId: string): Promise<void> {
    return this.database.asUser(user, async (tx) => {
      const result = await tx.deleteFrom('project').where('id', '=', projectId).executeTakeFirst();
      if (result.numDeletedRows === 0n) throw projectNotFound();
    });
  }

  /** Ce que détruirait la suppression du Projet, pour le dialogue chiffré. */
  impact(user: AuthenticatedUser, projectId: string): Promise<ProjectImpactDto> {
    return this.database.asUser(user, async (tx) => {
      await this.assertProjectExists(tx, projectId);
      const { activities } = await tx
        .selectFrom('activity')
        .select((eb) => eb.fn.countAll<string>().as('activities'))
        .where('project_id', '=', projectId)
        .executeTakeFirstOrThrow();
      const { timeEntries } = await tx
        .selectFrom('time_entry')
        .select((eb) => eb.fn.countAll<string>().as('timeEntries'))
        .where('project_id', '=', projectId)
        .executeTakeFirstOrThrow();
      return { activities: Number(activities), timeEntries: Number(timeEntries) };
    });
  }

  /** Les Affectés du Projet, dans l'ordre de leur affectation. */
  members(user: AuthenticatedUser, projectId: string): Promise<UserSummaryDto[]> {
    return this.database.asUser(user, async (tx) => {
      await this.assertProjectExists(tx, projectId);
      return tx
        .selectFrom('project_member as m')
        .innerJoin('app_user as u', 'u.id', 'm.user_id')
        .select(['u.id', 'u.login'])
        .where('m.project_id', '=', projectId)
        .orderBy('m.created_at')
        .orderBy('u.login')
        .execute();
    });
  }

  /** Affecter un Utilisateur déjà affecté est sans effet (#11). */
  assign(user: AuthenticatedUser, projectId: string, userId: string): Promise<void> {
    return this.database.asUser(user, async (tx) => {
      await this.assertProjectExists(tx, projectId);
      await this.assertUserExists(tx, userId);
      await tx
        .insertInto('project_member')
        .values({ project_id: projectId, user_id: userId })
        .onConflict((oc) => oc.columns(['project_id', 'user_id']).doNothing())
        .execute();
    });
  }

  /**
   * Retire un Utilisateur de l'équipe ; sans effet s'il n'y est pas. Ses
   * Imputations restent. L'arrêt de son Chronomètre relève du ticket #20.
   */
  unassign(user: AuthenticatedUser, projectId: string, userId: string): Promise<void> {
    return this.database.asUser(user, async (tx) => {
      await this.assertProjectExists(tx, projectId);
      await this.assertUserExists(tx, userId);
      await tx
        .deleteFrom('project_member')
        .where('project_id', '=', projectId)
        .where('user_id', '=', userId)
        .execute();
    });
  }

  private selectProjects(tx: Tx) {
    return tx.selectFrom('project as p').select(['p.id', 'p.name', 'p.status', 'p.created_at']);
  }

  private async assertProjectExists(tx: Tx, projectId: string): Promise<void> {
    const row = await tx.selectFrom('project').select('id').where('id', '=', projectId).executeTakeFirst();
    if (!row) throw projectNotFound();
  }

  private async assertUserExists(tx: Tx, userId: string): Promise<void> {
    const row = await tx.selectFrom('app_user').select('id').where('id', '=', userId).executeTakeFirst();
    if (!row) throw userNotFound();
  }
}

function toDto(row: { id: string; name: string; status: string; created_at: Date }): ProjectSummaryDto {
  return { id: row.id, name: row.name, status: row.status, createdAt: row.created_at.toISOString() };
}
