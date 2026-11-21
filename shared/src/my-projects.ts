// Calcul de « Mes projets » (ADR-0016), reprise de la source
// (`calculerSyntheseParProjet`) : Durée totale de l'Utilisateur par Projet puis
// par Activité, toutes dates confondues. Seuls comptent les Projets où il est
// Affecté et les Imputations terminées (le Chronomètre en cours est exclu).
// Projets et Activités suivent le début de leur première Imputation (E23).
import { durationSeconds } from './durations.js';

/** Ce que le calcul lit d'une Imputation de l'Utilisateur courant. */
export interface MyProjectsEntry {
  projectId: string;
  projectName: string;
  activityId: string;
  activityName: string;
  startedAt: string;
  endedAt: string | null;
}

export interface MyProjectActivity {
  activityId: string;
  activityName: string;
  totalSeconds: number;
}

export interface MyProject {
  projectId: string;
  projectName: string;
  totalSeconds: number;
  activities: MyProjectActivity[];
}

export interface MyProjectsSummary {
  projects: MyProject[];
  /** Total général : somme des Durées totales des Projets affichés. */
  totalSeconds: number;
}

interface Ordered {
  firstStart: number;
}

const byFirstStart = (a: Ordered, b: Ordered) => a.firstStart - b.firstStart;

/**
 * Durées totales de l’Utilisateur courant. `assignedProjectIds` :
 * Projets où il est Affecté, Administrateur compris (un Projet quitté
 * disparaît, même avec des Imputations passées).
 */
export function summarizeMyProjects(
  entries: readonly MyProjectsEntry[],
  assignedProjectIds: Iterable<string>,
): MyProjectsSummary {
  const assigned = new Set(assignedProjectIds);
  const projects = new Map<
    string,
    Omit<MyProject, 'activities'> & Ordered & { activities: Map<string, MyProjectActivity & Ordered> }
  >();
  for (const entry of entries) {
    if (!entry.endedAt || !assigned.has(entry.projectId)) continue;
    const seconds = durationSeconds(entry.startedAt, entry.endedAt);
    const start = new Date(entry.startedAt).getTime();

    let project = projects.get(entry.projectId);
    if (!project) {
      project = { projectId: entry.projectId, projectName: entry.projectName, totalSeconds: 0, firstStart: start, activities: new Map() };
      projects.set(entry.projectId, project);
    }
    project.totalSeconds += seconds;
    project.firstStart = Math.min(project.firstStart, start);

    let activity = project.activities.get(entry.activityId);
    if (!activity) {
      activity = { activityId: entry.activityId, activityName: entry.activityName, totalSeconds: 0, firstStart: start };
      project.activities.set(entry.activityId, activity);
    }
    activity.totalSeconds += seconds;
    activity.firstStart = Math.min(activity.firstStart, start);
  }

  const result: MyProject[] = [...projects.values()].sort(byFirstStart).map((project) => ({
    projectId: project.projectId,
    projectName: project.projectName,
    totalSeconds: project.totalSeconds,
    activities: [...project.activities.values()].sort(byFirstStart).map(({ activityId, activityName, totalSeconds }) => ({
      activityId,
      activityName,
      totalSeconds,
    })),
  }));
  return { projects: result, totalSeconds: result.reduce((sum, project) => sum + project.totalSeconds, 0) };
}
