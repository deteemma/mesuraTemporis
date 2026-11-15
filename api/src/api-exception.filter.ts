import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { errorBody } from '@app/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type {} from '@fastify/static'; // ajoute reply.sendFile

/**
 * Filtre unique des exceptions :
 * - l'API sert aussi l'application web compilée : toute adresse inconnue hors
 *   de /api renvoie index.html, et le routeur React prend le relais ;
 * - un refus métier garde son corps `{ code, message }` (ADR-0021) ; un 403
 *   sans code devient `ACCES_REFUSE` ;
 * - toute erreur imprévue devient 500 `ERREUR_INTERNE`, détail au journal.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  constructor(private readonly webEnabled: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (!(exception instanceof HttpException)) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
      void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send(errorBody('ERREUR_INTERNE'));
      return;
    }

    const status = exception.getStatus();
    if (
      status === HttpStatus.NOT_FOUND &&
      this.webEnabled &&
      request.method === 'GET' &&
      !request.url.startsWith('/api')
    ) {
      void reply.type('text/html').sendFile('index.html');
      return;
    }
    const body = exception.getResponse();
    const hasCode = typeof body === 'object' && body !== null && 'code' in body;
    if (status === HttpStatus.FORBIDDEN && !hasCode) {
      void reply.status(status).send(errorBody('ACCES_REFUSE'));
      return;
    }
    void reply.status(status).send(body);
  }
}
