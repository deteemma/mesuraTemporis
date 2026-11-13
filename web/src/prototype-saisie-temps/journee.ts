// PROTOTYPE — Journée calendaire Europe/Zurich (décision « Frontière des journées »).
// Dans la vraie application, ces règles iront dans `shared/`.
export const FUSEAU = 'Europe/Zurich';

const formatJour = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSEAU,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const formatParties = new Intl.DateTimeFormat('en-GB', {
  timeZone: FUSEAU,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Journée (AAAA-MM-JJ) d'un instant, en heure de Zurich. */
export function journee(instant: Date | string): string {
  return formatJour.format(new Date(instant));
}

function decalageZurichMs(utcMs: number): number {
  const p = Object.fromEntries(formatParties.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const commeUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return commeUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Instant UTC correspondant à « jour à hh:mm » heure de Zurich. */
export function instantZurich(jour: string, heures: number, minutes: number): Date {
  const [a, m, j] = jour.split('-').map(Number);
  const naif = Date.UTC(a!, m! - 1, j!, heures, minutes);
  let instant = naif - decalageZurichMs(naif);
  instant = naif - decalageZurichMs(instant);
  return new Date(instant);
}

export function decalerJour(jour: string, nombre: number): string {
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(Date.UTC(a!, m! - 1, j! + nombre)).toISOString().slice(0, 10);
}

export const debutJournee = (jour: string) => instantZurich(jour, 0, 0);

export function formatHeure(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit' });
}

export function formatSecondesHHMMSS(totalSecondes: number): string {
  const s = Math.max(0, Math.round(totalSecondes));
  const h = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDuree(debut: string, fin: string): string {
  return formatSecondesHHMMSS((new Date(fin).getTime() - new Date(debut).getTime()) / 1000);
}
