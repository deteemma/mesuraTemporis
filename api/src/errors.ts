import { HttpException, HttpStatus } from '@nestjs/common';
import { errorBody, type ErrorCode } from '@app/shared';

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
