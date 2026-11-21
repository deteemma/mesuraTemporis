// Synthèse journalière, reprise de la source (`calculerSyntheseJournaliere`) :
// temps de l'Utilisateur courant sur une Journée, par Projet et Activité, en
// secondes, Chronomètre en cours exclu. Exposée par l'API seulement, sans
// écran (#11, note 2). Journée Europe/Zurich (E1, ADR-0012) ; lignes ordonnées
// par le début de leur première Imputation (E23, étendu le 2026-11-21).
import { type Day, dayOf } from './day.js';
import { durationSeconds } from './durations.js';

/** Ce que la synthèse lit d'une Imputation de l'Utilisateur courant. */
export interface DailySummaryEntry {
  projectId: string;
  projectName: string;
  activityId: string;
  activityName: string;
  startedAt: string;
  endedAt: string | null;
}

export interface DailySummaryLine {
  projectId: string;
  projectName: string;
  activityId: string;
  activityName: string;
  totalSeconds: number;
}

export interface DailySummary {
  day: Day;
  lines: DailySummaryLine[];
  totalSeconds: number;
}

/** Synthèse de la Journée `day` à partir des Imputations données. */
export function summarizeDay(entries: readonly DailySummaryEntry[], day: Day): DailySummary {
  const lines = new Map<string, DailySummaryLine & { firstStart: number }>();
  for (const entry of entries) {
    if (!entry.endedAt || dayOf(entry.startedAt) !== day) continue;
    const start = new Date(entry.startedAt).getTime();
    const key = `${entry.projectId}:${entry.activityId}`;
    let line = lines.get(key);
    if (!line) {
      line = {
        projectId: entry.projectId,
        projectName: entry.projectName,
        activityId: entry.activityId,
        activityName: entry.activityName,
        totalSeconds: 0,
        firstStart: start,
      };
      lines.set(key, line);
    }
    line.totalSeconds += durationSeconds(entry.startedAt, entry.endedAt);
    line.firstStart = Math.min(line.firstStart, start);
  }

  const sorted = [...lines.values()]
    .sort((a, b) => a.firstStart - b.firstStart)
    .map(({ projectId, projectName, activityId, activityName, totalSeconds }) => ({
      projectId,
      projectName,
      activityId,
      activityName,
      totalSeconds,
    }));
  return { day, lines: sorted, totalSeconds: sorted.reduce((sum, line) => sum + line.totalSeconds, 0) };
}
