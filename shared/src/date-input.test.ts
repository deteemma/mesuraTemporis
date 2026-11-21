import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateInput, parseDateInput, parseEnteredRange, parseEnteredReportRange } from './date-input.js';

test('une date saisie jj.mm.aaaa donne sa Journée, jour et mois sur un ou deux chiffres', () => {
  assert.equal(parseDateInput('19.11.2026'), '2026-11-19');
  assert.equal(parseDateInput('5.1.2026'), '2026-01-05');
  assert.equal(parseDateInput(' 05.01.2026 '), '2026-01-05');
  assert.equal(parseDateInput('29.02.2028'), '2028-02-29');
});

test('saisie souple : « / » comme séparateur, année sur deux chiffres lue au XXIe siècle', () => {
  assert.equal(parseDateInput('19/11/2026'), '2026-11-19');
  assert.equal(parseDateInput('19.11.26'), '2026-11-19');
  assert.equal(parseDateInput('5/1/26'), '2026-01-05');
  assert.equal(parseDateInput('1.1.00'), '2000-01-01');
  assert.equal(parseDateInput('29.02.28'), '2028-02-29');
  assert.equal(parseDateInput('29.02.26'), null);
});

test('une date vide, d’un autre format ou absente du calendrier est refusée', () => {
  for (const text of ['', '2026-11-19', '11/19/2026', '19.11', '19.11.026', '19/11.2026', '31.02.2026', '29.02.2026', '00.01.2026', '1.13.2026', 'demain']) {
    assert.equal(parseDateInput(text), null, text);
  }
});

test('une Journée s’affiche jj.mm.aaaa', () => {
  assert.equal(formatDateInput('2026-01-05'), '05.01.2026');
  assert.equal(formatDateInput('2026-11-19'), '19.11.2026');
});

test('des bornes saisies (date et heure) donnent leurs instants, heure de Zurich', () => {
  assert.deepEqual(parseEnteredRange({ startDate: '29.03.2026', startTime: '130', endDate: '30.03.26', endTime: '9:30' }), {
    startedAt: new Date('2026-03-29T00:30:00.000Z'),
    endedAt: new Date('2026-03-30T07:30:00.000Z'),
  });
});

test('une date illisible est signalée avant une heure illisible', () => {
  assert.deepEqual(parseEnteredRange({ startDate: '31.02.2026', startTime: 'x', endDate: '01.03.2026', endTime: '10' }), {
    error: 'date',
  });
  assert.deepEqual(parseEnteredRange({ startDate: '28.02.2026', startTime: '25', endDate: '01.03.2026', endTime: '10' }), {
    error: 'time',
  });
});

test('plage du Rapport saisie : « Du » et « Au » jj.mm.aaaa donnent leurs Journées ; « Au » vide vaut une seule Journée', () => {
  assert.deepEqual(parseEnteredReportRange('01.01.2026', '31.01.2026'), { from: '2026-01-01', to: '2026-01-31' });
  assert.deepEqual(parseEnteredReportRange('05.01.2026', '  '), { from: '2026-01-05', to: '2026-01-05' });
});

test('plage du Rapport saisie : rien sans « Du » ; une date illisible est signalée', () => {
  assert.equal(parseEnteredReportRange(' ', '31.01.2026'), null);
  assert.deepEqual(parseEnteredReportRange('31.02.2026', ''), { error: 'date' });
  assert.deepEqual(parseEnteredReportRange('01.01.2026', '2026-01-31'), { error: 'date' });
});
