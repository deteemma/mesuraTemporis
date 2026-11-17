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
