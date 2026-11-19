// Tests portés de la source (heure-saisie.util.spec.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimeInput } from './time-input.js';

test('interprète une heure complète avec séparateur', () => {
  assert.deepEqual(parseTimeInput('18:04'), { hours: 18, minutes: 4 });
});

test('interprète une heure complète sans séparateur', () => {
  assert.deepEqual(parseTimeInput('1804'), { hours: 18, minutes: 4 });
  assert.deepEqual(parseTimeInput('0930'), { hours: 9, minutes: 30 });
});

test('interprète un seul ou deux chiffres comme une heure ronde', () => {
  assert.deepEqual(parseTimeInput('9'), { hours: 9, minutes: 0 });
  assert.deepEqual(parseTimeInput('18'), { hours: 18, minutes: 0 });
});

test('interprète trois chiffres comme heure à un chiffre + minutes sur deux chiffres', () => {
  assert.deepEqual(parseTimeInput('917'), { hours: 9, minutes: 17 });
  assert.deepEqual(parseTimeInput('930'), { hours: 9, minutes: 30 });
});

test('interprète une heure abrégée avec séparateur', () => {
  assert.deepEqual(parseTimeInput('9:17'), { hours: 9, minutes: 17 });
  assert.deepEqual(parseTimeInput('9:30'), { hours: 9, minutes: 30 });
});

test('tronque les secondes présentes dans une valeur collée', () => {
  assert.deepEqual(parseTimeInput('18:04:00'), { hours: 18, minutes: 4 });
});

test('tolère les espaces superflus autour de la saisie', () => {
  assert.deepEqual(parseTimeInput('  18:04  '), { hours: 18, minutes: 4 });
});

test('rejette une heure hors plage', () => {
  assert.equal(parseTimeInput('25:00'), null);
});

test('rejette une minute hors plage', () => {
  assert.equal(parseTimeInput('18:99'), null);
});

test('rejette une valeur non numérique', () => {
  assert.equal(parseTimeInput('abcd'), null);
});

test('rejette une chaîne vide', () => {
  assert.equal(parseTimeInput(''), null);
  assert.equal(parseTimeInput('   '), null);
});

test('rejette une saisie trop longue pour être ambiguë', () => {
  assert.equal(parseTimeInput('99999'), null);
});
