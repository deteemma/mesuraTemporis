// Le module ne connaît le socle que par ses variables d'environnement (ADR-0007).
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  PUBLIC_URL: z.url(),
  OIDC_ISSUER_URL: z.url(),
  // Adresse interne des clés de Keycloak ; par défaut, celle de l'émetteur.
  OIDC_JWKS_URL: z.url().optional(),
  OIDC_AUDIENCE: z.string().min(1).default('api'),
  // Secret du compte de service « api-admin » (ADR-0018), généré par le socle.
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().optional(),
  WEB_DIST_DIR: z.string().optional(),
  COMPOSE_PROFILES: z.string().default(''),
});

/** Accès à l'API d'administration de Keycloak par le compte de service « api-admin ». */
export interface KeycloakAdminConfig {
  /** Ex. http://keycloak:8080/admin/realms/mesura-temporis */
  adminUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

export class AppConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly publicUrl: string;
  readonly oidcIssuerUrl: string;
  readonly oidcJwksUrl: string;
  readonly oidcAudience: string;
  /** Null tant que le secret n'est pas dans .env : l'Annuaire des comptes est indisponible. */
  readonly keycloakAdmin: KeycloakAdminConfig | null;
  readonly webDistDir: string | undefined;
  readonly offlineMobile: boolean;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const parsed = envSchema.parse(env);
    this.port = parsed.PORT;
    this.databaseUrl = parsed.DATABASE_URL;
    this.publicUrl = parsed.PUBLIC_URL.replace(/\/$/, '');
    this.oidcIssuerUrl = parsed.OIDC_ISSUER_URL.replace(/\/$/, '');
    this.oidcJwksUrl =
      parsed.OIDC_JWKS_URL ?? `${this.oidcIssuerUrl}/protocol/openid-connect/certs`;
    this.oidcAudience = parsed.OIDC_AUDIENCE;
    this.keycloakAdmin = parsed.KEYCLOAK_ADMIN_CLIENT_SECRET
      ? keycloakAdminConfig(this.oidcJwksUrl, parsed.KEYCLOAK_ADMIN_CLIENT_SECRET)
      : null;
    this.webDistDir = parsed.WEB_DIST_DIR;
    this.offlineMobile = parsed.COMPOSE_PROFILES.split(',').includes('mobile-hors-ligne');
  }
}

/**
 * Adresses déduites de celle des clés, sans nom de conteneur (#11) :
 * <keycloak>/realms/<realm>/protocol/openid-connect/certs.
 */
function keycloakAdminConfig(jwksUrl: string, clientSecret: string): KeycloakAdminConfig {
  const match = /^(.+)\/realms\/([^/]+)\/protocol\/openid-connect\/certs$/.exec(jwksUrl);
  if (!match) throw new Error(`OIDC_JWKS_URL inattendue : ${jwksUrl}`);
  const [, base, realm] = match;
  return {
    adminUrl: `${base}/admin/realms/${realm}`,
    tokenUrl: `${base}/realms/${realm}/protocol/openid-connect/token`,
    clientId: 'api-admin',
    clientSecret,
  };
}
