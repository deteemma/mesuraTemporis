import { z } from 'zod';

const uuid = z.uuid();

/**
 * Un identifiant mal formé désigne une ressource introuvable : il est refusé
 * avec le 404 de la ressource, sans interroger la base.
 */
export function assertUuid(id: unknown, notFound: () => Error): asserts id is string {
  if (!uuid.safeParse(id).success) throw notFound();
}
