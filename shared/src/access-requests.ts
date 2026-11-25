// Admission par Demande d'accès (ADR-0028) : règles écrites une seule fois ici,
// appliquées par l'API et reproduites par les politiques RLS.
import type { ErrorCode } from './error-codes.js';

/**
 * Suite de la première requête d'un compte que l'application ne connaît pas
 * encore (ni Utilisateur, ni Demande d'accès) :
 * - arrivé par un fournisseur d'identité (Google, Microsoft) : une Demande
 *   d'accès en attente, et non un Utilisateur ;
 * - sinon (Compte initial, comptes de test, nés hors de l'écran
 *   Utilisateurs) : un Utilisateur, comme avant l'ADR-0028.
 * Un compte créé par l'écran Utilisateurs a déjà sa ligne Utilisateur.
 */
export type Arrival = { kind: 'user' } | { kind: 'access-request'; provider: string };

export function arrivalOf(identityProviders: readonly string[]): Arrival {
  const [provider] = identityProviders;
  return provider === undefined ? { kind: 'user' } : { kind: 'access-request', provider };
}

/** État d'une Demande d'accès : en attente, ou refusée par un Administrateur. */
export type AccessRequestStatus = 'pending' | 'refused';

/**
 * Admission de la personne connectée : renvoyée par `GET /admission`. En
 * attente ou refusée, la personne ne voit que la page de son état.
 */
export type AdmissionDto =
  | { status: 'admitted' }
  | { status: AccessRequestStatus; email: string | null };

/** Décision d'un Administrateur sur une Demande d'accès. */
export type AccessRequestDecision = 'accept' | 'refuse' | 'delete';

/**
 * Refus d'une décision selon l'état de la demande, ou `null` si elle est
 * permise (ADR-0028, validé par la responsable fonctionnelle pour #32) :
 * - en attente : acceptée ou refusée, jamais supprimée directement ;
 * - refusée : acceptée, ou supprimée (ce qui libère l'Email) ; un second
 *   refus est interdit et ne remplace pas le premier (validé le 2026-11-25).
 * Une demande refusée puis acceptée ne garde pas la trace de son refus :
 * seule l'acceptation reste, sur l'Utilisateur (validé le 2026-11-25).
 */
export function decisionRefusal(status: AccessRequestStatus, decision: AccessRequestDecision): ErrorCode | null {
  if (status === 'pending' && decision === 'delete') return 'DEMANDE_ACCES_NON_REFUSEE';
  if (status === 'refused' && decision === 'refuse') return 'DEMANDE_ACCES_DEJA_REFUSEE';
  return null;
}

/**
 * Nom gardé avec la décision de l'Administrateur : son Nom, à défaut son
 * Login. Il reste affiché si l'Administrateur est supprimé ensuite (validé par
 * la responsable fonctionnelle, #32).
 */
export function decisionAuthorName(administrator: { displayName: string | null; login: string }): string {
  return administrator.displayName || administrator.login;
}

/** Administrateur auteur d'une décision, et sa date (ISO 8601). */
export interface DecisionDto {
  /** Nom de l'Administrateur au moment de la décision, à défaut son Login. */
  by: string;
  at: string;
}

/** Demande d'accès telle que listée à l'écran Utilisateurs. */
export interface AccessRequestDto {
  id: string;
  email: string | null;
  name: string | null;
  /** Fournisseur d'identité (alias Keycloak : google, microsoft). */
  provider: string;
  createdAt: string;
  /** Décision de refus ; `null` en attente. */
  refusal: DecisionDto | null;
}

/** Demandes d'accès de l'écran Utilisateurs : en attente, et refusées à part. */
export interface AccessRequestListDto {
  pending: AccessRequestDto[];
  refused: AccessRequestDto[];
}
