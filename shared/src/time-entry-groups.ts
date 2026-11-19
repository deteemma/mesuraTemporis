// Regroupement des Imputations terminées d'une Journée par couple Projet /
// Activité, repris de la source (`regrouperParProjetEtActivite`) : le
// Chronomètre reste hors groupe ; les groupes suivent le début de leur première
// Imputation ; chaque groupe porte sa Durée totale en secondes.
import { durationSeconds } from './durations.js';

/** Ce que le regroupement lit d'une Imputation. */
export interface GroupableEntry {
  projectId: string;
  activityId: string;
  startedAt: string;
  endedAt: string | null;
}

export interface TimeEntryGroup<E extends GroupableEntry> {
  key: string;
  projectId: string;
  activityId: string;
  entries: E[];
  totalSeconds: number;
}

export function groupByActivity<E extends GroupableEntry>(entries: readonly E[]): TimeEntryGroup<E>[] {
  const groups = new Map<string, TimeEntryGroup<E> & { firstStart: number }>();
  for (const entry of entries) {
    if (!entry.endedAt) continue;
    const key = `${entry.projectId}::${entry.activityId}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, projectId: entry.projectId, activityId: entry.activityId, entries: [], totalSeconds: 0, firstStart: Infinity };
      groups.set(key, group);
    }
    group.entries.push(entry);
    group.totalSeconds += durationSeconds(entry.startedAt, entry.endedAt);
    group.firstStart = Math.min(group.firstStart, new Date(entry.startedAt).getTime());
  }
  return [...groups.values()]
    .sort((a, b) => a.firstStart - b.firstStart)
    .map(({ firstStart: _firstStart, ...group }) => group);
}
