// Admission par Demande d'accès (ADR-0028) : règles écrites une seule fois ici,
// appliquées par l'API et reproduites par les politiques RLS.

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

/** Admission de la personne connectée : renvoyée par `GET /admission`. */
export type AdmissionDto = { status: 'admitted' } | { status: 'pending'; email: string | null };
