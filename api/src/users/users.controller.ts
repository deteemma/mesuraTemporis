import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import {
  createUserSchema,
  type CreateUserInput,
  updateUserEmailSchema,
  type UpdateUserEmailInput,
  type UserDto,
  type UserImpactDto,
  type UserListDto,
} from '@app/shared';
import { type AuthenticatedUser, CurrentUser, RequireAdmin } from '../auth/authenticated-user.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { UsersService } from './users.service.js';

/** Écran Utilisateurs (ADR-0018) : réservé à l'Administrateur. */
@Controller('users')
@RequireAdmin()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<UserListDto> {
    return this.users.list(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createUserSchema, 'LOGIN_REQUIS')) input: CreateUserInput,
  ): Promise<UserDto> {
    return this.users.create(user, input);
  }

  /** Seul l'Email se modifie ; Login et Nom, non (#11). */
  @Put(':userId/email')
  @HttpCode(HttpStatus.NO_CONTENT)
  changeEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(updateUserEmailSchema, 'EMAIL_REQUIS')) input: UpdateUserEmailInput,
  ): Promise<void> {
    return this.users.changeEmail(user, userId, input.email);
  }

  /** Lecture d'impact avant suppression (dialogue chiffré). */
  @Get(':userId/impact')
  impact(@CurrentUser() user: AuthenticatedUser, @Param('userId') userId: string): Promise<UserImpactDto> {
    return this.users.impact(user, userId);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('userId') userId: string): Promise<void> {
    return this.users.remove(user, userId);
  }
}
