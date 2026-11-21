import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from './report.js';

const users = { jdupont: 'jdupont', amartin: 'amartin' } as const;
const projects = { alpha: 'Projet Alpha', beta: 'Projet Beta' } as const;
const activities = { dev: 'Développement', support: 'Support' } as const;

const entry = (
  userId: keyof typeof users,
  projectId: keyof typeof projects,
  activityId: keyof typeof activities,
  startedAt: string,
  endedAt: string | null,
) => ({
  userId,
  userLogin: users[userId],
  projectId,
  projectName: projects[projectId],
  activityId,
  activityName: activities[activityId],
  startedAt,
  endedAt,
});

// Jeu de la source (rapportPlage.test.js) : deux Utilisateurs sur le même Projet.
const sourceEntries = [
  entry('jdupont', 'alpha', 'dev', '2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z'),
  entry('jdupont', 'alpha', 'dev', '2026-01-06T09:00:00.000Z', '2026-01-06T10:30:00.000Z'),
  entry('amartin', 'alpha', 'dev', '2026-01-05T13:00:00.000Z', '2026-01-05T14:00:00.000Z'),
];

test('le Rapport est groupé par Journée, de la plus ancienne à la plus récente, avec un total par Journée et sur la période', () => {
  const report = buildReport(sourceEntries, { from: '2026-01-01', to: '2026-01-31' });

  assert.deepEqual(report, {
    from: '2026-01-01',
    to: '2026-01-31',
    days: [
      {
        day: '2026-01-05',
        totalSeconds: 7200,
        lines: [
          { userId: 'jdupont', userLogin: 'jdupont', projectId: 'alpha', projectName: 'Projet Alpha', activityId: 'dev', activityName: 'Développement', day: '2026-01-05', totalSeconds: 3600 },
          { userId: 'amartin', userLogin: 'amartin', projectId: 'alpha', projectName: 'Projet Alpha', activityId: 'dev', activityName: 'Développement', day: '2026-01-05', totalSeconds: 3600 },
        ],
      },
      {
        day: '2026-01-06',
        totalSeconds: 5400,
        lines: [
          { userId: 'jdupont', userLogin: 'jdupont', projectId: 'alpha', projectName: 'Projet Alpha', activityId: 'dev', activityName: 'Développement', day: '2026-01-06', totalSeconds: 5400 },
        ],
      },
    ],
    totalSeconds: 12600,
  });
});

test('une plage d’une seule Journée ne retient que les Imputations commencées ce jour-là', () => {
  const report = buildReport(sourceEntries, { from: '2026-01-05', to: '2026-01-05' });

  assert.deepEqual(report.days.map((d) => d.day), ['2026-01-05']);
  assert.equal(report.days[0]!.lines.length, 2);
  assert.equal(report.totalSeconds, 7200);
});

test('une plage inversée donne un Rapport vide', () => {
  assert.deepEqual(buildReport(sourceEntries, { from: '2026-01-31', to: '2026-01-01' }), {
    from: '2026-01-31',
    to: '2026-01-01',
    days: [],
    totalSeconds: 0,
  });
});

test('les Chronomètres en cours sont exclus du Rapport', () => {
  const report = buildReport(
    [
      entry('jdupont', 'alpha', 'dev', '2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z'),
      entry('jdupont', 'alpha', 'support', '2026-01-05T11:00:00.000Z', null),
    ],
    { from: '2026-01-05', to: '2026-01-05' },
  );

  assert.deepEqual(report.days[0]!.lines.map((l) => l.activityId), ['dev']);
  assert.equal(report.totalSeconds, 3600);
});

test('l’agrégation garde la précision à la seconde', () => {
  // Source : deux Imputations de 30 secondes font une minute, pas zéro.
  const report = buildReport(
    [
      entry('jdupont', 'beta', 'support', '2026-01-10T09:00:00.000Z', '2026-01-10T09:00:30.000Z'),
      entry('jdupont', 'beta', 'support', '2026-01-10T10:00:00.000Z', '2026-01-10T10:00:30.000Z'),
    ],
    { from: '2026-01-01', to: '2026-01-31' },
  );

  assert.equal(report.days[0]!.lines[0]!.totalSeconds, 60);
  assert.equal(report.totalSeconds, 60);
});

test('une Imputation appartient à la Journée suisse de son début, en hiver comme en été', () => {
  // 23:30 UTC est déjà le lendemain à Zurich (00:30 en hiver, 01:30 en été).
  const report = buildReport(
    [
      entry('jdupont', 'alpha', 'dev', '2026-01-05T23:30:00.000Z', '2026-01-06T00:00:00.000Z'),
      entry('jdupont', 'alpha', 'dev', '2026-07-05T22:30:00.000Z', '2026-07-05T23:00:00.000Z'),
    ],
    { from: '2026-01-06', to: '2026-07-06' },
  );

  assert.deepEqual(report.days.map((d) => [d.day, d.totalSeconds]), [
    ['2026-01-06', 1800],
    ['2026-07-06', 1800],
  ]);
});

test('la plage suit les minuits suisses : 00:30 à Zurich est dans la Journée, 23:30 la veille non', () => {
  const report = buildReport(
    [
      entry('jdupont', 'alpha', 'dev', '2026-03-28T22:30:00.000Z', '2026-03-28T23:00:00.000Z'), // 23:30 le 28.03
      entry('jdupont', 'alpha', 'dev', '2026-03-28T23:30:00.000Z', '2026-03-29T00:00:00.000Z'), // 00:30 le 29.03
      entry('jdupont', 'alpha', 'dev', '2026-03-29T21:30:00.000Z', '2026-03-29T21:45:00.000Z'), // 23:30 le 29.03 (été)
      entry('jdupont', 'alpha', 'dev', '2026-03-29T22:30:00.000Z', '2026-03-29T22:45:00.000Z'), // 00:30 le 30.03
    ],
    { from: '2026-03-29', to: '2026-03-29' },
  );

  assert.deepEqual(report.days.map((d) => [d.day, d.totalSeconds]), [['2026-03-29', 2700]]);
});

test('les lignes d’une Journée suivent le début de leur première Imputation (E23)', () => {
  const report = buildReport(
    [
      entry('amartin', 'beta', 'support', '2026-01-05T14:00:00.000Z', '2026-01-05T15:00:00.000Z'),
      entry('jdupont', 'alpha', 'dev', '2026-01-05T16:00:00.000Z', '2026-01-05T17:00:00.000Z'),
      entry('jdupont', 'alpha', 'support', '2026-01-05T10:00:00.000Z', '2026-01-05T11:00:00.000Z'),
      entry('jdupont', 'alpha', 'dev', '2026-01-05T08:00:00.000Z', '2026-01-05T09:00:00.000Z'),
    ],
    { from: '2026-01-05', to: '2026-01-05' },
  );

  assert.deepEqual(report.days[0]!.lines.map((l) => [l.userId, l.activityId, l.totalSeconds]), [
    ['jdupont', 'dev', 7200],
    ['jdupont', 'support', 3600],
    ['amartin', 'support', 3600],
  ]);
});
