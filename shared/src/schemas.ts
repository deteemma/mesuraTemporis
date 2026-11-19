// Schémas de validation partagés par l'API et le web.
// Le message d'erreur d'un schéma est un Code d'erreur du catalogue (ADR-0021) :
// l'API le renvoie tel quel dans le corps `{ code, message }` du refus.
import { z } from 'zod';
import type { ErrorCode } from './error-codes.js';
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

/** Projet tel que renvoyé par l'API (badge « actif » repris à l'identique). */
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

/** Imputation éditée, et celle que la Scission a créée sur l'autre Journée, s'il y en a une. */
export interface EditedTimeEntryDto {
  entry: TimeEntryDto;
  split: TimeEntryDto | null;
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
