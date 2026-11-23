// Connexion OIDC (code + PKCE) au realm Keycloak de l'application (ADR-0005).
import { isAdministrator as hasAdministratorRole, type PublicConfigDto } from '@app/shared';
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { initialLanguage } from './i18n/languages';

let manager: UserManager | null = null;

export async function initAuth(): Promise<UserManager> {
  const config = (await (await fetch('/api/config')).json()) as PublicConfigDto;
  manager = new UserManager({
    authority: config.oidcIssuerUrl,
    client_id: config.webClientId,
    redirect_uri: `${window.location.origin}/`,
    post_logout_redirect_uri: `${window.location.origin}/`,
    scope: 'openid profile email',
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    automaticSilentRenew: true,
  });
  return manager;
}

/** Termine la connexion au retour de Keycloak, puis renvoie l'utilisateur connecté. */
export async function currentUser(): Promise<User | null> {
  if (!manager) throw new Error('initAuth() non appelé');
  const params = new URLSearchParams(window.location.search);
  if (params.has('code') && params.has('state')) {
    const user = await manager.signinRedirectCallback();
    const returnTo = typeof user.state === 'string' && user.state.startsWith('/') ? user.state : '/';
    window.history.replaceState({}, '', returnTo);
    return user;
  }
  const user = await manager.getUser();
  return user && !user.expired ? user : null;
}

let redirecting = false;

/**
 * Renvoie vers la page de connexion Keycloak, affichée dans la langue de
 * l'application. Seul point de retour à la connexion : visiteur non connecté,
 * 401 de l'API, session de 8 h terminée.
 */
export async function login(): Promise<void> {
  if (redirecting) return;
  redirecting = true;
  await manager?.signinRedirect({
    ui_locales: initialLanguage(),
    state: window.location.pathname + window.location.search,
  });
}

/** Ferme la session Keycloak, puis revient à l'application. */
export const logout = () => manager?.signoutRedirect();

/**
 * Jeton d'accès valide. Un jeton expiré (poste en veille, coupure réseau) est
 * d'abord renouvelé en silence ; si la session Keycloak est terminée (8 h),
 * on retourne à la connexion.
 */
export async function accessToken(): Promise<string> {
  let user = await manager?.getUser();
  if (user?.expired) user = await manager?.signinSilent().catch(() => null);
  if (!user || user.expired) {
    await login();
    throw new Error('Session expirée');
  }
  return user.access_token;
}

/**
 * Vrai si le jeton porte le rôle Administrateur. Sert seulement à l'affichage
 * (menu) : l'API et la base refont le contrôle (ADR-0006).
 */
export function isAdministrator(user: User): boolean {
  try {
    const payload = user.access_token.split('.')[1] ?? '';
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64)) as { realm_access?: { roles?: string[] } };
    return hasAdministratorRole(claims.realm_access?.roles ?? []);
  } catch {
    return false;
  }
}
