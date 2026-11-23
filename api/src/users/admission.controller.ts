import { Controller, Get } from '@nestjs/common';
import type { AdmissionDto } from '@app/shared';
import { AllowPending, CurrentAdmission } from '../auth/authenticated-user.js';

/**
 * Admission de la personne connectée (ADR-0028) : le web y lit, au démarrage,
 * s'il affiche l'application ou la page d'attente. Seule route ouverte à la
 * personne en attente.
 */
@Controller('admission')
export class AdmissionController {
  @Get()
  @AllowPending()
  admission(@CurrentAdmission() admission: AdmissionDto): AdmissionDto {
    return admission;
  }
}
