import { Injectable } from '@nestjs/common';
import type { UserSummaryDto } from '@app/shared';
import { sql } from 'kysely';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { DatabaseService } from '../db/database.service.js';

/**
 * Recopie dans app_user, à chaque nouveau jeton, le Login, l'Email et le Nom du
 * compte Keycloak. Crée la ligne d'un compte né de Google à sa première requête.
 */
@Injectable()
export class UsersService {
  // Dernier jeton recopié par Utilisateur : un même jeton n'est recopié qu'une fois.
  private readonly lastToken = new Map<string, string>();

  constructor(private readonly database: DatabaseService) {}

  async remember(user: AuthenticatedUser, token: string): Promise<void> {
    if (this.lastToken.get(user.id) === token) return;

    const values = { login: user.login, email: user.email, display_name: user.displayName };
    await this.database.asUser(user, (tx) =>
      tx
        .insertInto('app_user')
        .values({ id: user.id, ...values })
        .onConflict((oc) => oc.column('id').doUpdateSet({ ...values, updated_at: sql`now()` }))
        .execute(),
    );
    this.lastToken.set(user.id, token);
  }

  /**
   * Utilisateurs connus de l'application, par Login (Administrateur ; la RLS
   * ne montre que soi aux autres). Sert la liste « Affecter » de l'écran Projets.
   */
  list(user: AuthenticatedUser): Promise<UserSummaryDto[]> {
    return this.database.asUser(user, (tx) =>
      tx.selectFrom('app_user').select(['id', 'login']).orderBy('login').execute(),
    );
  }
}
