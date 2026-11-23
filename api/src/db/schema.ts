// Types Kysely des tables (voir api/migrations). À tenir à jour avec les migrations.
import type { ColumnType, Generated } from 'kysely';
import type { ProjectRole } from '@app/shared';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface AppUserTable {
  id: string;
  login: string;
  email: string | null;
  display_name: string | null;
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
  status: Generated<'pending'>;
  created_at: Generated<Date>;
}

export interface Database {
  app_user: AppUserTable;
  access_request: AccessRequestTable;
  project: ProjectTable;
  project_member: ProjectMemberTable;
  activity: ActivityTable;
  time_entry: TimeEntryTable;
}
