import { Controller, Get, Query } from '@nestjs/common';
import {
  reportRangeSchema,
  type DailySummaryDto,
  type MyProjectsDto,
  type ReportDto,
  type ReportRangeInput,
} from '@app/shared';
import { type AuthenticatedUser, CurrentUser } from '../auth/authenticated-user.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { ReportsService } from './reports.service.js';

/**
 * Restitution (contrat d'API, #11). Mes projets et synthèse journalière : soi
 * seul, Administrateur compris. Rapport : Administrateur, tout le monde ;
 * sinon soi.
 */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('projects')
  myProjects(@CurrentUser() user: AuthenticatedUser): Promise<MyProjectsDto> {
    return this.reports.myProjects(user);
  }

  /** Rapport sur `from`..`to` (AAAA-MM-JJ, bornes incluses) ; l'une absente : 400 `PLAGE_DATES_REQUISE`. */
  @Get('range')
  range(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(reportRangeSchema, 'PLAGE_DATES_REQUISE')) range: ReportRangeInput,
  ): Promise<ReportDto> {
    return this.reports.report(user, range);
  }

  /** Synthèse journalière ; `day` (AAAA-MM-JJ) absent ou illisible : la Journée en cours. */
  @Get('daily')
  daily(@CurrentUser() user: AuthenticatedUser, @Query('day') day?: string): Promise<DailySummaryDto> {
    return this.reports.dailySummary(user, typeof day === 'string' ? day : undefined);
  }
}
