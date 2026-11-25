// Demandes d'accès (ADR-0028, #32) : liste lue par l'écran Utilisateurs, et
// nombre en attente affiché par le compteur du menu. Les deux partagent la
// même lecture : une décision prise à l'écran met le compteur à jour.
import type { AccessRequestListDto } from '@app/shared';
import { useSyncExternalStore } from 'react';
import { request } from './api';

let current: AccessRequestListDto | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Relit les Demandes d'accès (Administrateur seulement) et prévient les écrans. */
export async function reloadAccessRequests(): Promise<void> {
  current = await request<AccessRequestListDto>('/access-requests');
  for (const listener of listeners) listener();
}

/** Dernière lecture des Demandes d'accès, `null` avant la première. */
export function useAccessRequests(): AccessRequestListDto | null {
  return useSyncExternalStore(subscribe, () => current);
}
