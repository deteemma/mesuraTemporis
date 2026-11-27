import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import type { DeactivationImpactDto, IdentityProviderDto } from '@app/shared';
import { type AuthenticatedUser, CurrentUser, RequireAdmin } from '../auth/authenticated-user.js';
import { IdentityProvidersService } from './identity-providers.service.js';

/**
 * Écran « Connexions » (ADR-0029, #35) : réservé à l'Administrateur. Un
 * fournisseur est désigné par son alias Keycloak (google, microsoft).
 */
@Controller('identity-providers')
@RequireAdmin()
export class IdentityProvidersController {
  constructor(private readonly providers: IdentityProvidersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<IdentityProviderDto[]> {
    return this.providers.list(user);
  }

  /** Ce qu'annonce la confirmation d'une désactivation. */
  @Get(':alias/impact')
  impact(@CurrentUser() user: AuthenticatedUser, @Param('alias') alias: string): Promise<DeactivationImpactDto> {
    return this.providers.deactivationImpact(user, alias);
  }

  @Put(':alias/enabled')
  @HttpCode(HttpStatus.NO_CONTENT)
  enable(@CurrentUser() user: AuthenticatedUser, @Param('alias') alias: string): Promise<void> {
    return this.providers.setEnabled(user, alias, true);
  }

  @Delete(':alias/enabled')
  @HttpCode(HttpStatus.NO_CONTENT)
  disable(@CurrentUser() user: AuthenticatedUser, @Param('alias') alias: string): Promise<void> {
    return this.providers.setEnabled(user, alias, false);
  }
}
