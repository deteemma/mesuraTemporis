import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  inlineEditSchema,
  manualEntrySchema,
  startTimerSchema,
  type EditedTimeEntryDto,
  type HistoryPageDto,
  type InlineEditInput,
  type ManualEntryInput,
  type StartTimerInput,
  type StartedTimerDto,
  type TimeEntryDto,
  type TimerStatusDto,
} from '@app/shared';
import { type AuthenticatedUser, CurrentUser } from '../auth/authenticated-user.js';
import { RequireProjectAccess } from '../projects/project-access.guard.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { TimeEntriesService } from './time-entries.service.js';

const manualEntryCheck = { schema: manualEntrySchema, fallback: 'IMPUTATION_CHAMPS_REQUIS' } as const;

/**
 * Chronomètre et Imputations de la Journée (contrat d'API, #11). Démarrer exige
 * l'accès au Projet du corps (Administrateur ou Affecté, sinon 404
 * `PROJET_INTROUVABLE`), tout comme la Saisie manuelle ; le reste ne porte que sur ses propres Imputations,
 * sauf l'Édition à la volée et la suppression, ouvertes à l'Administrateur sur toutes.
 */
@Controller('time-entries')
export class TimeEntriesController {
  constructor(private readonly timeEntries: TimeEntriesService) {}

  @Get('timer')
  timer(@CurrentUser() user: AuthenticatedUser): Promise<TimerStatusDto> {
    return this.timeEntries.timer(user);
  }

  @Post('timer/start')
  @RequireProjectAccess('startTimer')
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(startTimerSchema, 'ACTIVITE_INTROUVABLE')) input: StartTimerInput,
  ): Promise<StartedTimerDto> {
    return this.timeEntries.start(user, input);
  }

  @Post('timer/stop')
  @HttpCode(HttpStatus.OK)
  stop(@CurrentUser() user: AuthenticatedUser): Promise<TimeEntryDto> {
    return this.timeEntries.stop(user);
  }

  /**
   * Saisie manuelle, pour soi : les champs manquants (400) et la fin avant le
   * début (400, E2) sont refusés avant le contrôle d'accès au Projet (404).
   */
  @Post()
  @RequireProjectAccess('addManualEntry', manualEntryCheck)
  addManual(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(manualEntryCheck.schema, manualEntryCheck.fallback)) input: ManualEntryInput,
  ): Promise<TimeEntryDto> {
    return this.timeEntries.addManual(user, input);
  }

  @Get('today')
  today(@CurrentUser() user: AuthenticatedUser): Promise<TimeEntryDto[]> {
    return this.timeEntries.today(user);
  }

  /** Historique paginé des Journées précédentes ; `before` : Journée de début de la page (curseur). */
  @Get('history')
  history(@CurrentUser() user: AuthenticatedUser, @Query('before') before?: string): Promise<HistoryPageDto> {
    return this.timeEntries.history(user, typeof before === 'string' ? before : undefined);
  }

  /** Édition à la volée ; renvoie l'éventuelle Imputation issue de la Scission. */
  @Patch(':id')
  edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(inlineEditSchema, 'IMPUTATION_CHAMPS_REQUIS')) input: InlineEditInput,
  ): Promise<EditedTimeEntryDto> {
    return this.timeEntries.edit(user, id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.timeEntries.remove(user, id);
  }
}
