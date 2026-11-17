// Normalisation des noms d'Activité (ADR-0014) : identique à `normaliserTexte`
// de la source. Deux noms désignent la même Activité d'un Projet quand leurs
// formes normalisées sont égales ; la forme normalisée est stockée avec
// l'Activité et son unicité par Projet est garantie par la base.

/** Diacritiques combinants retirés après décomposition (U+0300–U+036F). */
const COMBINING_DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Décomposition NFD, retrait des diacritiques U+0300–U+036F, espaces de bord retirés, minuscules. */
export function normalizeName(text: string): string {
  return text.normalize('NFD').replace(COMBINING_DIACRITICS, '').trim().toLowerCase();
}
