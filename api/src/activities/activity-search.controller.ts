import { Controller, Get, Query } from '@nestjs/common';
import type { ActivitySearchResultDto } from '@app/shared';
import { type AuthenticatedUser, CurrentUser } from '../auth/authenticated-user.js';
import { ActivitiesService } from './activities.service.js';

/** Recherche combinée Activité→Projet de la Saisie de temps (ADR-0014), ouverte à tout Utilisateur. */
@Controller('activities')
export class ActivitySearchController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get('search')
  search(@CurrentUser() user: AuthenticatedUser, @Query('q') q: unknown): Promise<ActivitySearchResultDto[]> {
    return this.activities.search(user, typeof q === 'string' ? q : '');
  }
}
