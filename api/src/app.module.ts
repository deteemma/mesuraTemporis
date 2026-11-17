import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ActivitiesController } from './activities/activities.controller.js';
import { ActivitiesService } from './activities/activities.service.js';
import { AuthGuard } from './auth/auth.guard.js';
import { OidcVerifier } from './auth/oidc-verifier.service.js';
import { AppConfig } from './config/app-config.js';
import { DatabaseService } from './db/database.service.js';
import { HealthController } from './health/health.controller.js';
import { ProjectsController } from './projects/projects.controller.js';
import { ProjectAccessGuard } from './projects/project-access.guard.js';
import { ProjectsService } from './projects/projects.service.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';

@Module({
  controllers: [HealthController, ProjectsController, ActivitiesController, UsersController],
  providers: [
    { provide: AppConfig, useFactory: () => new AppConfig() },
    DatabaseService,
    OidcVerifier,
    UsersService,
    ProjectsService,
    ActivitiesService,
    ProjectAccessGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
