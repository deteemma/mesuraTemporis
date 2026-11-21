import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  reportRangeSchema,
  type DailySummaryDto,
  type MyProjectsDto,
  type ReportDto,
  type ReportRangeInput,
  reportExportFileName,
} from '@app/shared';
import { type AuthenticatedUser, CurrentUser } from '../auth/authenticated-user.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { buildReportWorkbook, XLSX_CONTENT_TYPE } from './report-workbook.js';
import { ReportsService } from './reports.service.js';

/**
 * Restitution (contrat d'API, #11). Mes projets et synthèse journalière : soi
 * seul, Administrateur compris. Rapport et export Excel : Administrateur, tout
 * le monde ; sinon soi.
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

  /** Export Excel du Rapport (#23) : mêmes lignes et mêmes droits que `range`. */
  @Get('range/export')
  async exportRange(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(reportRangeSchema, 'PLAGE_DATES_REQUISE')) range: ReportRangeInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const workbook = await buildReportWorkbook(await this.reports.report(user, range));
    reply.header('Content-Disposition', `attachment; filename="${reportExportFileName(range)}"`);
    return new StreamableFile(workbook, { type: XLSX_CONTENT_TYPE });
  }

  /** Synthèse journalière ; `day` (AAAA-MM-JJ) absent ou illisible : la Journée en cours. */
  @Get('daily')
  daily(@CurrentUser() user: AuthenticatedUser, @Query('day') day?: string): Promise<DailySummaryDto> {
    return this.reports.dailySummary(user, typeof day === 'string' ? day : undefined);
  }
}
