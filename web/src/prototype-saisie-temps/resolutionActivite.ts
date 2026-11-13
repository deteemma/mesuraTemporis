// Doit rester identique à `normaliserTexte()` dans
// backend/src/utils/normaliserTexte.js (aucun paquet partagé entre Node et Angular
// dans ce dépôt) : les deux définissent ensemble ce que signifie "la même Activité"
// pour la saisie unifiée (ADR 0004). Répercuter tout changement de comportement des
// deux côtés.
export function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .split('')
    .filter((caractere) => {
      const code = caractere.charCodeAt(0);
      return code < 0x0300 || code > 0x036f;
    })
    .join('')
    .trim()
    .toLowerCase();
}

export interface ActiviteDisponible {
  id: string;
  nom: string;
  projetId: string;
  projetNom: string;
}

export interface ProjetAffecte {
  id: string;
  nom: string;
}

export interface PaireRecente {
  activiteId: string;
  nom: string;
  projetId: string;
  projetNom: string;
  date: string;
}

export type Suggestion =
  | { type: 'existing'; activiteId: string; nom: string; projetId: string; projetNom: string }
  | { type: 'create'; texte: string; projetsDisponibles: ProjetAffecte[] };

export interface ParametresSuggestions {
  texte: string;
  focus: boolean;
  activitesDisponibles: ActiviteDisponible[];
  projetsAffectes: ProjetAffecte[];
  pairesRecentes: PaireRecente[];
}

function derniereUtilisation(activiteId: string, pairesRecentes: PaireRecente[]): string | null {
  const dates = pairesRecentes.filter((p) => p.activiteId === activiteId).map((p) => p.date);
  return dates.length ? (dates.sort().slice(-1)[0] ?? null) : null;
}

function pairesRecentesTriees(pairesRecentes: PaireRecente[]): Suggestion[] {
  return [...pairesRecentes]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((p) => ({ type: 'existing' as const, activiteId: p.activiteId, nom: p.nom, projetId: p.projetId, projetNom: p.projetNom }));
}

export function calculerSuggestions(params: ParametresSuggestions): Suggestion[] {
  const texteNormalise = normaliser(params.texte);
  if (texteNormalise === '') {
    return params.focus ? pairesRecentesTriees(params.pairesRecentes) : [];
  }

  const existantes: Suggestion[] = params.activitesDisponibles
    .filter((a) => normaliser(a.nom).includes(texteNormalise))
    .map((a) => ({
      type: 'existing' as const,
      activiteId: a.id,
      nom: a.nom,
      projetId: a.projetId,
      projetNom: a.projetNom,
      _derniereUtilisation: derniereUtilisation(a.id, params.pairesRecentes),
    }))
    .sort((a, b) => {
      if (a._derniereUtilisation && b._derniereUtilisation) return b._derniereUtilisation.localeCompare(a._derniereUtilisation);
      if (a._derniereUtilisation) return -1;
      if (b._derniereUtilisation) return 1;
      return a.projetNom.localeCompare(b.projetNom);
    })
    .map(({ _derniereUtilisation, ...suggestion }) => suggestion);

  const projetsAvecCeNomExact = params.activitesDisponibles
    .filter((a) => normaliser(a.nom) === texteNormalise)
    .map((a) => a.projetId);
  const projetsRestants = params.projetsAffectes.filter((p) => !projetsAvecCeNomExact.includes(p.id));

  if (projetsRestants.length === 0) {
    return existantes;
  }
  return [...existantes, { type: 'create', texte: params.texte, projetsDisponibles: projetsRestants }];
}

export interface ResolutionActivite {
  activite: string;
  activiteId: string | null;
  projetId: string;
  projetNom: string;
  nouvelle: boolean;
}

export interface CreationEnCours {
  texte: string;
  projetsDisponibles: ProjetAffecte[];
  projetChoisi: string | null;
}

export interface EtatChampActivite {
  focus: boolean;
  texte: string;
  suggestions: Suggestion[];
  surlignee: number | null;
  resolution: ResolutionActivite | null;
  creation: CreationEnCours | null;
}

export function etatInitialChampActivite(): EtatChampActivite {
  return { focus: false, texte: '', suggestions: [], surlignee: null, resolution: null, creation: null };
}

export interface ContexteResolution {
  activitesDisponibles: ActiviteDisponible[];
  projetsAffectes: ProjetAffecte[];
  pairesRecentes: PaireRecente[];
}

export type ActionChampActivite =
  | { type: 'FOCUS' }
  | { type: 'SET_TEXTE'; texte: string }
  | { type: 'FLECHE_BAS' }
  | { type: 'FLECHE_HAUT' }
  | { type: 'ENTREE' }
  | { type: 'CLIC_SUGGESTION'; index: number }
  | { type: 'CHOISIR_PROJET_CREATION'; projetId: string };

// Vide toujours `suggestions` une fois une suggestion résolue (clic ou ENTREE) :
// la liste déroulante du template se ferme sur `suggestions.length`, indépendamment
// du focus — sans ce vidage, elle reste affichée après la sélection.
function resoudreSuggestion(etat: EtatChampActivite, index: number): EtatChampActivite {
  const suggestion = etat.suggestions[index];
  if (!suggestion) return etat;
  if (suggestion.type === 'existing') {
    return {
      ...etat,
      surlignee: index,
      texte: suggestion.nom,
      suggestions: [],
      resolution: {
        activite: suggestion.nom,
        activiteId: suggestion.activiteId,
        projetId: suggestion.projetId,
        projetNom: suggestion.projetNom,
        nouvelle: false,
      },
      creation: null,
    };
  }
  return {
    ...etat,
    surlignee: index,
    suggestions: [],
    creation: { texte: suggestion.texte, projetsDisponibles: suggestion.projetsDisponibles, projetChoisi: null },
    resolution: null,
  };
}

export function reducerChampActivite(
  etat: EtatChampActivite,
  action: ActionChampActivite,
  contexte: ContexteResolution,
): EtatChampActivite {
  switch (action.type) {
    case 'FOCUS':
      return {
        ...etat,
        focus: true,
        suggestions: calculerSuggestions({ ...contexte, texte: etat.texte, focus: true }),
        surlignee: null,
      };
    case 'SET_TEXTE':
      return {
        ...etat,
        texte: action.texte,
        suggestions: calculerSuggestions({ ...contexte, texte: action.texte, focus: true }),
        surlignee: null,
        resolution: null,
        creation: null,
      };
    case 'FLECHE_BAS': {
      if (!etat.suggestions.length) return etat;
      const suivante = etat.surlignee === null ? 0 : Math.min(etat.surlignee + 1, etat.suggestions.length - 1);
      return { ...etat, surlignee: suivante };
    }
    case 'FLECHE_HAUT': {
      if (!etat.suggestions.length) return etat;
      const precedente = etat.surlignee === null ? etat.suggestions.length - 1 : Math.max(etat.surlignee - 1, 0);
      return { ...etat, surlignee: precedente };
    }
    case 'ENTREE':
      if (etat.surlignee === null) return etat;
      return resoudreSuggestion(etat, etat.surlignee);
    case 'CLIC_SUGGESTION':
      return resoudreSuggestion(etat, action.index);
    case 'CHOISIR_PROJET_CREATION': {
      if (!etat.creation) return etat;
      const projet = etat.creation.projetsDisponibles.find((p) => p.id === action.projetId);
      if (!projet) return etat;
      return {
        ...etat,
        creation: { ...etat.creation, projetChoisi: action.projetId },
        resolution: { activite: etat.creation.texte, activiteId: null, projetId: projet.id, projetNom: projet.nom, nouvelle: true },
      };
    }
    default:
      return etat;
  }
}
