// Rapport sur une plage de Journées, repris de la source (`calculerRapportPlage`
// et le regroupement par jour de l'écran) : une ligne par Journée, Utilisateur,
// Projet et Activité, un total par Journée et un total sur la période, en
// secondes. Journées Europe/Zurich (E1, ADR-0012) ; lignes d'une Journée
// ordonnées par le début de leur première Imputation (E23).
import { type Day, dayOf } from './day.js';
import { durationSeconds } from './durations.js';

/** Ce que le Rapport lit d'une Imputation. */
export interface ReportEntry {
  userId: string;
  userLogin: string;
  projectId: string;
  projectName: string;
  activityId: string;
  activityName: string;
  startedAt: string;
  endedAt: string | null;
}

export interface ReportLine {
  userId: string;
  userLogin: string;
  projectId: string;
  projectName: string;
  activityId: string;
  activityName: string;
  day: Day;
  totalSeconds: number;
}

export interface ReportDay {
  day: Day;
  lines: ReportLine[];
  totalSeconds: number;
}

/** Plage de Journées, bornes incluses. */
export interface ReportRange {
  from: Day;
  to: Day;
}

export interface Report extends ReportRange {
  days: ReportDay[];
  totalSeconds: number;
}

/** Rapport des Imputations données sur la plage. */
export function buildReport(entries: readonly ReportEntry[], range: ReportRange): Report {
  const lines = new Map<string, ReportLine & { firstStart: number }>();
  for (const entry of entries) {
    if (!entry.endedAt) continue;
    // Une Imputation appartient à la Journée de son début ; une plage inversée ne retient rien.
    const day = dayOf(entry.startedAt);
    if (day < range.from || day > range.to) continue;
    const start = new Date(entry.startedAt).getTime();
    const key = `${day}:${entry.userId}:${entry.projectId}:${entry.activityId}`;
    let line = lines.get(key);
    if (!line) {
      line = {
        userId: entry.userId,
        userLogin: entry.userLogin,
        projectId: entry.projectId,
        projectName: entry.projectName,
        activityId: entry.activityId,
        activityName: entry.activityName,
        day,
        totalSeconds: 0,
        firstStart: start,
      };
      lines.set(key, line);
    }
    line.totalSeconds += durationSeconds(entry.startedAt, entry.endedAt);
    line.firstStart = Math.min(line.firstStart, start);
  }

  const days = new Map<Day, ReportDay>();
  const ordered = [...lines.values()]
    .sort((a, b) => a.firstStart - b.firstStart)
    .map(({ userId, userLogin, projectId, projectName, activityId, activityName, day, totalSeconds }) => ({
      userId,
      userLogin,
      projectId,
      projectName,
      activityId,
      activityName,
      day,
      totalSeconds,
    }));
  for (const line of ordered) {
    let reportDay = days.get(line.day);
    if (!reportDay) {
      reportDay = { day: line.day, lines: [], totalSeconds: 0 };
      days.set(line.day, reportDay);
    }
    reportDay.lines.push(line);
    reportDay.totalSeconds += line.totalSeconds;
  }

  const sortedDays = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  return {
    from: range.from,
    to: range.to,
    days: sortedDays,
    totalSeconds: sortedDays.reduce((sum, reportDay) => sum + reportDay.totalSeconds, 0),
  };
}
