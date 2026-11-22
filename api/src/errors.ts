import { HttpException, HttpStatus } from '@nestjs/common';
import { type AccountActionRefusal, errorBody, type ErrorCode } from '@app/shared';

/**
 * Refus métier (ADR-0021) : statut HTTP et corps `{ code, message }`, le
 * message étant le repli français du catalogue de @app/shared.
 */
export class BusinessError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
  ) {
    super(errorBody(code), status);
  }
}

export const accessDenied = () => new BusinessError(HttpStatus.FORBIDDEN, 'ACCES_REFUSE');
export const projectNotFound = () => new BusinessError(HttpStatus.NOT_FOUND, 'PROJET_INTROUVABLE');
export const userNotFound = () => new BusinessError(HttpStatus.NOT_FOUND, 'UTILISATEUR_INTROUVABLE');
export const activityNotFound = () => new BusinessError(HttpStatus.NOT_FOUND, 'ACTIVITE_INTROUVABLE');
export const activityNameDuplicate = () => new BusinessError(HttpStatus.CONFLICT, 'ACTIVITE_NOM_DUPLIQUE');
export const timeEntryNotFound = () => new BusinessError(HttpStatus.NOT_FOUND, 'IMPUTATION_INTROUVABLE');
export const noActiveTimer = () => new BusinessError(HttpStatus.NOT_FOUND, 'AUCUN_CHRONO_ACTIF');
export const endBeforeStart = () => new BusinessError(HttpStatus.BAD_REQUEST, 'IMPUTATION_FIN_AVANT_DEBUT');
export const loginTaken = () => new BusinessError(HttpStatus.CONFLICT, 'LOGIN_EXISTANT');
export const emailTaken = () => new BusinessError(HttpStatus.CONFLICT, 'EMAIL_EXISTANT');
export const loginInvalid = () => new BusinessError(HttpStatus.BAD_REQUEST, 'LOGIN_INVALIDE');
export const emailInvalid = () => new BusinessError(HttpStatus.BAD_REQUEST, 'EMAIL_INVALIDE');
export const nameInvalid = () => new BusinessError(HttpStatus.BAD_REQUEST, 'NOM_INVALIDE');
/** Retrait du rôle ou suppression refusés : action sur soi (ADR-0018). */
export const accountActionRefused = (code: AccountActionRefusal) => new BusinessError(HttpStatus.FORBIDDEN, code);

/** Vrai si l'erreur PostgreSQL est la violation de l'index d'unicité nommé. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, constraint: name } = error as { code?: unknown; constraint?: unknown };
  return code === '23505' && name === constraint;
}
