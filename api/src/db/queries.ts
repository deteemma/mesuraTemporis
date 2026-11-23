// Fragments de requêtes partagés par les services, écrits une seule fois.
import { type Expression, expressionBuilder, type SqlBool } from 'kysely';
import { projectNotFound } from '../errors.js';
import type { Tx } from './database.service.js';
import type { Database } from './schema.js';

/** 404 `PROJET_INTROUVABLE` si le Projet n'existe pas (ou n'est pas visible en base). */
export async function assertProjectExists(tx: Tx, projectId: string): Promise<void> {
  const row = await tx.selectFrom('project').select('id').where('id', '=', projectId).executeTakeFirst();
  if (!row) throw projectNotFound();
}

/**
 * Vrai si l'Utilisateur fait partie de l'équipe du Projet. Projet et
 * Utilisateur sont des colonnes de la requête englobante (`eb.ref(...)`) ou
 * des valeurs.
 */
export function isProjectMember(
  projectId: Expression<string>,
  userId: Expression<string> | string,
): Expression<SqlBool> {
  const eb = expressionBuilder<Database, never>();
  return eb.exists(
    eb
      .selectFrom('project_member as m')
      .select('m.project_id')
      .where('m.project_id', '=', projectId)
      .where('m.user_id', '=', userId),
  );
}

/** Nombre d'Imputations d'un Projet, d'une Activité ou d'un Utilisateur (dialogues d'impact). */
export async function countTimeEntries(
  tx: Tx,
  column: 'project_id' | 'activity_id' | 'user_id',
  id: string,
): Promise<number> {
  const { timeEntries } = await tx
    .selectFrom('time_entry')
    .select((eb) => eb.fn.countAll<string>().as('timeEntries'))
    .where(column, '=', id)
    .executeTakeFirstOrThrow();
  return Number(timeEntries);
}
