import { Injectable } from '@nestjs/common';
import type { ProjectSummaryDto } from '@app/shared';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { projectNotFound } from '../errors.js';

@Injectable()
export class ProjectsService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Projets visibles : tous pour l'Administrateur, sinon ceux où l'Utilisateur
   * est Affecté. Filtré ici sur l'affectation, pas seulement par la RLS : un
   * Projet quitté resterait visible en base par ses Imputations (#11).
   */
  list(user: AuthenticatedUser): Promise<ProjectSummaryDto[]> {
    return this.database.asUser(user, async (tx) => {
      let query = this.selectProjects(tx);
      if (!user.isAdmin) {
        query = query.where((eb) =>
          eb.exists(
            eb
              .selectFrom('project_member as m')
              .select('m.project_id')
              .whereRef('m.project_id', '=', 'p.id')
              .where('m.user_id', '=', user.id),
          ),
        );
      }
      const rows = await query.orderBy('p.created_at', 'desc').execute();
      return rows.map(toDto);
    });
  }

  /** Accès vérifié en amont par ProjectAccessGuard. */
  get(user: AuthenticatedUser, projectId: string): Promise<ProjectSummaryDto> {
    return this.database.asUser(user, async (tx) => {
      const row = await this.selectProjects(tx).where('p.id', '=', projectId).executeTakeFirst();
      if (!row) throw projectNotFound();
      return toDto(row);
    });
  }

  private selectProjects(tx: Tx) {
    return tx.selectFrom('project as p').select(['p.id', 'p.name', 'p.status', 'p.created_at']);
  }
}

function toDto(row: { id: string; name: string; status: string; created_at: Date }): ProjectSummaryDto {
  return { id: row.id, name: row.name, status: row.status, createdAt: row.created_at.toISOString() };
}
