import { Injectable } from '@nestjs/common';
import { isAdministrator } from '@app/shared';
import { AppConfig, type KeycloakAdminConfig } from '../config/app-config.js';

/** Marge avant l'expiration du jeton du compte de service. */
const TOKEN_MARGIN_MS = 30_000;
/** Keycloak qui ne répond pas : l'opération échoue au lieu d'attendre (un retrait tient une transaction ouverte). */
const TIMEOUT_MS = 5_000;

/**
 * Annuaire des comptes (#11) : masque l'API d'administration de Keycloak derrière
 * une interface métier, par le compte de service « api-admin » (ADR-0018).
 * Les écrans Utilisateurs (#24, #25) l'étendront.
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
    const response = await this.get(`/users/${encodeURIComponent(userId)}/role-mappings/realm/composite`);
    if (response.status === 404) return false;
    await ensureOk(response);
    const roles = (await response.json()) as { name: string }[];
    return isAdministrator(roles.map((role) => role.name));
  }

  private async get(path: string): Promise<Response> {
    const config = this.adminConfig();
    return fetch(`${config.adminUrl}${path}`, {
      headers: { Authorization: `Bearer ${await this.accessToken(config)}` },
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

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  throw new Error(`Keycloak a répondu ${response.status} : ${await response.text()}`);
}
