import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByActivity } from './time-entry-groups.js';

const entry = (id: string, projectId: string, activityId: string, startedAt: string, endedAt: string | null) => ({
  id,
  projectId,
  activityId,
  startedAt,
  endedAt,
});

test('les Imputations terminées de la Journée sont regroupées par Projet et Activité, avec la Durée totale du groupe', () => {
  const groups = groupByActivity([
    entry('e3', 'p1', 'a1', '2026-09-10T13:00:00.000Z', '2026-09-10T13:00:42.000Z'),
    entry('e2', 'p2', 'a1', '2026-09-10T09:00:00.000Z', '2026-09-10T09:30:00.000Z'),
    entry('e1', 'p1', 'a1', '2026-09-10T08:00:00.000Z', '2026-09-10T09:00:00.000Z'),
  ]);

  assert.deepEqual(
    groups.map((g) => ({ projectId: g.projectId, activityId: g.activityId, ids: g.entries.map((e) => e.id), total: g.totalSeconds })),
    [
      { projectId: 'p1', activityId: 'a1', ids: ['e3', 'e1'], total: 3642 },
      { projectId: 'p2', activityId: 'a1', ids: ['e2'], total: 1800 },
    ],
  );
});

test('les groupes suivent le début de leur première Imputation ; le Chronomètre reste hors groupe', () => {
  const groups = groupByActivity([
    entry('timer', 'p1', 'a9', '2026-09-10T15:00:00.000Z', null),
    entry('late', 'p1', 'a2', '2026-09-10T14:00:00.000Z', '2026-09-10T14:10:00.000Z'),
    entry('early', 'p1', 'a3', '2026-09-10T07:00:00.000Z', '2026-09-10T07:10:00.000Z'),
  ]);

  assert.deepEqual(groups.map((g) => g.activityId), ['a3', 'a2']);
});
