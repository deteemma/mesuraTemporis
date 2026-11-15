// Langues de l'interface (ADR-0020). Sans React : la connexion Keycloak lit
// aussi la langue courante, avant le premier rendu.

export type Language = 'fr' | 'en' | 'de' | 'it';

export interface AvailableLanguage {
  code: Language;
  /** Jamais traduit : « English » reste « English » quelle que soit la langue active. */
  nativeName: string;
  /** Drapeau en SVG plutôt qu'en emoji : Android n'a pas les glyphes de drapeaux. */
  flagUrl: string;
}

export const LANGUAGES: AvailableLanguage[] = [
  { code: 'fr', nativeName: 'Français', flagUrl: '/flags/fr.svg' },
  { code: 'en', nativeName: 'English', flagUrl: '/flags/gb.svg' },
  { code: 'de', nativeName: 'Deutsch', flagUrl: '/flags/de.svg' },
  { code: 'it', nativeName: 'Italiano', flagUrl: '/flags/it.svg' },
];

export const DEFAULT_LANGUAGE: Language = 'fr';

const STORAGE_KEY = 'mesuratemporis.langue';

function isLanguage(value: string | null): value is Language {
  return LANGUAGES.some((language) => language.code === value);
}

/** Langue mémorisée, sinon celle du navigateur si elle est proposée, sinon le français. */
export function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Stockage indisponible (navigation privée stricte) : on se rabat sur le navigateur.
  }
  const browser = (navigator.language || '').slice(0, 2).toLowerCase();
  return isLanguage(browser) ? browser : DEFAULT_LANGUAGE;
}

export function storeLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Stockage indisponible : le choix vaut pour cette visite seulement.
  }
}
