// Lecture des Imputations avec les noms de leur Projet et de leur Activité,
// commune à la saisie (Journée, Historique) et à la restitution (Rapport).
import type { Tx } from './database.service.js';

export function selectTimeEntries(tx: Tx) {
  return tx
    .selectFrom('time_entry as e')
    .innerJoin('project as p', 'p.id', 'e.project_id')
    .innerJoin('activity as a', 'a.id', 'e.activity_id')
    .select([
      'e.id',
      'e.user_id',
      'e.project_id',
      'p.name as project_name',
      'e.activity_id',
      'a.name as activity_name',
      'e.started_at',
      'e.ended_at',
    ]);
}

export interface TimeEntryRow {
  project_id: string;
  project_name: string;
  activity_id: string;
  activity_name: string;
  started_at: Date;
  ended_at: Date | null;
}

/** Projet, Activité et plage d'une Imputation, dates au format ISO. */
export function toEntryFields(row: TimeEntryRow) {
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    activityId: row.activity_id,
    activityName: row.activity_name,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
  };
}
