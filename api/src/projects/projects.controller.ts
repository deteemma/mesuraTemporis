import { Controller, Get, Param } from '@nestjs/common';
import type { ProjectSummaryDto } from '@app/shared';
import { type AuthenticatedUser, CurrentUser } from '../auth/authenticated-user.js';
import { RequireProjectAccess } from './project-access.guard.js';
import { ProjectsService } from './projects.service.js';

// Lecture seule pour l'instant : création, suppression et équipe arrivent avec
// l'écran Projets (#14). Personne ne renomme un Projet (#11).
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<ProjectSummaryDto[]> {
    return this.projects.list(user);
  }

  @Get(':projectId')
  @RequireProjectAccess('viewProject')
  get(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string): Promise<ProjectSummaryDto> {
    return this.projects.get(user, projectId);
  }
}
