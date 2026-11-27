// Fournisseurs de connexion (ADR-0029) : règles écrites une seule fois ici,
// appliquées par l'API ; l'écran « Connexions » les présente.
import type { DecisionDto } from './access-requests.js';
import type { ErrorCode } from './error-codes.js';

/**
 * État effectif d'un fournisseur : à l'installation, activé si ses
 * identifiants sont dans `.env` ; ensuite, le choix d'un Administrateur
 * (`null` tant qu'il n'y en a pas) l'emporte. Sans identifiants, il reste
 * désactivé.
 */
export function isProviderEnabled(configured: boolean, choice: boolean | null): boolean {
  return configured && (choice ?? true);
}

/** Ce qui permet à un compte (Utilisateur, Administrateur) de se connecter. */
export interface AccountSignIn {
  /** Il a un mot de passe, même temporaire (Login et mot de passe, toujours proposés). */
  hasPassword: boolean;
  /** Fournisseurs (alias Keycloak) liés à son compte. */
  providers: readonly string[];
}

/**
 * Vrai si le compte peut se connecter : il a un mot de passe, même temporaire
 * (validé par la responsable fonctionnelle le 2026-11-27), ou un fournisseur
 * activé lié à son compte.
 */
export function canSignIn(account: AccountSignIn, enabledProviders: readonly IdentityProviderAlias[]): boolean {
  const enabled: readonly string[] = enabledProviders;
  return account.hasPassword || account.providers.some((provider) => enabled.includes(provider));
}

/**
 * Comptes qui ne pourront plus se connecter si le fournisseur est désactivé :
 * ceux qui le peuvent aujourd'hui et ne le pourront plus. Un Utilisateur né du
 * fournisseur qui a un mot de passe n'en fait pas partie (validé par la
 * responsable fonctionnelle le 2026-11-27).
 */
export function losingSignIn<T extends AccountSignIn>(
  accounts: readonly T[],
  alias: IdentityProviderAlias,
  enabledProviders: readonly IdentityProviderAlias[],
): T[] {
  const remaining = enabledProviders.filter((provider) => provider !== alias);
  return accounts.filter((account) => canSignIn(account, enabledProviders) && !canSignIn(account, remaining));
}

/**
 * Refus de désactiver un fournisseur, ou `null` si c'est permis (ADR-0029) :
 * refusé s'il ne reste aucun Administrateur capable de se connecter, c'est-à-
 * dire ayant un mot de passe ou un fournisseur resté activé.
 * `enabledProviders` : fournisseurs activés avant la désactivation.
 */
export function deactivationRefusal(
  administrators: readonly AccountSignIn[],
  alias: IdentityProviderAlias,
  enabledProviders: readonly IdentityProviderAlias[],
): ErrorCode | null {
  const remaining = enabledProviders.filter((provider) => provider !== alias);
  return administrators.some((admin) => canSignIn(admin, remaining)) ? null : 'AUCUN_ADMINISTRATEUR_CONNECTABLE';
}

/** Fournisseurs de connexion proposés (alias Keycloak), dans l'ordre de l'écran. */
export const IDENTITY_PROVIDERS = ['google', 'microsoft'] as const;
export type IdentityProviderAlias = (typeof IDENTITY_PROVIDERS)[number];

export function isIdentityProviderAlias(value: string): value is IdentityProviderAlias {
  return (IDENTITY_PROVIDERS as readonly string[]).includes(value);
}

/** Un fournisseur tel que le présente l'écran « Connexions ». */
export interface IdentityProviderDto {
  alias: IdentityProviderAlias;
  /** Identifiants présents dans `.env` ; sinon « non configuré », interrupteur grisé. */
  configured: boolean;
  enabled: boolean;
  /** Dernière modification par un Administrateur ; `null` sans modification. */
  lastChange: DecisionDto | null;
}

/** Ce qu'annonce la confirmation d'une désactivation. */
export interface DeactivationImpactDto {
  /** Utilisateurs nés de ce fournisseur qui ne pourront plus se connecter (sans mot de passe). */
  users: number;
  /** L'Administrateur qui désactive en fait partie. */
  includesYou: boolean;
}
