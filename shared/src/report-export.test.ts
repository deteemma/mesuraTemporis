import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from './report.js';
import { REPORT_EXPORT_COLUMNS, REPORT_EXPORT_SHEET, reportExportFileName, reportExportRows } from './report-export.js';

const entry = (userLogin: string, projectName: string, activityName: string, startedAt: string, endedAt: string) => ({
  userId: userLogin,
  userLogin,
  projectId: projectName,
  projectName,
  activityId: activityName,
  activityName,
  startedAt,
  endedAt,
});

test('la feuille « Rapport » a les en-têtes français de la source', () => {
  assert.equal(REPORT_EXPORT_SHEET, 'Rapport');
  assert.deepEqual(REPORT_EXPORT_COLUMNS.map((column) => column.header), ['Utilisateur', 'Projet', 'Activité', 'Journée', 'Durée (minutes)', 'Durée (hh:mm:ss)']);
});

test('une ligne par ligne du Rapport : Login, Projet, Activité, Journée, minutes et hh:mm:ss (jeu de la source)', () => {
  const report = buildReport(
    [entry('jdupont', 'Projet Alpha', 'Développement', '2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z')],
    { from: '2026-01-01', to: '2026-01-31' },
  );
  assert.deepEqual(reportExportRows(report), [['jdupont', 'Projet Alpha', 'Développement', '2026-01-05', 60, '01:00:00']]);
});

test('les lignes suivent l’ordre du Rapport : Journées croissantes, puis début de la première Imputation', () => {
  const report = buildReport(
    [
      entry('bruno', 'P', 'Support', '2026-01-06T08:00:00.000Z', '2026-01-06T09:00:00.000Z'),
      entry('alice', 'P', 'Dev', '2026-01-05T10:00:00.000Z', '2026-01-05T11:00:00.000Z'),
      entry('bruno', 'P', 'Dev', '2026-01-05T08:00:00.000Z', '2026-01-05T09:00:00.000Z'),
    ],
    { from: '2026-01-01', to: '2026-01-31' },
  );
  assert.deepEqual(
    reportExportRows(report).map((row) => [row[0], row[3]]),
    [
      ['bruno', '2026-01-05'],
      ['alice', '2026-01-05'],
      ['bruno', '2026-01-06'],
    ],
  );
});

test('les minutes sont arrondies par ligne ; hh:mm:ss sans plafond à 24 h', () => {
  const report = buildReport(
    [
      // 29 s puis 30 s : arrondies séparément (0 et 1), pas sur leur somme.
      entry('alice', 'P', 'A', '2026-01-05T08:00:00.000Z', '2026-01-05T08:00:29.000Z'),
      entry('alice', 'P', 'B', '2026-01-05T09:00:00.000Z', '2026-01-05T09:00:30.000Z'),
      // 25 h 30 min 15 s sur une seule Imputation.
      entry('alice', 'P', 'C', '2026-01-06T00:00:00.000Z', '2026-01-07T01:30:15.000Z'),
    ],
    { from: '2026-01-01', to: '2026-01-31' },
  );
  assert.deepEqual(
    reportExportRows(report).map((row) => [row[2], row[4], row[5]]),
    [
      ['A', 0, '00:00:29'],
      ['B', 1, '00:00:30'],
      ['C', 1530, '25:30:15'],
    ],
  );
});

test('le fichier s’appelle rapport-<du>-<au>.xlsx, ou rapport-<du>.xlsx pour une seule Journée (comme la source)', () => {
  assert.equal(reportExportFileName({ from: '2026-01-01', to: '2026-01-31' }), 'rapport-2026-01-01-2026-01-31.xlsx');
  assert.equal(reportExportFileName({ from: '2026-01-05', to: '2026-01-05' }), 'rapport-2026-01-05.xlsx');
});
