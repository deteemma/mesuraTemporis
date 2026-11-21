import { Controller, Get } from '@nestjs/common';
import type { MyProjectsDto } from '@app/shared';
import { type AuthenticatedUser, CurrentUser } from '../auth/authenticated-user.js';
import { ReportsService } from './reports.service.js';

/** Restitution (contrat d'API, #11). Mes projets : soi seul, Administrateur compris. */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('projects')
  myProjects(@CurrentUser() user: AuthenticatedUser): Promise<MyProjectsDto> {
    return this.reports.myProjects(user);
  }
}
