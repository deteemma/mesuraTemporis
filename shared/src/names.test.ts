import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName } from './names.js';

test('la normalisation ignore la casse', () => {
  assert.equal(normalizeName('RéUNION'), normalizeName('réunion'));
  assert.equal(normalizeName('Analyse'), 'analyse');
});

test('la normalisation retire les accents', () => {
  assert.equal(normalizeName('Réunion'), 'reunion');
  assert.equal(normalizeName('Élève à Zürich, garçon'), 'eleve a zurich, garcon');
});

test('un accent composé à part (NFD) ou précomposé (NFC) donne le même nom', () => {
  assert.equal(normalizeName('Réunion'), normalizeName('Réunion'));
});

test('la normalisation retire les espaces de bord, pas ceux du milieu', () => {
  assert.equal(normalizeName('  Revue  de code \t'), 'revue  de code');
});

test('des lettres sans décomposition restent telles quelles (à l’identique de la source)', () => {
  assert.equal(normalizeName('Œuvre Straße ø'), 'œuvre straße ø');
});
