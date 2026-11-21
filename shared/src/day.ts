// Journée (ADR-0012) : journée calendaire Europe/Zurich, la même pour tous les
// Utilisateurs, heures d'été et d'hiver comprises. Une Imputation appartient à
// la Journée de son heure de début. Écrit une seule fois ici, pour l'API et le web.

/** Fuseau figé de toutes les Journées. */
export const DAY_TIME_ZONE = 'Europe/Zurich';

/** Journée au format AAAA-MM-JJ. */
export type Day = string;

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: DAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Journée (AAAA-MM-JJ) d'un instant. */
export function dayOf(instant: Date | string): Day {
  return dayFormat.format(new Date(instant));
}

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: DAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Décalage de Zurich sur UTC (en ms) à l'instant donné. */
function zurichOffsetMs(utcMs: number): number {
  const parts: Record<string, number> = {};
  for (const { type, value } of partsFormat.formatToParts(new Date(utcMs))) parts[type] = Number(value);
  const wallAsUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

function parseDay(day: Day): [number, number, number] {
  const [year, month, date] = day.split('-').map(Number);
  return [year!, month!, date!];
}

/**
 * Instant correspondant à l'heure murale `hours:minutes` de la Journée `day`,
 * heure de Zurich (interprétation de l'heure saisie, ADR-0012).
 */
export function zurichInstant(day: Day, hours: number, minutes: number): Date {
  const [year, month, date] = parseDay(day);
  const wall = Date.UTC(year, month - 1, date, hours, minutes);
  // Deux passes : le décalage à appliquer est celui de l'instant visé, pas
  // celui de l'heure murale lue comme UTC (diffère autour d'un changement d'heure).
  const firstGuess = wall - zurichOffsetMs(wall);
  return new Date(wall - zurichOffsetMs(firstGuess));
}

/** Journée décalée de `count` jours calendaires. */
export function shiftDay(day: Day, count: number): Day {
  const [year, month, date] = parseDay(day);
  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Vrai pour une Journée AAAA-MM-JJ qui existe au calendrier. */
export function isDay(value: unknown): value is Day {
  return typeof value === 'string' && ISO_DAY.test(value) && shiftDay(value, 0) === value;
}

/** Bornes d'une Journée : début à minuit, fin incluse à 23:59:59.999 (23 ou 25 heures aux changements d'heure). */
export function dayBounds(day: Day): { start: Date; end: Date } {
  const start = zurichInstant(day, 0, 0);
  const nextStart = zurichInstant(shiftDay(day, 1), 0, 0);
  return { start, end: new Date(nextStart.getTime() - 1) };
}

/** Journée en cours. */
export function currentDay(now: Date = new Date()): Day {
  return dayOf(now);
}

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: DAY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Heure murale hh:mm (24 h) d'un instant, heure de Zurich. */
export function formatTimeOfDay(instant: Date | string): string {
  return timeFormat.format(new Date(instant));
}
