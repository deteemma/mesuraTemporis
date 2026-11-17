import { Controller, Get } from '@nestjs/common';
import type { UserSummaryDto } from '@app/shared';
import { type AuthenticatedUser, CurrentUser, RequireAdmin } from '../auth/authenticated-user.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequireAdmin()
  list(@CurrentUser() user: AuthenticatedUser): Promise<UserSummaryDto[]> {
    return this.users.list(user);
  }
}
