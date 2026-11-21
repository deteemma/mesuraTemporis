// Rôles et permissions : écrits une seule fois ici (ADR-0002), appliqués par
// les guards de l'API et reproduits par les politiques RLS (ADR-0006, ADR-0017).
import type { ErrorCode } from './error-codes.js';

/**
 * Rôles d'équipe de l'ADR-0006. Seul `contributor` (l'Affecté) est attribué ;
 * `owner` et `reader` restent déclarés mais ne sont jamais attribués (ADR-0017).
 */
export const PROJECT_ROLES = ['owner', 'contributor', 'reader'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** Rôle d'équipe porté par tout Affecté. */
export const ASSIGNED_ROLE = 'contributor' satisfies ProjectRole;

/** Rôle global de l'Administrateur, porté par le jeton Keycloak (ADR-0005). */
export const APP_ADMIN_ROLE = 'administrateur';

/** Vrai si les rôles du jeton font de la personne un Administrateur. */
export function isAdministrator(appRoles: readonly string[]): boolean {
  return appRoles.includes(APP_ADMIN_ROLE);
}

/** Celui qui agit sur un Projet : Administrateur ou non, Affecté ou non. */
export interface ProjectActor {
  isAdmin: boolean;
  isAssigned: boolean;
}

/**
 * Qualité requise pour chaque opération sur un Projet (contrat d'API, #11).
 * L'Administrateur peut tout, affecté ou non (ADR-0017).
 */
export const PROJECT_PERMISSIONS = {
  viewProject: 'assigned',
  listActivities: 'assigned',
  startTimer: 'assigned',
  addManualEntry: 'assigned',
  renameActivity: 'assigned',
  createProject: 'admin',
  deleteProject: 'admin',
  manageTeam: 'admin',
  // Hors Chronomètre (écran Activités du Projet). L'Affecté crée une Activité
  // en démarrant un Chronomètre : c'est l'action `startTimer`.
  createActivity: 'admin',
  deleteActivity: 'admin',
} as const satisfies Record<string, 'admin' | 'assigned'>;

export type ProjectAction = keyof typeof PROJECT_PERMISSIONS;

export function can(actor: ProjectActor, action: ProjectAction): boolean {
  if (actor.isAdmin) return true;
  return PROJECT_PERMISSIONS[action] === 'assigned' && actor.isAssigned;
}

/** Login du Compte initial, déclaré dans le realm (ADR-0018). */
export const INITIAL_ACCOUNT_LOGIN = 'admin';

/** Compte visé par un retrait du rôle Administrateur ou une suppression. */
export interface AccountActionTarget {
  id: string;
  login: string;
}

/**
 * Refus d'un retrait du rôle Administrateur ou d'une suppression de compte
 * (ADR-0018), ou `null` si l'action est permise. Le Compte initial se contrôle
 * avant l'action sur soi (#11) : le Compte initial qui se vise est refusé comme
 * Compte initial.
 */
export type AccountActionRefusal = Extract<ErrorCode, 'UTILISATEUR_COMPTE_INITIAL_PROTEGE' | 'UTILISATEUR_ACTION_SUR_SOI_INTERDITE'>;

export function accountActionRefusal(action: { actorId: string; target: AccountActionTarget }): AccountActionRefusal | null {
  if (action.target.login === INITIAL_ACCOUNT_LOGIN) return 'UTILISATEUR_COMPTE_INITIAL_PROTEGE';
  if (action.target.id === action.actorId) return 'UTILISATEUR_ACTION_SUR_SOI_INTERDITE';
  return null;
}
