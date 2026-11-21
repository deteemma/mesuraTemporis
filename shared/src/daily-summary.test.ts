import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDay } from './daily-summary.js';

const projects = { alpha: 'Projet Alpha', beta: 'Projet Beta' } as const;
const activities = { dev: 'Développement', support: 'Support' } as const;

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

test('la synthèse journalière regroupe le temps par Projet et Activité, en excluant le Chronomètre en cours', () => {
  // Jeu de la source (rapportJournalier.test.js) : 1 h + 30 min, puis un Chronomètre.
  const summary = summarizeDay(
    [
      entry('alpha', 'dev', '2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z'),
      entry('alpha', 'dev', '2026-01-05T11:00:00.000Z', '2026-01-05T11:30:00.000Z'),
      entry('alpha', 'dev', '2026-01-05T12:00:00.000Z', null),
    ],
    '2026-01-05',
  );

  assert.deepEqual(summary, {
    day: '2026-01-05',
    lines: [{ projectId: 'alpha', projectName: 'Projet Alpha', activityId: 'dev', activityName: 'Développement', totalSeconds: 5400 }],
    totalSeconds: 5400,
  });
});

test('seules comptent les Imputations commencées dans la Journée suisse', () => {
  const summary = summarizeDay(
    [
      entry('alpha', 'dev', '2026-01-04T22:30:00.000Z', '2026-01-04T23:00:00.000Z'), // 23:30 la veille
      entry('alpha', 'dev', '2026-01-04T23:30:00.000Z', '2026-01-05T00:00:00.000Z'), // 00:30
      entry('beta', 'support', '2026-01-05T23:30:00.000Z', '2026-01-06T00:00:00.000Z'), // 00:30 le lendemain
    ],
    '2026-01-05',
  );

  assert.deepEqual(summary.lines.map((l) => [l.projectId, l.totalSeconds]), [['alpha', 1800]]);
  assert.equal(summary.totalSeconds, 1800);
});

test('les lignes suivent le début de leur première Imputation ; sans Imputation, la synthèse est vide', () => {
  const summary = summarizeDay(
    [
      entry('beta', 'support', '2026-01-05T13:00:00.000Z', '2026-01-05T14:00:00.000Z'),
      entry('alpha', 'dev', '2026-01-05T15:00:00.000Z', '2026-01-05T15:00:42.000Z'),
      entry('alpha', 'dev', '2026-01-05T08:00:00.000Z', '2026-01-05T09:00:00.000Z'),
    ],
    '2026-01-05',
  );

  assert.deepEqual(summary.lines.map((l) => [l.projectId, l.activityId, l.totalSeconds]), [
    ['alpha', 'dev', 3642],
    ['beta', 'support', 3600],
  ]);
  assert.equal(summary.totalSeconds, 7242);
  assert.deepEqual(summarizeDay([], '2026-01-05'), { day: '2026-01-05', lines: [], totalSeconds: 0 });
});
