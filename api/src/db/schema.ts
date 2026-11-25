// Types Kysely des tables (voir api/migrations). À tenir à jour avec les migrations.
import type { ColumnType, Generated } from 'kysely';
import type { AccessRequestStatus, ProjectRole } from '@app/shared';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface AppUserTable {
  id: string;
  login: string;
  email: string | null;
  display_name: string | null;
  /** Acceptation de la Demande d'accès dont l'Utilisateur est né (ADR-0028). */
  accepted_by: ColumnType<string | null, string | null | undefined, never>;
  accepted_by_name: ColumnType<string | null, string | null | undefined, never>;
  accepted_at: ColumnType<Date | null, Date | string | null | undefined, never>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProjectTable {
  id: string;
  name: string;
  status: Generated<string>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProjectMemberTable {
  project_id: string;
  user_id: string;
  role: Generated<ProjectRole>;
  created_at: Timestamp;
}

export interface ActivityTable {
  id: string;
  project_id: string;
  name: string;
  normalized_name: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TimeEntryTable {
  id: string;
  user_id: string;
  project_id: string;
  activity_id: string;
  started_at: ColumnType<Date, Date | string, Date | string>;
  ended_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

/** Demande d'accès (ADR-0028). */
export interface AccessRequestTable {
  account_id: string;
  email: string | null;
  display_name: string | null;
  provider: string;
  status: Generated<AccessRequestStatus>;
  created_at: Generated<Date>;
  /** Refus : l'Administrateur (identifiant, et Nom ou Login au moment du refus) et sa date. */
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface Database {
  app_user: AppUserTable;
  access_request: AccessRequestTable;
  project: ProjectTable;
  project_member: ProjectMemberTable;
  activity: ActivityTable;
  time_entry: TimeEntryTable;
}
