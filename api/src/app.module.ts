import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountDirectory } from './accounts/account-directory.service.js';
import { ActivitiesController } from './activities/activities.controller.js';
import { ActivitiesService } from './activities/activities.service.js';
import { ActivitySearchController } from './activities/activity-search.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { OidcVerifier } from './auth/oidc-verifier.service.js';
import { AppConfig } from './config/app-config.js';
import { DatabaseService } from './db/database.service.js';
import { HealthController } from './health/health.controller.js';
import { IdentityProvidersController } from './identity-providers/identity-providers.controller.js';
import { IdentityProvidersService } from './identity-providers/identity-providers.service.js';
import { ProjectsController } from './projects/projects.controller.js';
import { ProjectAccessGuard } from './projects/project-access.guard.js';
import { ProjectsService } from './projects/projects.service.js';
import { ReportsController } from './reports/reports.controller.js';
import { ReportsService } from './reports/reports.service.js';
import { TimeEntriesController } from './time-entries/time-entries.controller.js';
import { TimeEntriesService } from './time-entries/time-entries.service.js';
import { AccessRequestsController } from './users/access-requests.controller.js';
import { AccessRequestsService } from './users/access-requests.service.js';
import { AdmissionController } from './users/admission.controller.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';

@Module({
  controllers: [
    HealthController,
    ProjectsController,
    ActivitiesController,
    ActivitySearchController,
    TimeEntriesController,
    ReportsController,
    UsersController,
    AdmissionController,
    AccessRequestsController,
    IdentityProvidersController,
  ],
  providers: [
    { provide: AppConfig, useFactory: () => new AppConfig() },
    DatabaseService,
    AccountDirectory,
    OidcVerifier,
    UsersService,
    AccessRequestsService,
    IdentityProvidersService,
    ProjectsService,
    ActivitiesService,
    TimeEntriesService,
    ReportsService,
    ProjectAccessGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
