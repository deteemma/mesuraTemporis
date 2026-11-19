import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  inlineEditSchema,
  startTimerSchema,
  type EditedTimeEntryDto,
  type InlineEditInput,
  type StartTimerInput,
  type StartedTimerDto,
  type TimeEntryDto,
  type TimerStatusDto,
} from '@app/shared';
import { type AuthenticatedUser, CurrentUser } from '../auth/authenticated-user.js';
import { RequireProjectAccess } from '../projects/project-access.guard.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { TimeEntriesService } from './time-entries.service.js';

/**
 * Chronomètre et Imputations de la Journée (contrat d'API, #11). Démarrer exige
 * l'accès au Projet du corps (Administrateur ou Affecté, sinon 404
 * `PROJET_INTROUVABLE`) ; le reste ne porte que sur ses propres Imputations,
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

  @Get('today')
  today(@CurrentUser() user: AuthenticatedUser): Promise<TimeEntryDto[]> {
    return this.timeEntries.today(user);
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
