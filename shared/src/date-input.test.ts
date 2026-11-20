import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateInput, parseDateInput } from './date-input.js';

test('une date saisie jj.mm.aaaa donne sa Journée, jour et mois sur un ou deux chiffres', () => {
  assert.equal(parseDateInput('19.11.2026'), '2026-11-19');
  assert.equal(parseDateInput('5.1.2026'), '2026-01-05');
  assert.equal(parseDateInput(' 05.01.2026 '), '2026-01-05');
  assert.equal(parseDateInput('29.02.2028'), '2028-02-29');
});

test('une date vide, d’un autre format ou absente du calendrier est refusée', () => {
  for (const text of ['', '2026-11-19', '11/19/2026', '19.11.26', '19.11', '31.02.2026', '29.02.2026', '00.01.2026', '1.13.2026', 'demain']) {
    assert.equal(parseDateInput(text), null, text);
  }
});

test('une Journée s’affiche jj.mm.aaaa', () => {
  assert.equal(formatDateInput('2026-01-05'), '05.01.2026');
  assert.equal(formatDateInput('2026-11-19'), '19.11.2026');
});
