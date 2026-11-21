import { type ErrorCode, isErrorCode } from '@app/shared';
import { accessToken, login } from './auth';

/** Refus de l'API : `code` est un Code d'erreur du catalogue (ADR-0021), s'il y en a un. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | null,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function readError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Corps absent ou non JSON : seul le statut est connu.
  }
  const { code, message } = (body ?? {}) as { code?: unknown; message?: unknown };
  return new ApiError(
    response.status,
    isErrorCode(code) ? code : null,
    typeof message === 'string' ? message : `Erreur ${response.status}`,
  );
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await send(path, init);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** Télécharge le fichier renvoyé par l'API sous le nom donné. */
export async function download(path: string, fileName: string): Promise<void> {
  const blob = await (await send(path)).blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      // Fastify refuse un corps JSON vide (ex. DELETE) : en-tête seulement si corps.
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${await accessToken()}`,
      ...init.headers,
    },
  });
  if (response.status === 401) {
    // Session terminée côté serveur : retour à la connexion Keycloak.
    void login();
  }
  if (!response.ok) throw await readError(response);
  return response;
}
