// Résolution Activité→Projet (ADR-0014) : suggestions et automate du champ
// « Activité » de la Saisie de temps, portés de la source
// (frontend/src/app/pages/saisie-temps/resolution-activite.ts), identifiants
// traduits. Module pur : l'écran lui fournit les résultats de la recherche,
// les Projets affectés et les dernières paires utilisées.
import { normalizeName } from './names.js';

/** Activité trouvée par la recherche combinée, avec le nom de son Projet. */
export interface ActivityOption {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
}

/** Projet où l'Utilisateur peut créer une Activité (tous pour l'Administrateur). */
export interface AssignedProject {
  id: string;
  name: string;
}

/** Paire Activité — Projet déjà utilisée, proposée quand le champ est vide. */
export interface RecentPair {
  activityId: string;
  name: string;
  projectId: string;
  projectName: string;
  /** Début de sa dernière Imputation (ISO). */
  date: string;
}

export type Suggestion =
  | { type: 'existing'; activityId: string; name: string; projectId: string; projectName: string }
  | { type: 'create'; text: string; availableProjects: AssignedProject[] };

export interface SuggestionContext {
  activities: ActivityOption[];
  assignedProjects: AssignedProject[];
  recentPairs: RecentPair[];
}

export interface SuggestionParams extends SuggestionContext {
  text: string;
  focus: boolean;
}

function lastUse(activityId: string, pairs: RecentPair[]): string | null {
  const dates = pairs.filter((p) => p.activityId === activityId).map((p) => p.date);
  return dates.length ? dates.sort().slice(-1)[0]! : null;
}

function sortedRecentPairs(pairs: RecentPair[]): Suggestion[] {
  return [...pairs]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((p) => ({ type: 'existing', activityId: p.activityId, name: p.name, projectId: p.projectId, projectName: p.projectName }));
}

/**
 * Suggestions pour le texte saisi : les Activités dont le nom normalisé contient
 * le texte normalisé (une ligne par Projet), les plus récemment utilisées en
 * premier, puis la création dans les Projets où ce nom n'existe pas encore.
 * Champ vide : les dernières paires utilisées, s'il a le focus.
 */
export function computeSuggestions(params: SuggestionParams): Suggestion[] {
  const text = normalizeName(params.text);
  if (text === '') return params.focus ? sortedRecentPairs(params.recentPairs) : [];

  const existing: Suggestion[] = params.activities
    .filter((a) => normalizeName(a.name).includes(text))
    .map((a) => ({ activity: a, lastUse: lastUse(a.id, params.recentPairs) }))
    .sort((a, b) => {
      if (a.lastUse && b.lastUse) return b.lastUse.localeCompare(a.lastUse);
      if (a.lastUse) return -1;
      if (b.lastUse) return 1;
      return a.activity.projectName.localeCompare(b.activity.projectName);
    })
    .map(({ activity: a }) => ({ type: 'existing', activityId: a.id, name: a.name, projectId: a.projectId, projectName: a.projectName }));

  const projectsWithThisName = params.activities.filter((a) => normalizeName(a.name) === text).map((a) => a.projectId);
  const remaining = params.assignedProjects.filter((p) => !projectsWithThisName.includes(p.id));

  if (remaining.length === 0) return existing;
  return [...existing, { type: 'create', text: params.text, availableProjects: remaining }];
}

/** Ce que démarrera le Chronomètre : une Activité existante, ou un nouveau nom dans un Projet. */
export interface ActivityResolution {
  activity: string;
  activityId: string | null;
  projectId: string;
  projectName: string;
  isNew: boolean;
}

export interface PendingCreation {
  text: string;
  availableProjects: AssignedProject[];
  chosenProjectId: string | null;
}

export interface ActivityFieldState {
  focus: boolean;
  text: string;
  suggestions: Suggestion[];
  highlighted: number | null;
  resolution: ActivityResolution | null;
  creation: PendingCreation | null;
}

export function initialActivityFieldState(): ActivityFieldState {
  return { focus: false, text: '', suggestions: [], highlighted: null, resolution: null, creation: null };
}

export type ActivityFieldAction =
  | { type: 'FOCUS' }
  | { type: 'SET_TEXT'; text: string }
  | { type: 'ARROW_DOWN' }
  | { type: 'ARROW_UP' }
  | { type: 'ENTER' }
  | { type: 'CLICK_SUGGESTION'; index: number }
  | { type: 'CHOOSE_CREATION_PROJECT'; projectId: string };

// Vide toujours `suggestions` une fois une suggestion choisie (clic ou Entrée) :
// la liste déroulante se ferme sur sa longueur, indépendamment du focus.
function resolveSuggestion(state: ActivityFieldState, index: number): ActivityFieldState {
  const suggestion = state.suggestions[index];
  if (!suggestion) return state;
  if (suggestion.type === 'existing') {
    return {
      ...state,
      highlighted: index,
      text: suggestion.name,
      suggestions: [],
      resolution: {
        activity: suggestion.name,
        activityId: suggestion.activityId,
        projectId: suggestion.projectId,
        projectName: suggestion.projectName,
        isNew: false,
      },
      creation: null,
    };
  }
  return {
    ...state,
    highlighted: index,
    suggestions: [],
    creation: { text: suggestion.text, availableProjects: suggestion.availableProjects, chosenProjectId: null },
    resolution: null,
  };
}

/**
 * Automate du champ « Activité ». Le démarrage exige une sélection explicite :
 * seuls le clic, Entrée sur une suggestion surlignée ou le choix du Projet de
 * création produisent une résolution, jamais la frappe seule.
 */
export function reduceActivityField(
  state: ActivityFieldState,
  action: ActivityFieldAction,
  context: SuggestionContext,
): ActivityFieldState {
  switch (action.type) {
    case 'FOCUS':
      return {
        ...state,
        focus: true,
        suggestions: computeSuggestions({ ...context, text: state.text, focus: true }),
        highlighted: null,
      };
    case 'SET_TEXT':
      return {
        ...state,
        text: action.text,
        suggestions: computeSuggestions({ ...context, text: action.text, focus: true }),
        highlighted: null,
        resolution: null,
        creation: null,
      };
    case 'ARROW_DOWN': {
      if (!state.suggestions.length) return state;
      const next = state.highlighted === null ? 0 : Math.min(state.highlighted + 1, state.suggestions.length - 1);
      return { ...state, highlighted: next };
    }
    case 'ARROW_UP': {
      if (!state.suggestions.length) return state;
      const previous = state.highlighted === null ? state.suggestions.length - 1 : Math.max(state.highlighted - 1, 0);
      return { ...state, highlighted: previous };
    }
    case 'ENTER':
      if (state.highlighted === null) return state;
      return resolveSuggestion(state, state.highlighted);
    case 'CLICK_SUGGESTION':
      return resolveSuggestion(state, action.index);
    case 'CHOOSE_CREATION_PROJECT': {
      if (!state.creation) return state;
      const project = state.creation.availableProjects.find((p) => p.id === action.projectId);
      if (!project) return state;
      return {
        ...state,
        creation: { ...state.creation, chosenProjectId: action.projectId },
        resolution: { activity: state.creation.text, activityId: null, projectId: project.id, projectName: project.name, isNew: true },
      };
    }
    default:
      return state;
  }
}

/** Imputation vue par la Saisie de temps, réduite à ce qu'en retiennent les dernières paires. */
export interface PairSource {
  activityId: string;
  activityName: string;
  projectId: string;
  projectName: string;
  startedAt: string;
}

/** Dernières paires utilisées : une par Activité, la plus récente en premier (comme la source, sur la Journée). */
export function recentPairs(entries: readonly PairSource[]): RecentPair[] {
  const latestByActivity = new Map<string, PairSource>();
  for (const entry of entries) {
    const latest = latestByActivity.get(entry.activityId);
    if (!latest || new Date(entry.startedAt) > new Date(latest.startedAt)) latestByActivity.set(entry.activityId, entry);
  }
  return [...latestByActivity.values()]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .map((e) => ({ activityId: e.activityId, name: e.activityName, projectId: e.projectId, projectName: e.projectName, date: e.startedAt }));
}
