// Schémas de validation partagés par l'API et le web.
// Le message d'erreur d'un schéma est un Code d'erreur du catalogue (ADR-0021) :
// l'API le renvoie tel quel dans le corps `{ code, message }` du refus.
import { z } from 'zod';
import type { DailySummary } from './daily-summary.js';
import { isDay } from './day.js';
import type { ErrorCode } from './error-codes.js';
import type { HistoryPage } from './history.js';
import type { MyProjectsSummary } from './my-projects.js';
import type { Report } from './report.js';
import type { ProjectRole } from './roles.js';

const code = (value: ErrorCode) => ({ error: value });

/** Nom de Projet : requis, pas fait que d'espaces, sans limite de longueur (#11, E26). */
export const projectNameSchema = z.string(code('NOM_REQUIS')).trim().min(1, code('NOM_REQUIS'));

/** Création de Projet : son nom seul (#11). */
export const createProjectSchema = z.object({
  // Envoyé par le mobile hors ligne (hors périmètre, non modifié, voir
  // mobile/src/powersync.ts) ; généré par l'API sinon.
  id: z.uuid().optional(),
  name: projectNameSchema,
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/** Projet tel que renvoyé par l'API ; `status` vaut `'active'`, affiché « actif » (badge repris de la source). */
export interface ProjectSummaryDto {
  id: string;
  name: string;
  status: string;
  createdAt: string;
}

/** Nom d'Activité : mêmes règles que le nom de Projet (E26). */
export const activityNameSchema = projectNameSchema;

/** Création d'une Activité hors Chronomètre par l'Administrateur (écran Activités du Projet). */
export const createActivitySchema = z.object({ name: activityNameSchema });
export type CreateActivityInput = z.infer<typeof createActivitySchema>;

/** Renommage d'une Activité, ouvert à tout Affecté (ADR-0015). */
export const renameActivitySchema = z.object({ name: activityNameSchema });
export type RenameActivityInput = z.infer<typeof renameActivitySchema>;

/** Activité telle que renvoyée par l'API. */
export interface ActivityDto {
  id: string;
  projectId: string;
  name: string;
}

/** Lecture d'impact avant la suppression d'une Activité (dialogue chiffré, E18). */
export interface ActivityImpactDto {
  timeEntries: number;
}

/** Paire « Activité — Projet » renvoyée par la recherche combinée (ADR-0014). */
export interface ActivitySearchResultDto {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
}

/**
 * Démarrage d'un Chronomètre : sur une Activité existante du Projet, ou sur un
 * nouveau nom (l'Activité de même nom normalisé est réutilisée, sinon créée).
 * Sans l'un ni l'autre, l'API répond 404 `ACTIVITE_INTROUVABLE` (la source échouait
 * alors en erreur interne).
 */
export const startTimerSchema = z.object({
  projectId: z.string(code('PROJET_INTROUVABLE')),
  activityId: z.string(code('ACTIVITE_INTROUVABLE')).optional(),
  newActivityName: activityNameSchema.optional(),
});
export type StartTimerInput = z.infer<typeof startTimerSchema>;

/**
 * Imputation telle que renvoyée par l'API, avec les noms de son Projet et de
 * son Activité (toujours lisibles par son Auteur, même retiré du Projet).
 * `endedAt` vide : c'est le Chronomètre.
 */
export interface TimeEntryDto {
  id: string;
  userId: string;
  projectId: string;
  projectName: string;
  activityId: string;
  activityName: string;
  startedAt: string;
  endedAt: string | null;
}

/** État du Chronomètre de l'Utilisateur courant. */
export interface TimerStatusDto {
  timer: TimeEntryDto | null;
}

/** Chronomètre démarré, et le précédent qu'il a arrêté dans la même transaction. */
export interface StartedTimerDto {
  timer: TimeEntryDto;
  previousTimerStopped: TimeEntryDto | null;
}

const instantSchema = z.iso.datetime({ offset: true, ...code('IMPUTATION_CHAMPS_REQUIS') });

/**
 * Édition à la volée : le début, la fin, ou les deux (ADR-0013). L'interface
 * met les secondes à zéro ; l'API ne l'impose pas (#11, note 8).
 */
export const inlineEditSchema = z.object({
  startedAt: instantSchema.optional(),
  endedAt: instantSchema.optional(),
});
export type InlineEditInput = z.infer<typeof inlineEditSchema>;

const requiredText = z.string(code('IMPUTATION_CHAMPS_REQUIS')).min(1, code('IMPUTATION_CHAMPS_REQUIS'));

/**
 * Saisie manuelle : une Imputation terminée, sur une Activité du Projet. La fin
 * peut tomber un autre jour que le début : la saisie qui franchit minuit est
 * acceptée telle quelle, sans Scission, et appartient à la Journée de son début
 * (ADR-0012). Une fin avant le début est refusée (E2) ; une fin égale au début,
 * non. L'interface saisit à la minute ; l'API ne l'impose pas.
 */
export const manualEntrySchema = z
  .object({
    projectId: requiredText,
    activityId: requiredText,
    startedAt: instantSchema,
    endedAt: instantSchema,
  })
  .refine((entry) => new Date(entry.endedAt) >= new Date(entry.startedAt), {
    ...code('IMPUTATION_FIN_AVANT_DEBUT'),
    path: ['endedAt'],
  });
export type ManualEntryInput = z.infer<typeof manualEntrySchema>;

/**
 * Page de l'historique des Journées précédentes : Imputations terminées
 * regroupées par Journée puis par Projet/Activité ; `nextCursor` se passe en
 * paramètre `before` pour charger la page suivante.
 */
export type HistoryPageDto = HistoryPage<TimeEntryDto>;

/** Mes projets (ADR-0016) : Durées totales de l'Utilisateur courant par Projet puis par Activité. */
export type MyProjectsDto = MyProjectsSummary;

const reportDaySchema = z.string(code('PLAGE_DATES_REQUISE')).refine(isDay, code('PLAGE_DATES_REQUISE'));

/**
 * Plage du Rapport : « Du » et « Au », Journées AAAA-MM-JJ, bornes incluses,
 * sans limite de durée. Les deux sont requises, comme dans la source :
 * l'interface envoie « Au » = « Du » quand « Au » est vide. Une plage inversée
 * est acceptée et donne un Rapport vide.
 */
export const reportRangeSchema = z.object({ from: reportDaySchema, to: reportDaySchema });
export type ReportRangeInput = z.infer<typeof reportRangeSchema>;

/** Rapport sur une plage (Administrateur : tous les Utilisateurs ; sinon soi). */
export type ReportDto = Report;

/** Synthèse journalière de l'Utilisateur courant (API seulement, #11 note 2). */
export type DailySummaryDto = DailySummary;

/** Imputation éditée, et celle que la Scission a créée sur l'autre Journée, s'il y en a une. */
export interface EditedTimeEntryDto {
  entry: TimeEntryDto;
  split: TimeEntryDto | null;
}

const requiredTrimmed = (value: ErrorCode) => z.string(code(value)).trim().min(1, code(value));

/** Email d'un Utilisateur : obligatoire, à la création comme à la modification (ADR-0018). */
export const userEmailSchema = requiredTrimmed('EMAIL_REQUIS');

/**
 * Création d'un Utilisateur par l'Administrateur (ADR-0018) : Login et Email
 * obligatoires, Nom facultatif (vide = pas de Nom), case « Administrateur ».
 * Le mot de passe temporaire est le Login : il ne se saisit pas.
 */
export const createUserSchema = z.object({
  login: requiredTrimmed('LOGIN_REQUIS'),
  name: z
    .string()
    .trim()
    .optional()
    .transform((name) => name || null),
  email: userEmailSchema,
  isAdmin: z.boolean().default(false),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/** Modification de l'Email ; Login et Nom ne se modifient pas (#11). */
export const updateUserEmailSchema = z.object({ email: userEmailSchema });
export type UpdateUserEmailInput = z.infer<typeof updateUserEmailSchema>;

/** Utilisateur de l'écran Utilisateurs ; `isAdmin` vient de l'Annuaire des comptes. */
export interface UserDto {
  id: string;
  login: string;
  name: string | null;
  email: string | null;
  isAdmin: boolean;
}

/** Écran Utilisateurs : tous les Utilisateurs par Login, et combien n'ont aucune affectation. */
export interface UserListDto {
  users: UserDto[];
  withoutProject: number;
}

/** Lecture d'impact avant la suppression d'un Utilisateur (dialogue chiffré, E18). */
export interface UserImpactDto {
  timeEntries: number;
}

/** Utilisateur tel que proposé à l'affectation et listé dans une équipe (par Login). */
export interface UserSummaryDto {
  id: string;
  login: string;
}

/** Lecture d'impact avant la suppression d'un Projet (dialogue chiffré, E18). */
export interface ProjectImpactDto {
  activities: number;
  timeEntries: number;
}

/** Configuration publique servie par l'API à /api/config (web et mobile). */
export interface PublicConfigDto {
  oidcIssuerUrl: string;
  webClientId: string;
  mobileClientId: string;
  powersyncUrl: string | null;
}

// --- Contrat de l'ancienne entité d'exemple, encore lu par le mobile ----------
// Le mobile est hors périmètre et n'est pas modifié (#11) : ces types ne servent
// qu'à sa compilation. Aucune route de l'API ne les produit plus. À retirer avec
// la phase mobile.

/** @deprecated Mobile seulement : personne ne renomme un Projet (#11). */
export interface UpdateProjectInput {
  name: string;
}

/** @deprecated Mobile seulement : remplacé par `ProjectSummaryDto`. */
export interface ProjectDto {
  id: string;
  name: string;
  createdAt: string;
  myRole: ProjectRole;
}
