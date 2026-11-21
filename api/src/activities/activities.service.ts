import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  normalizeName,
  type ActivityDto,
  type ActivitySearchResultDto,
  type ActivityImpactDto,
  type CreateActivityInput,
  type RenameActivityInput,
} from '@app/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { activityNameDuplicate, activityNotFound, isUniqueViolation, projectNotFound } from '../errors.js';

const uuid = z.uuid();

/** Index de la base qui garantit l'unicité normalisée des noms dans un Projet (E21). */
const UNIQUE_NAME_INDEX = 'activity_project_name_key';

/**
 * Activités d'un Projet. L'accès au Projet est vérifié en amont (guard) et en
 * base (RLS) ; ce service vérifie que l'Activité appartient bien au Projet de
 * l'adresse, et traduit la violation d'unicité en `ACTIVITE_NOM_DUPLIQUE`.
 */
@Injectable()
export class ActivitiesService {
  constructor(private readonly database: DatabaseService) {}

  /** Activités du Projet, dans leur ordre de création (comme la source). */
  list(user: AuthenticatedUser, projectId: string): Promise<ActivityDto[]> {
    return this.database.asUser(user, async (tx) => {
      await assertProjectExists(tx, projectId);
      return tx
        .selectFrom('activity')
        .select(['id', 'project_id', 'name'])
        .where('project_id', '=', projectId)
        .orderBy('created_at')
        .orderBy('id')
        .execute()
        .then((rows) => rows.map(toDto));
    });
  }

  /**
   * Recherche combinée (ADR-0014) : paires « Activité — Projet » dont le nom
   * normalisé contient le texte normalisé (préfixe ou sous-chaîne, casse et
   * accents ignorés), une ligne par Projet. Porte sur les Projets affectés (tous
   * pour l'Administrateur). Filtrée sur l'affectation ici, pas seulement par la
   * RLS : un Projet quitté resterait visible en base par ses Imputations (#11).
   */
  search(user: AuthenticatedUser, text: string): Promise<ActivitySearchResultDto[]> {
    const normalized = normalizeName(text);
    return this.database.asUser(user, async (tx) => {
      let query = tx
        .selectFrom('activity as a')
        .innerJoin('project as p', 'p.id', 'a.project_id')
        .select(['a.id', 'a.name', 'a.project_id', 'p.name as project_name'])
        .where(sql<boolean>`position(${normalized} in a.normalized_name) > 0`);
      if (!user.isAdmin) {
        query = query.where((eb) =>
          eb.exists(
            eb
              .selectFrom('project_member as m')
              .select('m.project_id')
              .whereRef('m.project_id', '=', 'a.project_id')
              .where('m.user_id', '=', user.id),
          ),
        );
      }
      const rows = await query.orderBy('p.name').orderBy('a.created_at').orderBy('a.id').execute();
      return rows.map((row) => ({ id: row.id, name: row.name, projectId: row.project_id, projectName: row.project_name }));
    });
  }

  /** Création hors Chronomètre (Administrateur) ; un doublon normalisé est refusé par la base. */
  create(user: AuthenticatedUser, projectId: string, input: CreateActivityInput): Promise<ActivityDto> {
    return withUniqueName(() =>
      this.database.asUser(user, async (tx) => {
        await assertProjectExists(tx, projectId);
        const row = await tx
          .insertInto('activity')
          .values({
            id: randomUUID(),
            project_id: projectId,
            name: input.name,
            normalized_name: normalizeName(input.name),
          })
          .returning(['id', 'project_id', 'name'])
          .executeTakeFirstOrThrow();
        return toDto(row);
      }),
    );
  }

  /**
   * Renommage (Administrateur ou Affecté, ADR-0015). Reconfirmer le nom actuel,
   * ou en changer la casse, n'entre pas en collision avec l'Activité elle-même.
   */
  rename(
    user: AuthenticatedUser,
    projectId: string,
    activityId: string,
    input: RenameActivityInput,
  ): Promise<ActivityDto> {
    if (!uuid.safeParse(activityId).success) return Promise.reject(activityNotFound());
    return withUniqueName(() =>
      this.database.asUser(user, async (tx) => {
        await assertProjectExists(tx, projectId);
        const row = await tx
          .updateTable('activity')
          .set({ name: input.name, normalized_name: normalizeName(input.name), updated_at: new Date() })
          .where('id', '=', activityId)
          .where('project_id', '=', projectId)
          .returning(['id', 'project_id', 'name'])
          .executeTakeFirst();
        if (!row) throw activityNotFound();
        return toDto(row);
      }),
    );
  }

  /** Emporte les Imputations de l'Activité (Chronomètres compris), par cascade en base. */
  remove(user: AuthenticatedUser, projectId: string, activityId: string): Promise<void> {
    if (!uuid.safeParse(activityId).success) return Promise.reject(activityNotFound());
    return this.database.asUser(user, async (tx) => {
      await assertProjectExists(tx, projectId);
      const result = await tx
        .deleteFrom('activity')
        .where('id', '=', activityId)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (result.numDeletedRows === 0n) throw activityNotFound();
    });
  }

  /** Ce que détruirait la suppression de l'Activité, pour le dialogue chiffré. */
  impact(user: AuthenticatedUser, projectId: string, activityId: string): Promise<ActivityImpactDto> {
    if (!uuid.safeParse(activityId).success) return Promise.reject(activityNotFound());
    return this.database.asUser(user, async (tx) => {
      await assertProjectExists(tx, projectId);
      const activity = await tx
        .selectFrom('activity')
        .select('id')
        .where('id', '=', activityId)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!activity) throw activityNotFound();
      const { timeEntries } = await tx
        .selectFrom('time_entry')
        .select((eb) => eb.fn.countAll<string>().as('timeEntries'))
        .where('activity_id', '=', activityId)
        .executeTakeFirstOrThrow();
      return { timeEntries: Number(timeEntries) };
    });
  }
}

async function assertProjectExists(tx: Tx, projectId: string): Promise<void> {
  const row = await tx.selectFrom('project').select('id').where('id', '=', projectId).executeTakeFirst();
  if (!row) throw projectNotFound();
}

/** Traduit la violation de l'index d'unicité normalisée en 409 `ACTIVITE_NOM_DUPLIQUE`. */
async function withUniqueName<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error, UNIQUE_NAME_INDEX)) throw activityNameDuplicate();
    throw error;
  }
}

function toDto(row: { id: string; project_id: string; name: string }): ActivityDto {
  return { id: row.id, projectId: row.project_id, name: row.name };
}
