// Date saisie : champ date maison au format suisse jj.mm.aaaa, dans les quatre
// langues et quel que soit le réglage du navigateur (ADR-0022). La date obtenue
// est une Journée Europe/Zurich (ADR-0012). La frappe est souple (validé le
// 2026-11-20) : « . » ou « / » comme séparateur, le même dans toute la date,
// année sur quatre chiffres ou sur deux (lue au XXIe siècle : 26 → 2026).
import { type Day, zurichInstant } from './day.js';
import { parseTimeInput } from './time-input.js';

const DATE_INPUT = /^(\d{1,2})([./])(\d{1,2})\2(\d{4}|\d{2})$/;

/** Journée (AAAA-MM-JJ) d'une date saisie (jj.mm.aaaa, jj/mm/aa…) ; `null` si illisible ou absente du calendrier. */
export function parseDateInput(text: string): Day | null {
  const match = text.trim().match(DATE_INPUT);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[3]);
  const year = match[4]!.length === 2 ? 2000 + Number(match[4]) : Number(match[4]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** Date jj.mm.aaaa d'une Journée. */
export function formatDateInput(day: Day): string {
  const [year, month, date] = day.split('-');
  return `${date}.${month}.${year}`;
}

/** Bornes d'une Imputation telles que saisies : dates jj.mm.aaaa et heures 24 h. */
export interface EnteredRange {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

/**
 * Instants des bornes saisies, lues en heure de Zurich (ADR-0012), ou la
 * nature de la première saisie illisible : une date, puis une heure (ADR-0022).
 */
export function parseEnteredRange(range: EnteredRange): { startedAt: Date; endedAt: Date } | { error: 'date' | 'time' } {
  const startDay = parseDateInput(range.startDate);
  const endDay = parseDateInput(range.endDate);
  if (!startDay || !endDay) return { error: 'date' };
  const start = parseTimeInput(range.startTime);
  const end = parseTimeInput(range.endTime);
  if (!start || !end) return { error: 'time' };
  return {
    startedAt: zurichInstant(startDay, start.hours, start.minutes),
    endedAt: zurichInstant(endDay, end.hours, end.minutes),
  };
}

/**
 * Plage du Rapport saisie (« Du », « Au ») : ses Journées, `null` sans « Du »
 * (rien n'est lancé, comme dans la source), ou une date illisible (ADR-0022).
 * « Au » vide vaut « Du » : un Rapport d'une seule Journée, comme dans la source.
 */
export function parseEnteredReportRange(from: string, to: string): { from: Day; to: Day } | { error: 'date' } | null {
  if (!from.trim()) return null;
  const fromDay = parseDateInput(from);
  const toDay = to.trim() ? parseDateInput(to) : fromDay;
  if (!fromDay || !toDay) return { error: 'date' };
  return { from: fromDay, to: toDay };
}
