import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMyProjects } from './my-projects.js';

const projects = { alpha: 'Projet Alpha', beta: 'Projet Beta' } as const;
const activities = { dev: 'Développement', doc: 'Documentation', support: 'Support' } as const;

const entry = (
  projectId: keyof typeof projects,
  activityId: keyof typeof activities,
  startedAt: string,
  endedAt: string | null,
) => ({
  projectId,
  projectName: projects[projectId],
  activityId,
  activityName: activities[activityId],
  startedAt,
  endedAt,
});

test('la Durée totale est regroupée par Projet puis par Activité, cumulée sur plusieurs Journées', () => {
  const summary = summarizeMyProjects(
    [
      entry('alpha', 'dev', '2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z'),
      entry('alpha', 'dev', '2026-01-06T09:00:00.000Z', '2026-01-06T09:30:00.000Z'),
    ],
    ['alpha'],
  );

  assert.deepEqual(summary, {
    projects: [
      {
        projectId: 'alpha',
        projectName: 'Projet Alpha',
        totalSeconds: 5400,
        activities: [{ activityId: 'dev', activityName: 'Développement', totalSeconds: 5400 }],
      },
    ],
    totalSeconds: 5400,
  });
});

test('un Projet où l’Utilisateur n’est plus Affecté disparaît, avec ses Activités et sa Durée totale', () => {
  const summary = summarizeMyProjects(
    [
      entry('alpha', 'dev', '2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z'),
      entry('beta', 'support', '2026-01-06T09:00:00.000Z', '2026-01-06T09:45:00.000Z'),
    ],
    ['beta'],
  );

  assert.deepEqual(summary.projects.map((p) => p.projectId), ['beta']);
  assert.equal(summary.totalSeconds, 2700);
});

test('un Projet affecté sans Imputation terminée est absent ; sans rien, le total général est nul', () => {
  assert.deepEqual(summarizeMyProjects([], ['alpha']), { projects: [], totalSeconds: 0 });
});

test('le Chronomètre en cours n’est compté dans aucune Durée totale', () => {
  const summary = summarizeMyProjects(
    [
      entry('alpha', 'dev', '2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z'),
      entry('alpha', 'dev', '2026-01-05T11:00:00.000Z', null),
      entry('alpha', 'doc', '2026-01-05T12:00:00.000Z', null),
    ],
    ['alpha'],
  );

  assert.equal(summary.totalSeconds, 3600);
  assert.equal(summary.projects[0]!.totalSeconds, 3600);
  assert.deepEqual(summary.projects[0]!.activities.map((a) => a.activityId), ['dev']);
});

test('le total général est la somme des Durées totales des Projets', () => {
  const summary = summarizeMyProjects(
    [
      entry('alpha', 'dev', '2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z'),
      entry('beta', 'support', '2026-01-06T09:00:00.000Z', '2026-01-06T09:45:00.000Z'),
      entry('alpha', 'doc', '2026-01-07T09:00:00.000Z', '2026-01-07T09:00:42.000Z'),
    ],
    ['alpha', 'beta'],
  );

  assert.deepEqual(summary.projects.map((p) => p.totalSeconds), [3642, 2700]);
  assert.deepEqual(summary.projects[0]!.activities.map((a) => a.totalSeconds), [3600, 42]);
  assert.equal(summary.totalSeconds, 6342);
});

test('Projets et Activités suivent le début de leur première Imputation (E23)', () => {
  const summary = summarizeMyProjects(
    [
      entry('beta', 'support', '2026-03-10T09:00:00.000Z', '2026-03-10T10:00:00.000Z'),
      entry('alpha', 'doc', '2026-03-09T09:00:00.000Z', '2026-03-09T10:00:00.000Z'),
      entry('beta', 'support', '2026-01-02T09:00:00.000Z', '2026-01-02T10:00:00.000Z'),
      entry('alpha', 'dev', '2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z'),
    ],
    ['alpha', 'beta'],
  );

  assert.deepEqual(
    summary.projects.map((p) => [p.projectId, p.activities.map((a) => a.activityId)]),
    [
      ['beta', ['support']],
      ['alpha', ['dev', 'doc']],
    ],
  );
});
