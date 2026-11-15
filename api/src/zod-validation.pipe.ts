import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { isErrorCode, type ErrorCode } from '@app/shared';
import type { z } from 'zod';
import { BusinessError } from './errors.js';

/**
 * Valide un corps de requête avec un schéma de @app/shared. Le refus porte le
 * Code d'erreur que le schéma donne comme message (ADR-0021), ou `fallback`.
 */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(
    private readonly schema: S,
    private readonly fallback: ErrorCode,
  ) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const message = result.error.issues[0]?.message;
      throw new BusinessError(HttpStatus.BAD_REQUEST, isErrorCode(message) ? message : this.fallback);
    }
    return result.data;
  }
}
