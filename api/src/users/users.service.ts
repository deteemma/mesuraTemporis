import { Injectable } from '@nestjs/common';
import { type AccountActionTarget, accountActionRefusal, type CreateUserInput, type UserDto, type UserImpactDto, type UserListDto } from '@app/shared';
import { sql } from 'kysely';
import { type Account, AccountDirectory } from '../accounts/account-directory.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { accountActionRefused, emailTaken, isUniqueViolation, loginTaken, userNotFound } from '../errors.js';

const UNIQUE_LOGIN_INDEX = 'app_user_login_key';
const UNIQUE_EMAIL_INDEX = 'app_user_email_key';

/**
 * Utilisateurs : la ligne app_user en base et le compte de connexion de
 * l'Annuaire des comptes (Keycloak), tenus ensemble (ADR-0018).
 *
 * À chaque nouveau jeton, recopie dans app_user le Login, l'Email et le Nom du
 * compte. Crée la ligne d'un compte né de Google à sa première requête.
 */
@Injectable()
export class UsersService {
  // Dernier jeton recopié par Utilisateur : un même jeton n'est recopié qu'une fois.
  private readonly lastToken = new Map<string, string>();

  constructor(
    private readonly database: DatabaseService,
    private readonly accounts: AccountDirectory,
  ) {}

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
   * Tous les Utilisateurs par Login, avec leur rôle lu dans l'Annuaire, et le
   * nombre de ceux qui n'ont aucune affectation (badge « sans Projet »). Sert
   * aussi la liste « Affecter » de l'écran Projets.
   */
  async list(user: AuthenticatedUser): Promise<UserListDto> {
    const [rows, administrators] = await Promise.all([
      this.database.asUser(user, (tx) =>
        tx
          .selectFrom('app_user as u')
          .select(['u.id', 'u.login', 'u.email', 'u.display_name'])
          .select((eb) =>
            eb
              .exists(eb.selectFrom('project_member as m').select('m.user_id').whereRef('m.user_id', '=', 'u.id'))
              .as('assigned'),
          )
          .orderBy('u.login')
          .execute(),
      ),
      this.accounts.administratorIds(),
    ]);
    return {
      users: rows.map((row) => toDto(row, administrators.has(row.id))),
      withoutProject: rows.filter((row) => !row.assigned).length,
    };
  }

  /**
   * Crée le compte dans l'Annuaire, puis la ligne Utilisateur : il est
   * affectable avant sa première connexion. Si la base échoue, le compte est
   * supprimé de l'Annuaire (pas de compte orphelin).
   */
  async create(user: AuthenticatedUser, input: CreateUserInput): Promise<UserDto> {
    const account = await this.accounts.createAccount(input);
    try {
      await this.database.asUser(user, (tx) =>
        tx
          .insertInto('app_user')
          .values({ id: account.id, login: account.login, email: account.email, display_name: account.name })
          .execute(),
      );
    } catch (error) {
      await this.accounts.deleteAccount(account.id);
      throw translateUniqueViolation(error);
    }
    return toDto(fromAccount(account), input.isAdmin);
  }

  /**
   * Change l'Email en base puis dans l'Annuaire, dans une même transaction :
   * si l'Annuaire refuse, la base est rétablie. L'Email retenu est celui que
   * l'Annuaire enregistre (en minuscules).
   */
  changeEmail(user: AuthenticatedUser, userId: string, email: string): Promise<void> {
    return this.database
      .asUser(user, async (tx) => {
        await setEmail(tx, userId, email);
        const account = await this.accounts.changeEmail(userId, email);
        if (account.email !== email) await setEmail(tx, userId, account.email);
      })
      .catch((error: unknown) => {
        throw translateUniqueViolation(error);
      });
  }

  /** Ce que détruirait la suppression de l'Utilisateur, pour le dialogue chiffré. */
  impact(user: AuthenticatedUser, userId: string): Promise<UserImpactDto> {
    return this.database.asUser(user, async (tx) => {
      const row = await tx.selectFrom('app_user').select('id').where('id', '=', userId).executeTakeFirst();
      if (!row) throw userNotFound();
      const { timeEntries } = await tx
        .selectFrom('time_entry')
        .select((eb) => eb.fn.countAll<string>().as('timeEntries'))
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow();
      return { timeEntries: Number(timeEntries) };
    });
  }

  /** Attribue le rôle Administrateur ; il prend effet au jeton suivant de la personne. */
  grantAdministrator(userId: string): Promise<void> {
    return this.accounts.grantAdministrator(userId);
  }

  /**
   * Retire le rôle Administrateur et ferme aussitôt les sessions de la
   * personne. Refusé pour le Compte initial et pour soi (ADR-0018). Le Login
   * est lu dans l'Annuaire : le Compte initial n'a pas de ligne Utilisateur
   * avant sa première connexion.
   */
  async revokeAdministrator(user: AuthenticatedUser, userId: string): Promise<void> {
    assertAccountActionAllowed(user, await this.accounts.account(userId));
    await this.accounts.revokeAdministrator(userId);
  }

  /**
   * Supprime la ligne Utilisateur (Imputations, Chronomètre compris, et
   * affectations partent en cascade), puis ferme les sessions et supprime le
   * compte de l'Annuaire, dans la même transaction : si l'Annuaire échoue, la
   * base est rétablie. Refusé pour le Compte initial et pour soi (ADR-0018).
   * Le refus passe avant « introuvable » : le Compte initial est refusé même
   * sans ligne Utilisateur (avant sa première connexion). Rejouable : un compte
   * déjà absent de l'Annuaire n'empêche pas de supprimer la ligne, dont le
   * Login (recopié de l'Annuaire, non modifiable) est alors contrôlé.
   */
  async remove(user: AuthenticatedUser, userId: string): Promise<void> {
    const account = await this.accounts.findAccount(userId);
    await this.database.asUser(user, async (tx) => {
      const row = await tx.selectFrom('app_user').select(['id', 'login']).where('id', '=', userId).executeTakeFirst();
      const target = account ?? row;
      if (target) assertAccountActionAllowed(user, target);
      if (!row) throw userNotFound();
      await tx.deleteFrom('app_user').where('id', '=', userId).execute();
      await this.accounts.deleteAccount(userId);
    });
  }
}

/** Retrait du rôle ou suppression : 403 pour le Compte initial ou soi-même. */
function assertAccountActionAllowed(user: AuthenticatedUser, target: AccountActionTarget): void {
  const refusal = accountActionRefusal({ actorId: user.id, target });
  if (refusal) throw accountActionRefused(refusal);
}

async function setEmail(tx: Tx, userId: string, email: string | null): Promise<void> {
  const result = await tx
    .updateTable('app_user')
    .set({ email, updated_at: sql`now()` })
    .where('id', '=', userId)
    .executeTakeFirst();
  if (result.numUpdatedRows === 0n) throw userNotFound();
}

/** Login ou Email déjà pris en base : mêmes refus que dans l'Annuaire. */
function translateUniqueViolation(error: unknown): unknown {
  if (isUniqueViolation(error, UNIQUE_LOGIN_INDEX)) return loginTaken();
  if (isUniqueViolation(error, UNIQUE_EMAIL_INDEX)) return emailTaken();
  return error;
}

interface UserRow {
  id: string;
  login: string;
  email: string | null;
  display_name: string | null;
}

function fromAccount(account: Account): UserRow {
  return { id: account.id, login: account.login, email: account.email, display_name: account.name };
}

function toDto(row: UserRow, isAdmin: boolean): UserDto {
  return { id: row.id, login: row.login, name: row.display_name, email: row.email, isAdmin };
}
