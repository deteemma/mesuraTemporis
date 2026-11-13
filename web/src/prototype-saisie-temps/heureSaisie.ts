export interface HeureSaisie {
  heures: number;
  minutes: number;
}

const AVEC_SEPARATEUR = /^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/;
const SANS_SEPARATEUR = /^\d{1,4}$/;

/**
 * Interprète le texte tapé par l'Utilisateur pour éditer une heure de début/fin
 * d'Imputation, avec la tolérance façon Clockify : séparateur `:` optionnel,
 * saisie abrégée (1 à 4 chiffres, les deux derniers valant minutes au-delà de 2
 * chiffres), secondes tronquées si présentes. Renvoie `null` si la saisie ne
 * correspond à aucun de ces formats ou tombe hors plage (heures > 23, minutes > 59).
 */
export function parseHeureSaisie(texte: string): HeureSaisie | null {
  const nettoye = texte.trim();
  if (!nettoye) return null;

  const avecSeparateur = nettoye.match(AVEC_SEPARATEUR);
  if (avecSeparateur) {
    return validerPlage(Number(avecSeparateur[1]), Number(avecSeparateur[2]));
  }

  if (SANS_SEPARATEUR.test(nettoye)) {
    if (nettoye.length <= 2) {
      return validerPlage(Number(nettoye), 0);
    }
    const minutes = Number(nettoye.slice(-2));
    const heures = Number(nettoye.slice(0, -2));
    return validerPlage(heures, minutes);
  }

  return null;
}

function validerPlage(heures: number, minutes: number): HeureSaisie | null {
  if (heures < 0 || heures > 23 || minutes < 0 || minutes > 59) return null;
  return { heures, minutes };
}
