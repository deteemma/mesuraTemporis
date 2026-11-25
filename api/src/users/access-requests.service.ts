import { Injectable } from '@nestjs/common';
import {
  type AccessRequestDecision,
  type AccessRequestDto,
  type AccessRequestListDto,
  decisionAuthorName,
  decisionRefusal,
} from '@app/shared';
import { sql } from 'kysely';
import { AccountDirectory } from '../accounts/account-directory.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { decisionOf } from '../db/queries.js';
import { accessRequestDecisionRefused, accessRequestNotFound, emailTaken, isUniqueViolation, loginTaken } from '../errors.js';
import { UsersService } from './users.service.js';

/**
 * Décision de l'Administrateur sur les Demandes d'accès (ADR-0028, #32) :
 * - acceptation : la personne devient un Utilisateur de rôle `utilisateur`,
 *   sans Projet, qui porte l'auteur et la date de l'acceptation ; la demande
 *   disparaît ;
 * - refus : la demande reste, refusée, avec son auteur et sa date ;
 * - suppression d'une demande refusée : la demande et le compte de l'Annuaire
 *   disparaissent, ce qui libère l'Email.
 * Les décisions permises selon l'état sont celles de `decisionRefusal`.
 */
@Injectable()
export class AccessRequestsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accounts: AccountDirectory,
    private readonly users: UsersService,
  ) {}

  /** Demandes en attente (les plus anciennes d'abord), et refusées à part (les plus récentes d'abord). */
  async list(user: AuthenticatedUser): Promise<AccessRequestListDto> {
    const rows = await this.database.asUser(user, (tx) =>
      tx
        .selectFrom('access_request')
        .select(['account_id', 'email', 'display_name', 'provider', 'status', 'created_at', 'decided_by_name', 'decided_at'])
        .orderBy('created_at')
        .orderBy('account_id')
        .execute(),
    );
    return {
      pending: rows.filter((row) => row.status === 'pending').map(toDto),
      refused: rows
        .filter((row) => row.status === 'refused')
        .map(toDto)
        .sort(byRefusalDesc),
    };
  }

  /**
   * L'Utilisateur naît du compte tel qu'enregistré dans l'Annuaire (Login =
   * Email), sans rôle Administrateur ni Projet ; il entre à sa connexion
   * suivante.
   */
  async accept(user: AuthenticatedUser, accountId: string): Promise<void> {
    await this.database
      .asUser(user, async (tx) => {
        await this.decide(tx, accountId, 'accept');
        const account = await this.accounts.account(accountId);
        await tx
          .insertInto('app_user')
          .values({
            id: account.id,
            login: account.login,
            email: account.email,
            display_name: account.name,
            accepted_by: user.id,
            accepted_by_name: decisionAuthorName(user),
            accepted_at: sql`now()`,
          })
          .execute();
        await tx.deleteFrom('access_request').where('account_id', '=', accountId).execute();
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'app_user_login_key')) throw loginTaken();
        if (isUniqueViolation(error, 'app_user_email_key')) throw emailTaken();
        throw error;
      });
    this.users.forgetAdmission(accountId);
  }

  async refuse(user: AuthenticatedUser, accountId: string): Promise<void> {
    await this.database.asUser(user, async (tx) => {
      await this.decide(tx, accountId, 'refuse');
      await tx
        .updateTable('access_request')
        .set({ status: 'refused', decided_by: user.id, decided_by_name: decisionAuthorName(user), decided_at: sql`now()` })
        .where('account_id', '=', accountId)
        .execute();
    });
    this.users.forgetAdmission(accountId);
  }

  /**
   * Supprime la demande refusée, puis ferme les sessions et supprime le compte
   * de l'Annuaire, dans la même transaction : l'Email est libre, et une
   * nouvelle connexion Google ou Microsoft crée une nouvelle demande. Si
   * l'Annuaire échoue, la demande est rétablie.
   */
  async remove(user: AuthenticatedUser, accountId: string): Promise<void> {
    await this.database.asUser(user, async (tx) => {
      await this.decide(tx, accountId, 'delete');
      await tx.deleteFrom('access_request').where('account_id', '=', accountId).execute();
      await this.accounts.deleteAccount(accountId);
    });
    this.users.forgetAdmission(accountId);
  }

  /**
   * Verrouille la demande le temps de la décision (deux Administrateurs ne
   * décident pas à la fois) et refuse la décision que son état n'autorise pas.
   */
  private async decide(tx: Tx, accountId: string, decision: AccessRequestDecision): Promise<void> {
    const request = await tx
      .selectFrom('access_request')
      .select('status')
      .where('account_id', '=', accountId)
      .forUpdate()
      .executeTakeFirst();
    if (!request) throw accessRequestNotFound();
    const refusal = decisionRefusal(request.status, decision);
    if (refusal) throw accessRequestDecisionRefused(refusal);
  }
}

interface AccessRequestRow {
  account_id: string;
  email: string | null;
  display_name: string | null;
  provider: string;
  created_at: Date;
  decided_by_name: string | null;
  decided_at: Date | null;
}

function toDto(row: AccessRequestRow): AccessRequestDto {
  return {
    id: row.account_id,
    email: row.email,
    name: row.display_name,
    provider: row.provider,
    createdAt: row.created_at.toISOString(),
    refusal: decisionOf(row.decided_by_name, row.decided_at),
  };
}

function byRefusalDesc(a: AccessRequestDto, b: AccessRequestDto): number {
  return (b.refusal?.at ?? '').localeCompare(a.refusal?.at ?? '');
}
