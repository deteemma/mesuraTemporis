// Le module ne connaît le socle que par ses variables d'environnement (ADR-0007).
import { z } from 'zod';

/** Variable facultative : vide (compose transmet « » par défaut) vaut absente. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  PUBLIC_URL: z.url(),
  OIDC_ISSUER_URL: z.url(),
  // Adresse interne des clés de Keycloak ; par défaut, celle de l'émetteur.
  OIDC_JWKS_URL: z.url().optional(),
  OIDC_AUDIENCE: z.string().min(1).default('api'),
  // Adresse de l'API d'administration du realm ; par défaut, déduite de celle des clés.
  KEYCLOAK_ADMIN_URL: optional(z.url()),
  // Compte de service de l'Annuaire des comptes (ADR-0018) et son secret, généré par le socle.
  KEYCLOAK_ADMIN_CLIENT_ID: optional(z.string()),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().optional(),
  WEB_DIST_DIR: z.string().optional(),
  COMPOSE_PROFILES: z.string().default(''),
});

/** Accès à l'API d'administration de Keycloak par le compte de service (« api-admin » par défaut). */
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
      ? {
          adminUrl: (parsed.KEYCLOAK_ADMIN_URL ?? defaultAdminUrl(this.oidcJwksUrl)).replace(/\/$/, ''),
          tokenUrl: tokenUrl(this.oidcJwksUrl),
          clientId: parsed.KEYCLOAK_ADMIN_CLIENT_ID ?? 'api-admin',
          clientSecret: parsed.KEYCLOAK_ADMIN_CLIENT_SECRET,
        }
      : null;
    this.webDistDir = parsed.WEB_DIST_DIR;
    this.offlineMobile = parsed.COMPOSE_PROFILES.split(',').includes('mobile-hors-ligne');
  }
}

/**
 * Adresse d'administration par défaut, déduite de celle des clés, sans nom de
 * conteneur (#11) : <keycloak>/realms/<realm>/protocol/openid-connect/certs.
 */
function defaultAdminUrl(jwksUrl: string): string {
  const match = /^(.+)\/realms\/([^/]+)\/protocol\/openid-connect\/certs$/.exec(jwksUrl);
  if (!match) throw new Error(`OIDC_JWKS_URL inattendue, KEYCLOAK_ADMIN_URL à renseigner : ${jwksUrl}`);
  const [, base, realm] = match;
  return `${base}/admin/realms/${realm}`;
}

/** Point d'émission des jetons du realm, voisin de celui des clés. */
function tokenUrl(jwksUrl: string): string {
  if (!jwksUrl.endsWith('/certs')) throw new Error(`OIDC_JWKS_URL inattendue : ${jwksUrl}`);
  return `${jwksUrl.slice(0, -'/certs'.length)}/token`;
}
