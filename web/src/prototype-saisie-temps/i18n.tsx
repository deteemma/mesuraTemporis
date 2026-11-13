// PROTOTYPE — option « i18n maison » : portage direct du LangueService de la
// source (ADR source 0007) en contexte React. Dictionnaires repris tels quels.
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { de } from './dictionnaires/de';
import { en } from './dictionnaires/en';
import { fr } from './dictionnaires/fr';
import { it } from './dictionnaires/it';

export type CodeLangue = 'fr' | 'en' | 'de' | 'it';

export const LANGUES_DISPONIBLES: { code: CodeLangue; nomNatif: string; drapeauUrl: string }[] = [
  { code: 'fr', nomNatif: 'Français', drapeauUrl: '/drapeaux/fr.svg' },
  { code: 'en', nomNatif: 'English', drapeauUrl: '/drapeaux/gb.svg' },
  { code: 'de', nomNatif: 'Deutsch', drapeauUrl: '/drapeaux/de.svg' },
  { code: 'it', nomNatif: 'Italiano', drapeauUrl: '/drapeaux/it.svg' },
];

const DICTIONNAIRES: Record<CodeLangue, Record<string, string>> = { fr, en, de, it };
const LANGUE_PAR_DEFAUT: CodeLangue = 'fr';
const CLE_LANGUE = 'mesuratemporis.langue';

function estCode(valeur: string | null): valeur is CodeLangue {
  return LANGUES_DISPONIBLES.some((l) => l.code === valeur);
}

function langueInitiale(): CodeLangue {
  try {
    const stockee = localStorage.getItem(CLE_LANGUE);
    if (estCode(stockee)) return stockee;
  } catch {
    /* stockage indisponible */
  }
  const navigateur = (navigator.language || '').slice(0, 2).toLowerCase();
  return estCode(navigateur) ? navigateur : LANGUE_PAR_DEFAUT;
}

export type Traduire = (cle: string, params?: Record<string, string>) => string;

interface ContexteLangue {
  langue: CodeLangue;
  definirLangue: (code: CodeLangue) => void;
  t: Traduire;
}

const Contexte = createContext<ContexteLangue | null>(null);

export function FournisseurLangue({ children }: { children: ReactNode }) {
  const [langue, setLangue] = useState<CodeLangue>(langueInitiale);

  const definirLangue = useCallback((code: CodeLangue) => {
    try {
      localStorage.setItem(CLE_LANGUE, code);
    } catch {
      /* stockage indisponible */
    }
    setLangue(code);
  }, []);

  const t = useCallback<Traduire>(
    (cle, params) => {
      const brut = DICTIONNAIRES[langue][cle] ?? DICTIONNAIRES[LANGUE_PAR_DEFAUT][cle] ?? cle;
      if (!params) return brut;
      return Object.entries(params).reduce((texte, [nom, valeur]) => texte.replaceAll(`{${nom}}`, valeur), brut);
    },
    [langue],
  );

  const valeur = useMemo(() => ({ langue, definirLangue, t }), [langue, definirLangue, t]);
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useLangue(): ContexteLangue {
  const contexte = useContext(Contexte);
  if (!contexte) throw new Error('FournisseurLangue manquant');
  return contexte;
}
