// Export Excel du Rapport, repris de la source (`genererClasseurRapport` et
// `exporter()` de l'écran) : feuille « Rapport », en-têtes en français dans
// toutes les langues (E22), une ligne par ligne du Rapport et dans son ordre,
// minutes arrondies par ligne, hh:mm:ss sans plafond à 24 h. Le classeur est
// écrit par l'API ; ce module en fixe le contenu.
import { formatSeconds } from './durations.js';
import type { Report, ReportRange } from './report.js';

export const REPORT_EXPORT_SHEET = 'Rapport';

/** Colonnes de la feuille : en-tête et largeur de la source. */
export const REPORT_EXPORT_COLUMNS = [
  { header: 'Utilisateur', width: 20 },
  { header: 'Projet', width: 20 },
  { header: 'Activité', width: 20 },
  { header: 'Journée', width: 15 },
  { header: 'Durée (minutes)', width: 15 },
  { header: 'Durée (hh:mm:ss)', width: 15 },
] as const;

export type ReportExportRow = [login: string, project: string, activity: string, day: string, minutes: number, duration: string];

/** Lignes de données de la feuille, dans l'ordre du Rapport. */
export function reportExportRows(report: Report): ReportExportRow[] {
  return report.days.flatMap((reportDay) =>
    reportDay.lines.map((line): ReportExportRow => [
      line.userLogin,
      line.projectName,
      line.activityName,
      reportDay.day,
      Math.round(line.totalSeconds / 60),
      formatSeconds(line.totalSeconds),
    ]),
  );
}

/** `rapport-<du>-<au>.xlsx` ; `rapport-<du>.xlsx` pour une seule Journée, comme l'écran de la source. */
export function reportExportFileName(range: ReportRange): string {
  return `rapport-${range.to === range.from ? range.from : `${range.from}-${range.to}`}.xlsx`;
}
