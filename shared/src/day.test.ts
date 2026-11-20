import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentDay, dayBounds, dayOf, formatTimeOfDay, zurichInstant } from './day.js';

const HOUR_MS = 3600 * 1000;

test('la Journée d’un instant est celle de Zurich, en hiver (UTC+1)', () => {
  assert.equal(dayOf('2026-01-15T22:59:59.999Z'), '2026-01-15');
  assert.equal(dayOf('2026-01-15T23:00:00.000Z'), '2026-01-16');
});

test('la Journée d’un instant est celle de Zurich, en été (UTC+2)', () => {
  assert.equal(dayOf('2026-07-15T21:59:59.999Z'), '2026-07-15');
  assert.equal(dayOf('2026-07-15T22:00:00.000Z'), '2026-07-16');
});

test('minuit UTC n’est pas la frontière : 00:30 UTC appartient encore à la Journée suisse d’après, 23:30 UTC à la suivante', () => {
  assert.equal(dayOf('2026-07-16T00:30:00.000Z'), '2026-07-16');
  assert.equal(dayOf('2026-01-15T23:30:00.000Z'), '2026-01-16');
});

test('une Journée ordinaire va de minuit à 23:59:59.999, heure de Zurich', () => {
  assert.deepEqual(dayBounds('2026-01-15'), {
    start: new Date('2026-01-14T23:00:00.000Z'),
    end: new Date('2026-01-15T22:59:59.999Z'),
  });
});

test('le jour du passage à l’heure d’été (fin mars) compte 23 heures', () => {
  const { start, end } = dayBounds('2026-03-29');
  assert.deepEqual(start, new Date('2026-03-28T23:00:00.000Z'));
  assert.deepEqual(end, new Date('2026-03-29T21:59:59.999Z'));
  assert.equal(end.getTime() + 1 - start.getTime(), 23 * HOUR_MS);
});

test('le jour du retour à l’heure d’hiver (fin octobre) compte 25 heures', () => {
  const { start, end } = dayBounds('2026-10-25');
  assert.deepEqual(start, new Date('2026-10-24T22:00:00.000Z'));
  assert.deepEqual(end, new Date('2026-10-25T22:59:59.999Z'));
  assert.equal(end.getTime() + 1 - start.getTime(), 25 * HOUR_MS);
});

test('les bornes d’une Journée lui appartiennent, l’instant suivant la fin appartient au lendemain', () => {
  for (const day of ['2026-01-15', '2026-03-29', '2026-10-25', '2026-12-31']) {
    const { start, end } = dayBounds(day);
    assert.equal(dayOf(start), day);
    assert.equal(dayOf(end), day);
    assert.notEqual(dayOf(new Date(end.getTime() + 1)), day);
    assert.notEqual(dayOf(new Date(start.getTime() - 1)), day);
  }
});

test('une heure murale de Zurich devient l’instant voulu, en hiver comme en été', () => {
  assert.deepEqual(zurichInstant('2026-01-15', 9, 30), new Date('2026-01-15T08:30:00.000Z'));
  assert.deepEqual(zurichInstant('2026-07-15', 9, 30), new Date('2026-07-15T07:30:00.000Z'));
  assert.deepEqual(zurichInstant('2026-07-15', 23, 59), new Date('2026-07-15T21:59:00.000Z'));
});

test('autour des changements d’heure, l’heure murale suit le décalage du moment', () => {
  // 29 mars : 01:59 est encore en hiver, 03:00 déjà en été.
  assert.deepEqual(zurichInstant('2026-03-29', 1, 59), new Date('2026-03-29T00:59:00.000Z'));
  assert.deepEqual(zurichInstant('2026-03-29', 3, 0), new Date('2026-03-29T01:00:00.000Z'));
  // 25 octobre : 01:00 encore en été, 04:00 en hiver.
  assert.deepEqual(zurichInstant('2026-10-25', 1, 0), new Date('2026-10-24T23:00:00.000Z'));
  assert.deepEqual(zurichInstant('2026-10-25', 4, 0), new Date('2026-10-25T03:00:00.000Z'));
});

test('la Journée en cours est celle de Zurich, même quand l’UTC est déjà au lendemain ou encore à la veille', () => {
  assert.equal(currentDay(new Date('2026-07-15T22:30:00.000Z')), '2026-07-16');
  assert.equal(currentDay(new Date('2026-12-31T23:15:00.000Z')), '2027-01-01');
});

test('l’heure affichée (hh:mm, 24 h) est celle de Zurich, quel que soit le fuseau du poste', () => {
  assert.equal(formatTimeOfDay('2026-01-15T08:05:59.000Z'), '09:05');
  assert.equal(formatTimeOfDay('2026-07-15T22:30:00.000Z'), '00:30');
  assert.equal(formatTimeOfDay('2026-07-15T11:00:00.000Z'), '13:00');
});
