// Durées (glossaire) : à la seconde, au format hh:mm:ss, sans plafond à 24 h
// (les Imputations pouvant se chevaucher, un cumul dépasse légitimement 24 h).
// Repris de la source (frontend/src/app/shared/duree.util.ts).

const pad = (value: number) => String(value).padStart(2, '0');

/** hh:mm:ss d'un nombre de secondes, arrondi à la seconde, jamais négatif. */
export function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds % 60)}`;
}

/** Durée en secondes entre un début et une fin, arrondie à la seconde. */
export function durationSeconds(start: Date | string, end: Date | string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
}
