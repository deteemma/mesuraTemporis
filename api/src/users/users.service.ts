import { Injectable } from '@nestjs/common';
import {
  accountActionRefusal,
  type AdmissionDto,
  arrivalOf,
  type CreateUserInput,
  type UserDto,
  type UserImpactDto,
  type UserListDto,
} from '@app/shared';
import { sql } from 'kysely';
import { type Account, AccountDirectory } from '../accounts/account-directory.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { countTimeEntries, isProjectMember } from '../db/queries.js';
import { accountActionRefused, emailTaken, isUniqueViolation, loginTaken, userNotFound } from '../errors.js';

const UNIQUE_LOGIN_INDEX = 'app_user_login_key';
const UNIQUE_EMAIL_INDEX = 'app_user_email_key';

const ADMITTED: AdmissionDto = { status: 'admitted' };
const pending = (email: string | null): AdmissionDto => ({ status: 'pending', email });

/**
 * Utilisateurs : la ligne app_user en base et le compte de connexion de
 * l'Annuaire des comptes (Keycloak), tenus ensemble (ADR-0018).
 *
 * À chaque nouveau jeton, recopie dans app_user le Login, l'Email et le Nom du
 * compte. Un compte arrivé par Google ou Microsoft n'a pas de ligne : sa
 * première requête crée une Demande d'accès (ADR-0028).
 */
@Injectable()
export class UsersService {
  // Dernier jeton traité par compte, et son admission : un même jeton n'est traité qu'une fois.
  private readonly lastToken = new Map<string, { token: string; admission: AdmissionDto }>();

  constructor(
    private readonly database: DatabaseService,
    private readonly accounts: AccountDirectory,
  ) {}

  /**
   * Admission de la personne du jeton (ADR-0028), et recopie de sa ligne
   * Utilisateur :
   * - Utilisateur connu : sa ligne est remise à jour ; admis ;
   * - Demande d'accès déjà enregistrée : en attente ;
   * - compte inconnu : selon `arrivalOf`, Demande d'accès en attente (arrivée
   *   par Google ou Microsoft) ou ligne Utilisateur créée (admis).
   */
  async admit(user: AuthenticatedUser, token: string): Promise<AdmissionDto> {
    const known = this.lastToken.get(user.id);
    if (known?.token === token) return known.admission;

    const admission = await this.database.asUser(user, async (tx) => {
      const values = { login: user.login, email: user.email, display_name: user.displayName };
      const updated = await tx
        .updateTable('app_user')
        .set({ ...values, updated_at: sql`now()` })
        .where('id', '=', user.id)
        .executeTakeFirst();
      if (updated.numUpdatedRows > 0n) return ADMITTED;

      const request = await tx
        .selectFrom('access_request')
        .select('email')
        .where('account_id', '=', user.id)
        .executeTakeFirst();
      if (request) return pending(request.email);

      const arrival = arrivalOf(await this.accounts.identityProviders(user.id));
      if (arrival.kind === 'access-request') {
        // Requêtes simultanées du même premier jeton : une seule demande.
        await tx
          .insertInto('access_request')
          .values({ account_id: user.id, email: user.email, display_name: user.displayName, provider: arrival.provider })
          .onConflict((oc) => oc.column('account_id').doNothing())
          .execute();
        return pending(user.email);
      }
      await tx
        .insertInto('app_user')
        .values({ id: user.id, ...values })
        .onConflict((oc) => oc.column('id').doUpdateSet({ ...values, updated_at: sql`now()` }))
        .execute();
      return ADMITTED;
    });
    this.lastToken.set(user.id, { token, admission });
    return admission;
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
   * supprimé de l'Annuaire (pas de compte orphelin). L'Email d'une Demande
   * d'accès est réservé : `EMAIL_EXISTANT` (ADR-0028).
   */
  async create(user: AuthenticatedUser, input: CreateUserInput): Promise<UserDto> {
    const reserved = await this.database.asUser(user, (tx) =>
      tx
        .selectFrom('access_request')
        .select('account_id')
        .where(sql<string>`lower(email)`, '=', input.email.toLowerCase())
        .executeTakeFirst(),
    );
    if (reserved) throw emailTaken();
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
      return { timeEntries: await countTimeEntries(tx, 'user_id', userId) };
    });
  }

  /** Attribue le rôle Administrateur ; il prend effet au jeton suivant de la personne. */
  grantAdministrator(userId: string): Promise<void> {
    return this.accounts.grantAdministrator(userId);
  }

  /**
   * Retire le rôle Administrateur et ferme aussitôt les sessions de la
   * personne. Refusé pour soi (ADR-0018) ; permis pour le Compte initial
   * (ADR-0025).
   *
   * Son Chronomètre sur un Projet où il n'est pas affecté s'arrête à l'instant
   * du retrait, dans la même transaction : il n'y a plus accès (validé par la
   * responsable fonctionnelle, #25). Sur un Projet où il est affecté, il
   * continue. Si l'Annuaire échoue, l'arrêt est annulé.
   */
  async revokeAdministrator(user: AuthenticatedUser, userId: string): Promise<void> {
    assertAccountActionAllowed(user, userId);
    await this.database.asUser(user, async (tx) => {
      const revokedAt = new Date();
      await tx
        .updateTable('time_entry as e')
        .set({ ended_at: revokedAt })
        .where('e.user_id', '=', userId)
        .where('e.ended_at', 'is', null)
        .where(({ not, ref }) => not(isProjectMember(ref('e.project_id'), ref('e.user_id'))))
        .execute();
      await this.accounts.revokeAdministrator(userId);
    });
  }

  /**
   * Supprime la ligne Utilisateur (Imputations, Chronomètre compris, et
   * affectations partent en cascade), puis ferme les sessions et supprime le
   * compte de l'Annuaire, dans la même transaction : si l'Annuaire échoue, la
   * base est rétablie. Refusé pour soi (ADR-0018) ; permis pour le Compte
   * initial (ADR-0025). Rejouable : un compte déjà absent de l'Annuaire
   * n'empêche pas de supprimer la ligne.
   */
  async remove(user: AuthenticatedUser, userId: string): Promise<void> {
    assertAccountActionAllowed(user, userId);
    await this.database.asUser(user, async (tx) => {
      const row = await tx.selectFrom('app_user').select('id').where('id', '=', userId).executeTakeFirst();
      if (!row) throw userNotFound();
      await tx.deleteFrom('app_user').where('id', '=', userId).execute();
      await this.accounts.deleteAccount(userId);
    });
  }
}

/** Retrait du rôle ou suppression : 403 pour soi-même. */
function assertAccountActionAllowed(user: AuthenticatedUser, targetId: string): void {
  const refusal = accountActionRefusal({ actorId: user.id, targetId });
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
