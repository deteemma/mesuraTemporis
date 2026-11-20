// Date saisie : champ date maison au format suisse jj.mm.aaaa, dans les quatre
// langues et quel que soit le réglage du navigateur (ADR-0022). La date obtenue
// est une Journée Europe/Zurich (ADR-0012). La frappe est souple (validé le
// 2026-11-20) : « . » ou « / » comme séparateur, le même dans toute la date,
// année sur quatre chiffres ou sur deux (lue au XXIe siècle : 26 → 2026).
import type { Day } from './day.js';

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
