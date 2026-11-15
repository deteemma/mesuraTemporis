import { Injectable } from '@nestjs/common';
import { isAdministrator } from '@app/shared';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { AppConfig } from '../config/app-config.js';
import type { AuthenticatedUser } from './authenticated-user.js';

interface KeycloakClaims extends JWTPayload {
  email?: string;
  given_name?: string;
  preferred_username?: string;
  realm_access?: { roles?: string[] };
}

/** Vérifie les jetons OIDC émis par le realm Keycloak de l'application (ADR-0005). */
@Injectable()
export class OidcVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: AppConfig) {
    this.jwks = createRemoteJWKSet(new URL(config.oidcJwksUrl));
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    const { payload } = await jwtVerify<KeycloakClaims>(token, this.jwks, {
      issuer: this.config.oidcIssuerUrl,
      audience: this.config.oidcAudience,
    });
    if (!payload.sub) throw new Error('Jeton sans « sub »');
    if (!payload.preferred_username) throw new Error('Jeton sans « preferred_username »');
    return {
      id: payload.sub,
      login: payload.preferred_username,
      email: payload.email ?? null,
      // Le Nom (champ unique « firstName » du profil) est facultatif.
      displayName: payload.given_name ?? null,
      isAdmin: isAdministrator(payload.realm_access?.roles ?? []),
    };
  }
}
