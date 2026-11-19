// Heure saisie : analyse tolérante du champ heure 24h de l'Édition à la volée,
// portée de la source (parseHeureSaisie). L'heure obtenue est une heure murale,
// interprétée en heure suisse sur la Journée visée (ADR-0012, voir `zurichInstant`).

/** Heure murale saisie, sans secondes. */
export interface TimeInput {
  hours: number;
  minutes: number;
}

const WITH_SEPARATOR = /^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/;
const WITHOUT_SEPARATOR = /^\d{1,4}$/;

/**
 * Interprète le texte tapé : séparateur `:` facultatif, frappe abrégée (1 à 4
 * chiffres, les deux derniers valant minutes au-delà de 2 chiffres), secondes
 * tronquées si présentes. `null` si aucun format ne correspond ou hors plage
 * (heures > 23, minutes > 59).
 */
export function parseTimeInput(text: string): TimeInput | null {
  const cleaned = text.trim();
  if (!cleaned) return null;

  const withSeparator = cleaned.match(WITH_SEPARATOR);
  if (withSeparator) return inRange(Number(withSeparator[1]), Number(withSeparator[2]));

  if (WITHOUT_SEPARATOR.test(cleaned)) {
    if (cleaned.length <= 2) return inRange(Number(cleaned), 0);
    return inRange(Number(cleaned.slice(0, -2)), Number(cleaned.slice(-2)));
  }
  return null;
}

function inRange(hours: number, minutes: number): TimeInput | null {
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/** Heure murale au format hh:mm. */
export function formatTimeInput({ hours, minutes }: TimeInput): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
