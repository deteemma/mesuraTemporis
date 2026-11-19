// Scission (ADR-0013) : une Édition à la volée qui ferait franchir minuit à une
// Imputation la découpe sur deux Journées Europe/Zurich (ADR-0012), au lieu de
// la refuser. Règle pure : l'API l'applique en une seule transaction.
import { dayBounds, dayOf, formatTimeOfDay, shiftDay, zurichInstant, type Day } from './day.js';

/** Bornes d'une Imputation ; `endedAt` vide : c'est le Chronomètre. */
export interface EntryRange {
  startedAt: Date;
  endedAt: Date | null;
}

/** Imputation terminée. */
export interface FinishedRange {
  startedAt: Date;
  endedAt: Date;
}

/** Édition à la volée : le début, la fin, ou les deux, déjà interprétés en instants. */
export interface InlineEdit {
  startedAt?: Date;
  endedAt?: Date;
}

export type InlineEditPlan =
  /** Modification simple de l'Imputation. */
  | { kind: 'update'; entry: EntryRange }
  /** Original tronqué à minuit et nouvelle Imputation (même Auteur, Projet, Activité) sur l'autre Journée. */
  | { kind: 'split'; original: FinishedRange; created: FinishedRange }
  /** Début et fin envoyés ensemble et inversés : direction ambiguë, refus (à l'identique de la source). */
  | { kind: 'refused'; code: 'IMPUTATION_FIN_AVANT_DEBUT' };

/**
 * Décide de l'effet d'une Édition à la volée. La direction de la coupe se
 * déduit du champ édité :
 * - fin seule, antérieure au début : l'original s'arrête à 23:59:59.999 de sa
 *   Journée, la nouvelle Imputation va de minuit du lendemain à l'heure visée ;
 * - début seul, postérieur à la fin : l'original commence à minuit de sa
 *   Journée, la nouvelle Imputation va de l'heure visée la veille à 23:59:59.999.
 * L'heure visée est l'heure murale suisse de l'instant édité, reportée sur
 * l'autre Journée (jours de 23 et 25 heures compris).
 */
export function planInlineEdit(entry: EntryRange, edit: InlineEdit): InlineEditPlan {
  const startedAt = edit.startedAt ?? entry.startedAt;
  const endedAt = edit.endedAt ?? entry.endedAt;

  if (!endedAt || endedAt >= startedAt) return { kind: 'update', entry: { startedAt, endedAt } };

  if (edit.endedAt && !edit.startedAt) {
    const day = dayOf(startedAt);
    const nextDay = shiftDay(day, 1);
    return {
      kind: 'split',
      original: { startedAt, endedAt: dayBounds(day).end },
      created: { startedAt: dayBounds(nextDay).start, endedAt: sameWallTimeOn(endedAt, nextDay) },
    };
  }

  if (edit.startedAt && !edit.endedAt) {
    // Journée d'origine : celle de la fin conservée, comme dans la source.
    const day = dayOf(endedAt);
    const previousDay = shiftDay(day, -1);
    return {
      kind: 'split',
      original: { startedAt: dayBounds(day).start, endedAt },
      created: { startedAt: sameWallTimeOn(startedAt, previousDay), endedAt: dayBounds(previousDay).end },
    };
  }

  return { kind: 'refused', code: 'IMPUTATION_FIN_AVANT_DEBUT' };
}

const MINUTE_MS = 60_000;

/** Même heure murale suisse (secondes comprises) sur une autre Journée. */
function sameWallTimeOn(instant: Date, day: Day): Date {
  const [hours, minutes] = formatTimeOfDay(instant).split(':').map(Number);
  // Le décalage de Zurich est un nombre entier d'heures : secondes et millisecondes sont celles de l'UTC.
  const withinMinute = ((instant.getTime() % MINUTE_MS) + MINUTE_MS) % MINUTE_MS;
  return new Date(zurichInstant(day, hours!, minutes!).getTime() + withinMinute);
}
