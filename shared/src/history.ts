// Historique paginé de la Saisie de temps, repris de la source
// (`construirePageHistorique`) : Journées Europe/Zurich (ADR-0012) au lieu de
// l'UTC. Les Journées s'accumulent, de la plus récente à la plus ancienne, tant
// que le plafond de groupes Projet/Activité n'est pas dépassé ; une Journée
// n'est jamais coupée entre deux pages, même quand elle dépasse seule le plafond.
import { type Day, dayOf, isDay, shiftDay } from './day.js';
import { type GroupableEntry, type TimeEntryGroup, groupByActivity } from './time-entry-groups.js';

/** Plafond de groupes Projet/Activité d'une page, à l'identique de la source. */
export const HISTORY_PAGE_GROUP_LIMIT = 50;

export interface HistoryDay<E extends GroupableEntry> {
  day: Day;
  groups: TimeEntryGroup<E>[];
}

export interface HistoryPage<E extends GroupableEntry> {
  days: HistoryDay<E>[];
  /** Journée par laquelle commence la page suivante (incluse), ou `null` s'il n'y en a plus. */
  nextCursor: Day | null;
}

/**
 * Journée par laquelle commence une page (incluse). La Journée en cours est
 * toujours exclue : un curseur absent, illisible, absent du calendrier, ou qui
 * n'est pas antérieur à aujourd'hui vaut hier, comme dans la source.
 */
export function historyStartDay(before: string | undefined, today: Day): Day {
  const yesterday = shiftDay(today, -1);
  if (!isDay(before)) return yesterday;
  return before < today ? before : yesterday;
}

/**
 * Construit une page à partir d'Imputations terminées triées par début
 * décroissant, déjà bornées par le curseur (la Journée en cours en est exclue
 * en amont).
 */
export function buildHistoryPage<E extends GroupableEntry>(
  entriesNewestFirst: readonly E[],
  limit: number = HISTORY_PAGE_GROUP_LIMIT,
): HistoryPage<E> {
  const entriesByDay = new Map<Day, E[]>();
  for (const entry of entriesNewestFirst) {
    const day = dayOf(entry.startedAt);
    let dayEntries = entriesByDay.get(day);
    if (!dayEntries) {
      dayEntries = [];
      entriesByDay.set(day, dayEntries);
    }
    dayEntries.push(entry);
  }

  const days: HistoryDay<E>[] = [];
  let groupCount = 0;
  for (const [day, dayEntries] of entriesByDay) {
    const groups = groupByActivity(dayEntries);
    if (days.length > 0 && groupCount + groups.length > limit) return { days, nextCursor: day };
    days.push({ day, groups });
    groupCount += groups.length;
  }
  return { days, nextCursor: null };
}
