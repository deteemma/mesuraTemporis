import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoryPage, historyStartDay } from './history.js';

let sequence = 0;
const entry = (projectId: string, activityId: string, startedAt: string, endedAt: string) => ({
  id: `e${++sequence}`,
  projectId,
  activityId,
  startedAt,
  endedAt,
});

const days = (page: ReturnType<typeof buildHistoryPage>) => page.days.map((d) => d.day);

test("la page inclut plusieurs Journées tant que le plafond n'est pas dépassé", () => {
  const page = buildHistoryPage(
    [
      entry('p1', 'a1', '2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z'),
      entry('p1', 'a1', '2026-01-04T09:00:00.000Z', '2026-01-04T10:00:00.000Z'),
    ],
    50,
  );

  assert.deepEqual(days(page), ['2026-01-05', '2026-01-04']);
  assert.equal(page.nextCursor, null);
});

test('une Journée entière est reportée à la page suivante quand son ajout dépasserait le plafond', () => {
  // Journée la plus récente : 2 groupes ; la suivante : 2 groupes ; plafond 3.
  const page = buildHistoryPage(
    [
      entry('p1', 'a1', '2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z'),
      entry('p1', 'a2', '2026-01-05T11:00:00.000Z', '2026-01-05T12:00:00.000Z'),
      entry('p1', 'a1', '2026-01-04T09:00:00.000Z', '2026-01-04T10:00:00.000Z'),
      entry('p1', 'a2', '2026-01-04T11:00:00.000Z', '2026-01-04T12:00:00.000Z'),
    ],
    3,
  );

  assert.deepEqual(days(page), ['2026-01-05']);
  assert.equal(page.nextCursor, '2026-01-04');
});

test('une Journée qui dépasse seule le plafond est incluse en entier', () => {
  const page = buildHistoryPage(
    [
      entry('p1', 'a1', '2026-01-05T06:00:00.000Z', '2026-01-05T07:00:00.000Z'),
      entry('p1', 'a2', '2026-01-05T08:00:00.000Z', '2026-01-05T09:00:00.000Z'),
      entry('p1', 'a3', '2026-01-05T10:00:00.000Z', '2026-01-05T11:00:00.000Z'),
    ],
    1,
  );

  assert.deepEqual(days(page), ['2026-01-05']);
  assert.equal(page.days[0]!.groups.length, 3);
  assert.equal(page.nextCursor, null);
});

test('la page reconstruite à partir du curseur continue sans doublon ni trou', () => {
  const entries = [
    entry('p1', 'a1', '2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z'),
    entry('p1', 'a2', '2026-01-05T11:00:00.000Z', '2026-01-05T12:00:00.000Z'),
    entry('p1', 'a1', '2026-01-04T09:00:00.000Z', '2026-01-04T10:00:00.000Z'),
    entry('p1', 'a2', '2026-01-04T11:00:00.000Z', '2026-01-04T12:00:00.000Z'),
    entry('p1', 'a1', '2026-01-03T09:00:00.000Z', '2026-01-03T10:00:00.000Z'),
  ];

  const first = buildHistoryPage(entries, 3);
  assert.deepEqual(days(first), ['2026-01-05']);
  assert.equal(first.nextCursor, '2026-01-04');

  // Comme l'API : seules les Imputations commencées au plus tard à la fin de la Journée du curseur.
  const second = buildHistoryPage(
    entries.filter((e) => e.startedAt <= '2026-01-04T22:59:59.999Z'),
    3,
  );
  assert.deepEqual(days(second), ['2026-01-04', '2026-01-03']);
  assert.equal(second.nextCursor, null);
});

test('les Imputations sont rangées dans leur Journée Europe/Zurich, pas dans la journée UTC', () => {
  // 23:30 UTC le 4 janvier = 00:30 le 5 janvier à Zurich (heure d'hiver) ;
  // 22:30 UTC le 27 juin = 00:30 le 28 juin (heure d'été).
  const page = buildHistoryPage([
    entry('p1', 'a1', '2026-06-27T22:30:00.000Z', '2026-06-27T23:00:00.000Z'),
    entry('p1', 'a1', '2026-01-04T23:30:00.000Z', '2026-01-05T00:30:00.000Z'),
    entry('p1', 'a1', '2026-01-04T22:30:00.000Z', '2026-01-04T22:45:00.000Z'),
  ]);

  assert.deepEqual(days(page), ['2026-06-28', '2026-01-05', '2026-01-04']);
});

test('la page commence à la Journée du curseur ; sans curseur, illisible, aujourd’hui ou futur : hier', () => {
  const today = '2026-03-30';
  assert.equal(historyStartDay('2026-03-12', today), '2026-03-12');
  for (const before of [undefined, '', 'n-importe-quoi', '2026-02-31', '2026-03-30', '2999-01-01']) {
    assert.equal(historyStartDay(before, today), '2026-03-29', String(before));
  }
});
