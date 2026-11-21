import { Injectable } from '@nestjs/common';
import {
  buildReport,
  currentDay,
  dayBounds,
  isDay,
  summarizeDay,
  summarizeMyProjects,
  type DailySummaryDto,
  type MyProjectsDto,
  type ReportDto,
  type ReportRange,
  type ReportRangeInput,
} from '@app/shared';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { DatabaseService, type Tx } from '../db/database.service.js';

/** Restitution des Durées : Mes projets, Rapport et synthèse journalière. */
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
        selectFinished(tx).where('e.user_id', '=', user.id).execute(),
        tx.selectFrom('project_member').select('project_id').where('user_id', '=', user.id).execute(),
      ]);
      return summarizeMyProjects(
        rows.map(toEntry),
        memberships.map((m) => m.project_id),
      );
    });
  }

  /**
   * Rapport sur une plage de Journées, bornes incluses (Europe/Zurich, E1).
   * L'Administrateur voit tout le monde ; un Utilisateur, ses seules
   * Imputations, y compris sur un Projet partagé ou quitté (pas de filtre sur
   * l'affectation). Le filtre sur l'Auteur est fait ici et par la RLS.
   */
  report(user: AuthenticatedUser, range: ReportRangeInput): Promise<ReportDto> {
    return this.database.asUser(user, async (tx) => {
      let query = selectFinished(tx, range)
        .innerJoin('app_user as u', 'u.id', 'e.user_id')
        .select('u.login as user_login');
      if (!user.isAdmin) query = query.where('e.user_id', '=', user.id);
      const rows = await query.execute();
      return buildReport(
        rows.map((row) => ({ ...toEntry(row), userId: row.user_id, userLogin: row.user_login })),
        range,
      );
    });
  }

  /**
   * Synthèse journalière de l'Utilisateur courant, Administrateur compris
   * (API seulement, #11 note 2). Sans Journée lisible, la Journée en cours,
   * comme dans la source.
   */
  dailySummary(user: AuthenticatedUser, day: string | undefined): Promise<DailySummaryDto> {
    const target = isDay(day) ? day : currentDay();
    return this.database.asUser(user, async (tx) => {
      const rows = await selectFinished(tx, { from: target, to: target }).where('e.user_id', '=', user.id).execute();
      return summarizeDay(rows.map(toEntry), target);
    });
  }
}

/**
 * Imputations terminées, avec les noms de leur Projet et de leur Activité ;
 * avec une plage, celles qui commencent dans ses Journées (bornes incluses).
 */
function selectFinished(tx: Tx, range?: ReportRange) {
  let query = tx
    .selectFrom('time_entry as e')
    .innerJoin('project as p', 'p.id', 'e.project_id')
    .innerJoin('activity as a', 'a.id', 'e.activity_id')
    .select(['e.user_id', 'e.project_id', 'p.name as project_name', 'e.activity_id', 'a.name as activity_name', 'e.started_at', 'e.ended_at'])
    .where('e.ended_at', 'is not', null);
  if (range) {
    query = query
      .where('e.started_at', '>=', dayBounds(range.from).start)
      .where('e.started_at', '<=', dayBounds(range.to).end);
  }
  return query;
}

interface FinishedRow {
  project_id: string;
  project_name: string;
  activity_id: string;
  activity_name: string;
  started_at: Date;
  ended_at: Date | null;
}

const toEntry = (row: FinishedRow) => ({
  projectId: row.project_id,
  projectName: row.project_name,
  activityId: row.activity_id,
  activityName: row.activity_name,
  startedAt: row.started_at.toISOString(),
  endedAt: row.ended_at ? row.ended_at.toISOString() : null,
});
