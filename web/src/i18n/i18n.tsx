// Traduction maison (ADR-0020) : contexte React et dictionnaires de la source.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { de, deErrors } from './dictionaries/de';
import { en, enErrors } from './dictionaries/en';
import { fr, frErrors } from './dictionaries/fr';
import { it, itErrors } from './dictionaries/it';
import { DEFAULT_LANGUAGE, initialLanguage, type Language, storeLanguage } from './languages';

const DICTIONARIES: Record<Language, Record<string, string>> = {
  fr: { ...fr, ...frErrors },
  en: { ...en, ...enErrors },
  de: { ...de, ...deErrors },
  it: { ...it, ...itErrors },
};

export type Translate = (key: string, params?: Record<string, string>) => string;

/**
 * Texte de `key` dans `language`, repli sur le français, puis sur la clé.
 * Chaque `{nom}` du texte est remplacé par `params.nom`.
 */
export function translate(language: Language, key: string, params?: Record<string, string>): string {
  const raw = DICTIONARIES[language][key] ?? DICTIONARIES[DEFAULT_LANGUAGE][key] ?? key;
  if (!params) return raw;
  return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), raw);
}

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    storeLanguage(next);
    setLanguageState(next);
  }, []);

  const t = useCallback<Translate>((key, params) => translate(language, key, params), [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('LanguageProvider manquant');
  return context;
}
