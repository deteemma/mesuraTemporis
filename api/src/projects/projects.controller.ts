import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import {
  createProjectSchema,
  type CreateProjectInput,
  type ProjectImpactDto,
  type ProjectSummaryDto,
  type UserSummaryDto,
} from '@app/shared';
import { type AuthenticatedUser, CurrentUser, RequireAdmin } from '../auth/authenticated-user.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { RequireProjectAccess } from './project-access.guard.js';
import { ProjectsService } from './projects.service.js';

// Personne ne renomme un Projet (#11) : pas de route de modification.
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<ProjectSummaryDto[]> {
    return this.projects.list(user);
  }

  @Post()
  @RequireAdmin()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createProjectSchema, 'NOM_REQUIS')) input: CreateProjectInput,
  ): Promise<ProjectSummaryDto> {
    return this.projects.create(user, input);
  }

  @Get(':projectId')
  @RequireProjectAccess('viewProject')
  get(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string): Promise<ProjectSummaryDto> {
    return this.projects.get(user, projectId);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireProjectAccess('deleteProject')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string): Promise<void> {
    return this.projects.remove(user, projectId);
  }

  /** Lecture d'impact avant suppression (dialogue chiffré). */
  @Get(':projectId/impact')
  @RequireProjectAccess('deleteProject')
  impact(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string): Promise<ProjectImpactDto> {
    return this.projects.impact(user, projectId);
  }

  @Get(':projectId/members')
  @RequireProjectAccess('manageTeam')
  members(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string): Promise<UserSummaryDto[]> {
    return this.projects.members(user, projectId);
  }

  @Put(':projectId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireProjectAccess('manageTeam')
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.projects.assign(user, projectId, userId);
  }

  @Delete(':projectId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireProjectAccess('manageTeam')
  unassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.projects.unassign(user, projectId, userId);
  }
}
