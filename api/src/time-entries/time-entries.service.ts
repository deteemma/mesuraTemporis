import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  buildHistoryPage,
  currentDay,
  dayBounds,
  historyStartDay,
  normalizeName,
  planInlineEdit,
  type EditedTimeEntryDto,
  type HistoryPageDto,
  type InlineEditInput,
  type ManualEntryInput,
  type StartTimerInput,
  type StartedTimerDto,
  type TimeEntryDto,
  type TimerStatusDto,
} from '@app/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import {
  activityNotFound,
  endBeforeStart,
  noActiveTimer,
  projectNotFound,
  timeEntryNotFound,
} from '../errors.js';

const uuid = z.uuid();

/**
 * Imputations et Chronomètre de l'Utilisateur courant. Chacun ne lit, démarre
 * et arrête que les siens, Administrateur compris ; l'Administrateur supprime
 * toutes les Imputations (ADR-0017). L'accès au Projet du démarrage est vérifié
 * en amont (guard) et en base (RLS).
 */
@Injectable()
export class TimeEntriesService {
  constructor(private readonly database: DatabaseService) {}

  /** Le Chronomètre en cours, retrouvé après rechargement ou depuis un autre poste. */
  timer(user: AuthenticatedUser): Promise<TimerStatusDto> {
    return this.database.asUser(user, async (tx) => {
      const row = await selectEntries(tx)
        .where('e.user_id', '=', user.id)
        .where('e.ended_at', 'is', null)
        .executeTakeFirst();
      return { timer: row ? toDto(row) : null };
    });
  }

  /**
   * Démarre un Chronomètre ; celui en cours est arrêté au même instant, dans la
   * même transaction (un seul Chronomètre par Utilisateur). Un nouveau nom
   * réutilise l'Activité de même nom normalisé du Projet, sinon la crée.
   */
  start(user: AuthenticatedUser, input: StartTimerInput): Promise<StartedTimerDto> {
    return this.database.asUser(user, async (tx) => {
      // Deux démarrages simultanés du même Utilisateur s'exécutent l'un après l'autre.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`timer:${user.id}`}))`.execute(tx);

      const project = await tx.selectFrom('project').select('id').where('id', '=', input.projectId).executeTakeFirst();
      if (!project) throw projectNotFound();

      const activityId =
        input.newActivityName !== undefined
          ? await findOrCreateActivity(tx, input.projectId, input.newActivityName)
          : await findActivity(tx, input.projectId, input.activityId);

      const now = new Date();
      const stopped = await stopRunningTimer(tx, user.id, now);

      const id = randomUUID();
      await tx
        .insertInto('time_entry')
        .values({ id, user_id: user.id, project_id: input.projectId, activity_id: activityId, started_at: now })
        .execute();

      const timer = await selectEntries(tx).where('e.id', '=', id).executeTakeFirstOrThrow();
      const previous = stopped ? await selectEntries(tx).where('e.id', '=', stopped.id).executeTakeFirstOrThrow() : null;
      return { timer: toDto(timer), previousTimerStopped: previous ? toDto(previous) : null };
    });
  }

  /** Arrête le Chronomètre en cours ; s'il n'y en a plus (arrêté ailleurs) : 404 `AUCUN_CHRONO_ACTIF`. */
  stop(user: AuthenticatedUser): Promise<TimeEntryDto> {
    return this.database.asUser(user, async (tx) => {
      const stopped = await stopRunningTimer(tx, user.id, new Date());
      if (!stopped) throw noActiveTimer();
      return toDto(await selectEntries(tx).where('e.id', '=', stopped.id).executeTakeFirstOrThrow());
    });
  }

  /**
   * Saisie manuelle d'une Imputation terminée, toujours pour soi (Administrateur
   * compris) : enregistrée telle quelle, même si elle franchit minuit (pas de
   * Scission, ADR-0012). L'accès au Projet est vérifié en amont (guard) et en
   * base (RLS) ; la base refuse aussi une fin avant le début (contrainte).
   */
  addManual(user: AuthenticatedUser, input: ManualEntryInput): Promise<TimeEntryDto> {
    return this.database.asUser(user, async (tx) => {
      const project = await tx.selectFrom('project').select('id').where('id', '=', input.projectId).executeTakeFirst();
      if (!project) throw projectNotFound();
      const activityId = await findActivity(tx, input.projectId, input.activityId);

      const id = randomUUID();
      await tx
        .insertInto('time_entry')
        .values({
          id,
          user_id: user.id,
          project_id: input.projectId,
          activity_id: activityId,
          started_at: new Date(input.startedAt),
          ended_at: new Date(input.endedAt),
        })
        .execute();
      return toDto(await selectEntries(tx).where('e.id', '=', id).executeTakeFirstOrThrow());
    });
  }

  /**
   * Imputations de l'Utilisateur courant commencées dans la Journée en cours
   * (Europe/Zurich, ADR-0012), Chronomètre compris, les plus récentes d'abord.
   * Un Chronomètre qui franchit minuit reste dans la Journée de son début.
   */
  today(user: AuthenticatedUser): Promise<TimeEntryDto[]> {
    const { start, end } = dayBounds(currentDay());
    return this.database.asUser(user, async (tx) => {
      const rows = await selectEntries(tx)
        .where('e.user_id', '=', user.id)
        .where('e.started_at', '>=', start)
        .where('e.started_at', '<=', end)
        .orderBy('e.started_at', 'desc')
        .orderBy('e.id')
        .execute();
      return rows.map(toDto);
    });
  }

  /**
   * Page de l'historique des Journées précédentes de l'Utilisateur courant
   * (Administrateur compris : les siennes seulement), à partir de la Journée
   * `before` incluse, la Journée en cours toujours exclue (`historyStartDay`).
   * Le Chronomètre n'y figure jamais.
   */
  history(user: AuthenticatedUser, before: string | undefined): Promise<HistoryPageDto> {
    const { end } = dayBounds(historyStartDay(before, currentDay()));
    return this.database.asUser(user, async (tx) => {
      const rows = await selectEntries(tx)
        .where('e.user_id', '=', user.id)
        .where('e.ended_at', 'is not', null)
        .where('e.started_at', '<=', end)
        .orderBy('e.started_at', 'desc')
        .orderBy('e.id')
        .execute();
      return buildHistoryPage(rows.map(toDto));
    });
  }

  /**
   * Édition à la volée du début et/ou de la fin : l'Auteur la sienne, quelle que
   * soit son affectation ; l'Administrateur toutes (sinon 404). Une édition qui
   * ferait franchir minuit déclenche la Scission (ADR-0013) : l'original tronqué
   * et la nouvelle Imputation sont écrits dans la même transaction.
   */
  edit(user: AuthenticatedUser, id: string, input: InlineEditInput): Promise<EditedTimeEntryDto> {
    if (!uuid.safeParse(id).success) return Promise.reject(timeEntryNotFound());
    return this.database.asUser(user, async (tx) => {
      const current = await tx
        .selectFrom('time_entry')
        .select(['started_at', 'ended_at'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw timeEntryNotFound();

      const plan = planInlineEdit(
        { startedAt: current.started_at, endedAt: current.ended_at },
        {
          startedAt: input.startedAt !== undefined ? new Date(input.startedAt) : undefined,
          endedAt: input.endedAt !== undefined ? new Date(input.endedAt) : undefined,
        },
      );

      if (plan.kind === 'refused') throw endBeforeStart();

      if (plan.kind === 'update') {
        await tx
          .updateTable('time_entry')
          .set({ started_at: plan.entry.startedAt, ended_at: plan.entry.endedAt })
          .where('id', '=', id)
          .execute();
        return { entry: toDto(await selectEntries(tx).where('e.id', '=', id).executeTakeFirstOrThrow()), split: null };
      }

      // La création passe par la base, qui n'accepte qu'une Scission à minuit (migration 0002).
      const splitId = randomUUID();
      await sql`SELECT split_time_entry(${id}::uuid, ${plan.original.startedAt}, ${plan.original.endedAt},
        ${splitId}::uuid, ${plan.created.startedAt}, ${plan.created.endedAt})`.execute(tx);
      const [entry, split] = await Promise.all([
        selectEntries(tx).where('e.id', '=', id).executeTakeFirstOrThrow(),
        selectEntries(tx).where('e.id', '=', splitId).executeTakeFirstOrThrow(),
      ]);
      return { entry: toDto(entry), split: toDto(split) };
    });
  }

  /**
   * Supprime une Imputation, sans confirmation : l'Auteur la sienne, quelle que
   * soit son affectation ; l'Administrateur toutes. Celle d'un autre
   * Utilisateur, invisible en base, répond 404 `IMPUTATION_INTROUVABLE`.
   */
  remove(user: AuthenticatedUser, id: string): Promise<void> {
    if (!uuid.safeParse(id).success) return Promise.reject(timeEntryNotFound());
    return this.database.asUser(user, async (tx) => {
      const result = await tx.deleteFrom('time_entry').where('id', '=', id).executeTakeFirst();
      if (result.numDeletedRows === 0n) throw timeEntryNotFound();
    });
  }
}

/** Arrête le Chronomètre de l'Utilisateur à l'instant donné ; renvoie son identifiant, s'il y en avait un. */
function stopRunningTimer(tx: Tx, userId: string, at: Date): Promise<{ id: string } | undefined> {
  return tx
    .updateTable('time_entry')
    .set({ ended_at: at })
    .where('user_id', '=', userId)
    .where('ended_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
}

async function findActivity(tx: Tx, projectId: string, activityId: string | undefined): Promise<string> {
  if (!uuid.safeParse(activityId).success) throw activityNotFound();
  const row = await tx
    .selectFrom('activity')
    .select('id')
    .where('id', '=', activityId!)
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  if (!row) throw activityNotFound();
  return row.id;
}

/**
 * L'unicité normalisée est garantie par la base (ADR-0014) : sur conflit, la
 * création ne fait rien et l'Activité existante, même créée à l'instant par une
 * requête concurrente, est relue.
 */
async function findOrCreateActivity(tx: Tx, projectId: string, name: string): Promise<string> {
  const normalized = normalizeName(name);
  const created = await tx
    .insertInto('activity')
    .values({ id: randomUUID(), project_id: projectId, name, normalized_name: normalized })
    .onConflict((oc) => oc.columns(['project_id', 'normalized_name']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (created) return created.id;
  const existing = await tx
    .selectFrom('activity')
    .select('id')
    .where('project_id', '=', projectId)
    .where('normalized_name', '=', normalized)
    .executeTakeFirstOrThrow();
  return existing.id;
}

function selectEntries(tx: Tx) {
  return tx
    .selectFrom('time_entry as e')
    .innerJoin('project as p', 'p.id', 'e.project_id')
    .innerJoin('activity as a', 'a.id', 'e.activity_id')
    .select([
      'e.id',
      'e.user_id',
      'e.project_id',
      'p.name as project_name',
      'e.activity_id',
      'a.name as activity_name',
      'e.started_at',
      'e.ended_at',
    ]);
}

interface EntryRow {
  id: string;
  user_id: string;
  project_id: string;
  project_name: string;
  activity_id: string;
  activity_name: string;
  started_at: Date;
  ended_at: Date | null;
}

function toDto(row: EntryRow): TimeEntryDto {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    projectName: row.project_name,
    activityId: row.activity_id,
    activityName: row.activity_name,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
  };
}
