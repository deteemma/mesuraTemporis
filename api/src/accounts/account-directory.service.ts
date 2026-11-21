import { Injectable } from '@nestjs/common';
import { APP_ADMIN_ROLE, type CreateUserInput, isAdministrator } from '@app/shared';
import { AppConfig, type KeycloakAdminConfig } from '../config/app-config.js';
import { type BusinessError, emailInvalid, emailTaken, loginInvalid, loginTaken, nameInvalid, userNotFound } from '../errors.js';

/** Marge avant l'expiration du jeton du compte de service. */
const TOKEN_MARGIN_MS = 30_000;
/** Comptes lus par page dans Keycloak. */
const PAGE_SIZE = 100;
/** Keycloak qui ne répond pas : l'opération échoue au lieu d'attendre (un retrait tient une transaction ouverte). */
const TIMEOUT_MS = 5_000;

/**
 * Annuaire des comptes (#11) : masque l'API d'administration de Keycloak derrière
 * une interface métier, par le compte de service « api-admin » (ADR-0018).
 * L'écran Utilisateurs (#24) y crée, modifie et supprime les comptes ; le
 * changement de rôle et le Compte initial relèvent du #25.
 *
 * Keycloak injoignable ou secret absent : l'opération échoue (erreur imprévue,
 * 500 `ERREUR_INTERNE`), et l'appelant n'agit pas sur une réponse supposée.
 */
@Injectable()
export class AccountDirectory {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: AppConfig) {}

  /**
   * Vrai si le compte porte le rôle Administrateur, directement ou par
   * composition, comme son jeton le porterait. Un compte absent de Keycloak
   * n'a aucun rôle.
   */
  async isAdministrator(userId: string): Promise<boolean> {
    const response = await this.get(`${userPath(userId)}/role-mappings/realm/composite`);
    if (response.status === 404) return false;
    await ensureOk(response);
    const roles = (await response.json()) as { name: string }[];
    return isAdministrator(roles.map((role) => role.name));
  }

  /** Identifiants des comptes qui portent directement le rôle Administrateur. */
  async administratorIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (let first = 0; ; first += PAGE_SIZE) {
      const response = await this.get(
        `/roles/${encodeURIComponent(APP_ADMIN_ROLE)}/users?first=${first}&max=${PAGE_SIZE}&briefRepresentation=true`,
      );
      await ensureOk(response);
      const page = (await response.json()) as { id: string }[];
      for (const account of page) ids.add(account.id);
      if (page.length < PAGE_SIZE) return ids;
    }
  }

  /**
   * Crée un compte de connexion, rôle Administrateur si demandé. Renvoie le
   * compte tel que Keycloak l'a enregistré (Login et Email en minuscules). Le
   * mot de passe temporaire est ce Login enregistré, à changer à la première
   * connexion (ADR-0018). Un Login ou un Email déjà pris : `LOGIN_EXISTANT` ou
   * `EMAIL_EXISTANT` ; refusé par les règles de format de Keycloak :
   * `LOGIN_INVALIDE`, `EMAIL_INVALIDE` ou `NOM_INVALIDE`. Si une étape suivante
   * échoue, le compte est supprimé.
   */
  async createAccount(input: CreateUserInput): Promise<Account> {
    const response = await this.send('POST', '/users', {
      username: input.login,
      email: input.email,
      firstName: input.name ?? undefined,
      enabled: true,
    });
    if (response.status === 409) throw await conflict(response);
    if (response.status === 400) throw await invalid(response);
    await ensureOk(response);
    const id = response.headers.get('location')?.split('/').pop();
    if (!id) throw new Error('Keycloak n’a pas renvoyé l’adresse du compte créé');

    try {
      const account = await this.account(id);
      await ensureOk(
        await this.send('PUT', `${userPath(id)}/reset-password`, {
          type: 'password',
          value: account.login,
          temporary: true,
        }),
      );
      if (input.isAdmin) await this.grantAdministrator(id);
      return account;
    } catch (error) {
      await this.deleteAccount(id);
      throw error;
    }
  }

  /**
   * Change l'Email du compte et renvoie le compte tel qu'enregistré. Compte
   * absent : `UTILISATEUR_INTROUVABLE` ; Email déjà pris : `EMAIL_EXISTANT` ;
   * format refusé par Keycloak : `EMAIL_INVALIDE`.
   */
  async changeEmail(userId: string, email: string): Promise<Account> {
    const path = userPath(userId);
    const current = await this.get(path);
    if (current.status === 404) throw userNotFound();
    await ensureOk(current);
    // Représentation complète renvoyée : un envoi partiel effacerait le Nom.
    const representation = (await current.json()) as Record<string, unknown>;
    const response = await this.send('PUT', path, { ...representation, email });
    if (response.status === 404) throw userNotFound();
    if (response.status === 409) throw emailTaken();
    if (response.status === 400) throw await invalid(response);
    await ensureOk(response);
    return this.account(userId);
  }

  /**
   * Ferme les sessions du compte puis le supprime. Rejouable : un compte déjà
   * absent n'est pas une erreur.
   */
  async deleteAccount(userId: string): Promise<void> {
    const path = userPath(userId);
    const logout = await this.send('POST', `${path}/logout`);
    if (logout.status === 404) return;
    await ensureOk(logout);
    const response = await this.send('DELETE', path);
    if (response.status === 404) return;
    await ensureOk(response);
  }

  private async grantAdministrator(userId: string): Promise<void> {
    const role = await this.get(`/roles/${encodeURIComponent(APP_ADMIN_ROLE)}`);
    await ensureOk(role);
    const { id, name } = (await role.json()) as { id: string; name: string };
    await ensureOk(
      await this.send('POST', `${userPath(userId)}/role-mappings/realm`, [{ id, name }]),
    );
  }

  private async account(userId: string): Promise<Account> {
    const response = await this.get(userPath(userId));
    if (response.status === 404) throw userNotFound();
    await ensureOk(response);
    const user = (await response.json()) as { id: string; username: string; email?: string; firstName?: string };
    return { id: user.id, login: user.username, email: user.email ?? null, name: user.firstName ?? null };
  }

  private get(path: string): Promise<Response> {
    return this.send('GET', path);
  }

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    const config = this.adminConfig();
    return fetch(`${config.adminUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken(config)}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  /** Jeton du compte de service (client_credentials), gardé jusqu'à peu avant son expiration. */
  private async accessToken(config: KeycloakAdminConfig): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await ensureOk(response);
    const { access_token, expires_in } = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: access_token, expiresAt: Date.now() + expires_in * 1000 - TOKEN_MARGIN_MS };
    return access_token;
  }

  private adminConfig(): KeycloakAdminConfig {
    if (!this.config.keycloakAdmin) {
      throw new Error('KEYCLOAK_ADMIN_CLIENT_SECRET absent de .env : Annuaire des comptes indisponible');
    }
    return this.config.keycloakAdmin;
  }
}

/** Compte de connexion tel qu'enregistré dans l'Annuaire. */
export interface Account {
  id: string;
  login: string;
  name: string | null;
  email: string | null;
}

const userPath = (userId: string) => `/users/${encodeURIComponent(userId)}`;

/** 409 de Keycloak à la création : « User exists with same username » ou « … same email ». */
async function conflict(response: Response): Promise<BusinessError> {
  const { errorMessage } = (await response.json().catch(() => ({}))) as { errorMessage?: string };
  return /email/i.test(errorMessage ?? '') ? emailTaken() : loginTaken();
}

/** Code de refus par champ de la représentation Keycloak. */
const INVALID_FIELD = new Map<string, () => BusinessError>([
  ['username', loginInvalid],
  ['email', emailInvalid],
  ['firstName', nameInvalid],
]);

/**
 * 400 de Keycloak sur un format refusé : `{ field, errorMessage }`, ou
 * `{ errors: [...] }` si plusieurs champs le sont (le premier l'emporte). Un
 * autre 400 reste une erreur imprévue.
 */
async function invalid(response: Response): Promise<Error> {
  const text = await response.text();
  let body: { field?: string; errors?: { field?: string }[] } = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    // Corps illisible : erreur imprévue ci-dessous.
  }
  const field = body.field ?? body.errors?.[0]?.field;
  const refusal = field === undefined ? undefined : INVALID_FIELD.get(field);
  return refusal ? refusal() : new Error(`Keycloak a répondu 400 : ${text}`);
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  throw new Error(`Keycloak a répondu ${response.status} : ${await response.text()}`);
}
