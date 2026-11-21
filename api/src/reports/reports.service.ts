import { Injectable } from '@nestjs/common';
import { type MyProjectsDto, summarizeMyProjects } from '@app/shared';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { DatabaseService } from '../db/database.service.js';

/** Restitution des Durées de l'Utilisateur courant. */
@Injectable()
export class ReportsService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Mes projets (ADR-0016) : ses propres Imputations terminées, Administrateur
   * compris, sur les seuls Projets où il est Affecté. Le filtre sur
   * l'affectation est fait ici, pas seulement par la RLS : un Projet quitté
   * reste visible en base par ses Imputations.
   */
  myProjects(user: AuthenticatedUser): Promise<MyProjectsDto> {
    return this.database.asUser(user, async (tx) => {
      const [rows, memberships] = await Promise.all([
        tx
          .selectFrom('time_entry as e')
          .innerJoin('project as p', 'p.id', 'e.project_id')
          .innerJoin('activity as a', 'a.id', 'e.activity_id')
          .select(['e.project_id', 'p.name as project_name', 'e.activity_id', 'a.name as activity_name', 'e.started_at', 'e.ended_at'])
          .where('e.user_id', '=', user.id)
          .where('e.ended_at', 'is not', null)
          .execute(),
        tx.selectFrom('project_member').select('project_id').where('user_id', '=', user.id).execute(),
      ]);
      return summarizeMyProjects(
        rows.map((row) => ({
          projectId: row.project_id,
          projectName: row.project_name,
          activityId: row.activity_id,
          activityName: row.activity_name,
          startedAt: row.started_at.toISOString(),
          endedAt: row.ended_at ? row.ended_at.toISOString() : null,
        })),
        memberships.map((m) => m.project_id),
      );
    });
  }
}
