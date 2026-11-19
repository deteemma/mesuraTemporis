// Scission à l'Édition à la volée (ADR-0013), sur les minuits de la Journée
// Europe/Zurich (ADR-0012). Heures murales indiquées en commentaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planInlineEdit } from './split.js';

const at = (iso: string) => new Date(iso);

// 2026-01-05, 09:00 → 10:00 à Zurich (UTC+1).
const morning = { startedAt: at('2026-01-05T08:00:00.000Z'), endedAt: at('2026-01-05T09:00:00.000Z') };

test('une édition sans franchissement de minuit est une modification simple', () => {
  // Fin éditée à 11:30.
  assert.deepEqual(planInlineEdit(morning, { endedAt: at('2026-01-05T10:30:00.000Z') }), {
    kind: 'update',
    entry: { startedAt: morning.startedAt, endedAt: at('2026-01-05T10:30:00.000Z') },
  });
  // Début et fin envoyés ensemble, dans l'ordre : 08:00 → 12:00.
  assert.deepEqual(
    planInlineEdit(morning, { startedAt: at('2026-01-05T07:00:00.000Z'), endedAt: at('2026-01-05T11:00:00.000Z') }),
    { kind: 'update', entry: { startedAt: at('2026-01-05T07:00:00.000Z'), endedAt: at('2026-01-05T11:00:00.000Z') } },
  );
});

test('fin éditée avant le début : coupe vers le lendemain, l’original s’arrête à 23:59:59.999', () => {
  // Fin éditée à 08:00 : l'Imputation irait de 09:00 jusqu'au lendemain 08:00.
  assert.deepEqual(planInlineEdit(morning, { endedAt: at('2026-01-05T07:00:00.000Z') }), {
    kind: 'split',
    original: { startedAt: morning.startedAt, endedAt: at('2026-01-05T22:59:59.999Z') }, // 23:59:59.999
    created: { startedAt: at('2026-01-05T23:00:00.000Z'), endedAt: at('2026-01-06T07:00:00.000Z') }, // 00:00 → 08:00
  });
});

test('exemple de l’ADR : 23:50 avec une fin éditée à 00:10 donne 23:50 → 23:59:59.999 et 00:00 → 00:10', () => {
  const late = { startedAt: at('2026-01-05T22:50:00.000Z'), endedAt: at('2026-01-05T22:55:00.000Z') };
  assert.deepEqual(planInlineEdit(late, { endedAt: at('2026-01-04T23:10:00.000Z') }), {
    kind: 'split',
    original: { startedAt: late.startedAt, endedAt: at('2026-01-05T22:59:59.999Z') },
    created: { startedAt: at('2026-01-05T23:00:00.000Z'), endedAt: at('2026-01-05T23:10:00.000Z') },
  });
});

test('début édité après la fin : coupe vers la veille, l’original commence à minuit', () => {
  // Début édité à 23:50 : l'Imputation irait de la veille 23:50 jusqu'à 10:00.
  assert.deepEqual(planInlineEdit(morning, { startedAt: at('2026-01-05T22:50:00.000Z') }), {
    kind: 'split',
    original: { startedAt: at('2026-01-04T23:00:00.000Z'), endedAt: morning.endedAt }, // 00:00 → 10:00
    created: { startedAt: at('2026-01-04T22:50:00.000Z'), endedAt: at('2026-01-04T22:59:59.999Z') }, // veille 23:50 → 23:59:59.999
  });
});

test('début et fin envoyés ensemble et inversés : refus IMPUTATION_FIN_AVANT_DEBUT', () => {
  assert.deepEqual(
    planInlineEdit(morning, { startedAt: at('2026-01-05T22:50:00.000Z'), endedAt: at('2026-01-05T08:30:00.000Z') }),
    { kind: 'refused', code: 'IMPUTATION_FIN_AVANT_DEBUT' },
  );
});

test('le Chronomètre (sans fin) n’est jamais scindé', () => {
  const timer = { startedAt: morning.startedAt, endedAt: null };
  assert.deepEqual(planInlineEdit(timer, { startedAt: at('2026-01-05T22:50:00.000Z') }), {
    kind: 'update',
    entry: { startedAt: at('2026-01-05T22:50:00.000Z'), endedAt: null },
  });
});

test('passage à l’heure d’été (29 mars 2026) : coupe vers le lendemain à l’heure murale visée', () => {
  // 28 mars 23:00 → 23:30 (UTC+1), fin éditée à 08:00 : le lendemain, 08:00 est en UTC+2.
  const entry = { startedAt: at('2026-03-28T22:00:00.000Z'), endedAt: at('2026-03-28T22:30:00.000Z') };
  assert.deepEqual(planInlineEdit(entry, { endedAt: at('2026-03-28T07:00:00.000Z') }), {
    kind: 'split',
    original: { startedAt: entry.startedAt, endedAt: at('2026-03-28T22:59:59.999Z') },
    created: { startedAt: at('2026-03-28T23:00:00.000Z'), endedAt: at('2026-03-29T06:00:00.000Z') },
  });
});

test('passage à l’heure d’été (29 mars 2026) : coupe vers la veille à l’heure murale visée', () => {
  // 29 mars 09:00 → 10:00 (UTC+2), début édité à 23:00 : la veille, 23:00 est en UTC+1.
  const entry = { startedAt: at('2026-03-29T07:00:00.000Z'), endedAt: at('2026-03-29T08:00:00.000Z') };
  assert.deepEqual(planInlineEdit(entry, { startedAt: at('2026-03-29T21:00:00.000Z') }), {
    kind: 'split',
    original: { startedAt: at('2026-03-28T23:00:00.000Z'), endedAt: entry.endedAt },
    created: { startedAt: at('2026-03-28T22:00:00.000Z'), endedAt: at('2026-03-28T22:59:59.999Z') },
  });
});

test('retour à l’heure d’hiver (25 octobre 2026) : la Journée de 25 heures est couverte de minuit à l’heure visée', () => {
  // 24 octobre 22:00 → 23:00 (UTC+2), fin éditée à 08:00 : le lendemain, 08:00 est en UTC+1.
  const entry = { startedAt: at('2026-10-24T20:00:00.000Z'), endedAt: at('2026-10-24T21:00:00.000Z') };
  assert.deepEqual(planInlineEdit(entry, { endedAt: at('2026-10-24T06:00:00.000Z') }), {
    kind: 'split',
    original: { startedAt: entry.startedAt, endedAt: at('2026-10-24T21:59:59.999Z') },
    created: { startedAt: at('2026-10-24T22:00:00.000Z'), endedAt: at('2026-10-25T07:00:00.000Z') },
  });
});

test('retour à l’heure d’hiver (25 octobre 2026) : coupe vers la veille, fin de la Journée de 25 heures', () => {
  // 26 octobre 09:00 → 10:00 (UTC+1), début édité à 23:50 : veille 25 octobre 23:50 → 23:59:59.999 (UTC+1).
  const entry = { startedAt: at('2026-10-26T08:00:00.000Z'), endedAt: at('2026-10-26T09:00:00.000Z') };
  assert.deepEqual(planInlineEdit(entry, { startedAt: at('2026-10-26T22:50:00.000Z') }), {
    kind: 'split',
    original: { startedAt: at('2026-10-25T23:00:00.000Z'), endedAt: entry.endedAt },
    created: { startedAt: at('2026-10-25T22:50:00.000Z'), endedAt: at('2026-10-25T22:59:59.999Z') },
  });
});
