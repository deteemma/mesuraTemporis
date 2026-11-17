import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  createActivitySchema,
  renameActivitySchema,
  type ActivityDto,
  type ActivityImpactDto,
  type CreateActivityInput,
  type RenameActivityInput,
} from '@app/shared';
import { type AuthenticatedUser, CurrentUser } from '../auth/authenticated-user.js';
import { RequireProjectAccess } from '../projects/project-access.guard.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { ActivitiesService } from './activities.service.js';

/**
 * Activités d'un Projet (contrat d'API, #11). Lister et renommer : Administrateur
 * ou Affecté (ADR-0015) ; créer hors Chronomètre, supprimer et lire l'impact :
 * Administrateur (403 `ACCES_REFUSE` sinon). Un non-affecté reçoit 404.
 */
@Controller('projects/:projectId/activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  @RequireProjectAccess('listActivities')
  list(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string): Promise<ActivityDto[]> {
    return this.activities.list(user, projectId);
  }

  @Post()
  @RequireProjectAccess('createActivity')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createActivitySchema, 'NOM_REQUIS')) input: CreateActivityInput,
  ): Promise<ActivityDto> {
    return this.activities.create(user, projectId, input);
  }

  @Patch(':activityId')
  @RequireProjectAccess('renameActivity')
  rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('activityId') activityId: string,
    @Body(new ZodValidationPipe(renameActivitySchema, 'NOM_REQUIS')) input: RenameActivityInput,
  ): Promise<ActivityDto> {
    return this.activities.rename(user, projectId, activityId, input);
  }

  @Delete(':activityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireProjectAccess('deleteActivity')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('activityId') activityId: string,
  ): Promise<void> {
    return this.activities.remove(user, projectId, activityId);
  }

  /** Lecture d'impact avant suppression (dialogue chiffré). */
  @Get(':activityId/impact')
  @RequireProjectAccess('deleteActivity')
  impact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('activityId') activityId: string,
  ): Promise<ActivityImpactDto> {
    return this.activities.impact(user, projectId, activityId);
  }
}
