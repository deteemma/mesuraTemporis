// Tests portés de la source (frontend/src/app/shared/duree.util.spec.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durationSeconds, formatSeconds } from './durations.js';

test('hh:mm:ss : les secondes sous 10 sont complétées par un zéro', () => {
  assert.equal(formatSeconds(5), '00:00:05');
});
test('hh:mm:ss : 0 seconde', () => {
  assert.equal(formatSeconds(0), '00:00:00');
});
test('hh:mm:ss : sous la minute, pile sur la minute, sous l’heure, pile sur l’heure, au-delà', () => {
  assert.equal(formatSeconds(45), '00:00:45');
  assert.equal(formatSeconds(60), '00:01:00');
  assert.equal(formatSeconds(5 * 60 + 12), '00:05:12');
  assert.equal(formatSeconds(3600), '01:00:00');
  assert.equal(formatSeconds(2 * 3600 + 15 * 60 + 42), '02:15:42');
});
test('hh:mm:ss sans plafond à 24 h : un cumul de 27 h 15 min 42 s reste « 27:15:42 »', () => {
  assert.equal(formatSeconds(27 * 3600 + 15 * 60 + 42), '27:15:42');
  assert.equal(formatSeconds(98115), '27:15:15');
});
test('la Durée d’une Imputation est à la seconde, sans arrondi à la minute', () => {
  assert.equal(formatSeconds(durationSeconds('2026-01-05T09:00:00.000Z', '2026-01-05T09:05:00.000Z')), '00:05:00');
  assert.equal(formatSeconds(durationSeconds('2026-01-05T09:00:00.000Z', '2026-01-05T09:00:42.000Z')), '00:00:42');
  assert.equal(formatSeconds(durationSeconds('2026-01-05T09:00:00.000Z', '2026-01-05T11:15:30.000Z')), '02:15:30');
});
test('un Chronomètre franchissant minuit garde une seule Durée continue', () => {
  assert.equal(formatSeconds(durationSeconds('2026-07-15T21:30:00.000Z', '2026-07-15T22:45:10.000Z')), '01:15:10');
});
