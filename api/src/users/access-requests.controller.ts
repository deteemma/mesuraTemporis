import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { AccessRequestListDto } from '@app/shared';
import { type AuthenticatedUser, CurrentUser, RequireAdmin } from '../auth/authenticated-user.js';
import { AccessRequestsService } from './access-requests.service.js';

/**
 * Demandes d'accès de l'écran Utilisateurs (ADR-0028, #32) : réservées à
 * l'Administrateur. L'identifiant d'une demande est celui du compte de la
 * personne.
 */
@Controller('access-requests')
@RequireAdmin()
export class AccessRequestsController {
  constructor(private readonly requests: AccessRequestsService) {}

  /** En attente et refusées ; le compteur du menu est le nombre en attente. */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<AccessRequestListDto> {
    return this.requests.list(user);
  }

  @Post(':requestId/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  accept(@CurrentUser() user: AuthenticatedUser, @Param('requestId') requestId: string): Promise<void> {
    return this.requests.accept(user, requestId);
  }

  @Post(':requestId/refuse')
  @HttpCode(HttpStatus.NO_CONTENT)
  refuse(@CurrentUser() user: AuthenticatedUser, @Param('requestId') requestId: string): Promise<void> {
    return this.requests.refuse(user, requestId);
  }

  @Delete(':requestId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('requestId') requestId: string): Promise<void> {
    return this.requests.remove(user, requestId);
  }
}
