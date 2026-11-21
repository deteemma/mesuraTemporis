import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createActivitySchema,
  createUserSchema,
  createProjectSchema,
  inlineEditSchema,
  manualEntrySchema,
  renameActivitySchema,
  reportRangeSchema,
  updateUserEmailSchema,
} from './schemas.js';

const refusal = (input: unknown) => createProjectSchema.safeParse(input).error?.issues[0]?.message;

test('un Projet se crée par son seul nom, espaces de bord retirés', () => {
  assert.deepEqual(createProjectSchema.parse({ name: '  Refonte  ' }), { name: 'Refonte' });
});

test('un nom de Projet absent, vide ou fait d’espaces est refusé avec NOM_REQUIS', () => {
  assert.equal(refusal({}), 'NOM_REQUIS');
  assert.equal(refusal({ name: '' }), 'NOM_REQUIS');
  assert.equal(refusal({ name: ' \t ' }), 'NOM_REQUIS');
});

test('un nom de Projet n’a pas de limite de longueur', () => {
  const name = 'P'.repeat(5000);
  assert.equal(createProjectSchema.parse({ name }).name, name);
});

const activityRefusal = (schema: typeof createActivitySchema | typeof renameActivitySchema, input: unknown) =>
  schema.safeParse(input).error?.issues[0]?.message;

test('une Activité se crée ou se renomme par son nom, espaces de bord retirés', () => {
  assert.deepEqual(createActivitySchema.parse({ name: '  Réunion ' }), { name: 'Réunion' });
  assert.deepEqual(renameActivitySchema.parse({ name: ' Revue de code  ' }), { name: 'Revue de code' });
});

test('un nom d’Activité absent, vide ou fait d’espaces est refusé avec NOM_REQUIS', () => {
  for (const schema of [createActivitySchema, renameActivitySchema]) {
    assert.equal(activityRefusal(schema, {}), 'NOM_REQUIS');
    assert.equal(activityRefusal(schema, { name: '' }), 'NOM_REQUIS');
    assert.equal(activityRefusal(schema, { name: '  \t' }), 'NOM_REQUIS');
  }
});

test('Édition à la volée : début et/ou fin, en instants ISO 8601', () => {
  assert.deepEqual(inlineEditSchema.parse({ endedAt: '2026-01-05T09:00:00.000Z' }), { endedAt: '2026-01-05T09:00:00.000Z' });
  assert.deepEqual(
    inlineEditSchema.parse({ startedAt: '2026-01-05T09:00:00+01:00', endedAt: '2026-01-05T10:00:00+01:00' }),
    { startedAt: '2026-01-05T09:00:00+01:00', endedAt: '2026-01-05T10:00:00+01:00' },
  );
});

test('Édition à la volée : un instant illisible est refusé avec IMPUTATION_CHAMPS_REQUIS', () => {
  assert.equal(inlineEditSchema.safeParse({ endedAt: '09:00' }).error?.issues[0]?.message, 'IMPUTATION_CHAMPS_REQUIS');
  assert.equal(inlineEditSchema.safeParse({ startedAt: null }).error?.issues[0]?.message, 'IMPUTATION_CHAMPS_REQUIS');
});

const manualEntry = {
  projectId: '0b6f2b8e-6a1f-4d1c-9a51-0d2a3c4b5e6f',
  activityId: '5c1d9e0a-2b3c-4d5e-8f90-a1b2c3d4e5f6',
  startedAt: '2026-01-05T08:00:00.000Z',
  endedAt: '2026-01-05T09:30:00.000Z',
};
const manualRefusal = (input: unknown) => manualEntrySchema.safeParse(input).error?.issues[0]?.message;

test('Saisie manuelle : Projet, Activité, début et fin', () => {
  assert.deepEqual(manualEntrySchema.parse(manualEntry), manualEntry);
});

test('Saisie manuelle : un champ absent, vide ou illisible est refusé avec IMPUTATION_CHAMPS_REQUIS', () => {
  for (const field of ['projectId', 'activityId', 'startedAt', 'endedAt'] as const) {
    assert.equal(manualRefusal({ ...manualEntry, [field]: undefined }), 'IMPUTATION_CHAMPS_REQUIS', field);
    assert.equal(manualRefusal({ ...manualEntry, [field]: '' }), 'IMPUTATION_CHAMPS_REQUIS', field);
  }
  assert.equal(manualRefusal({ ...manualEntry, endedAt: '09:30' }), 'IMPUTATION_CHAMPS_REQUIS');
  assert.equal(manualRefusal({}), 'IMPUTATION_CHAMPS_REQUIS');
});

test('Saisie manuelle : une fin avant le début est refusée avec IMPUTATION_FIN_AVANT_DEBUT (E2)', () => {
  assert.equal(manualRefusal({ ...manualEntry, endedAt: '2026-01-05T07:59:00.000Z' }), 'IMPUTATION_FIN_AVANT_DEBUT');
  // Décalages différents, même comparaison d'instants : 09:00+01:00 (08:00Z) précède 08:30Z.
  assert.equal(
    manualRefusal({ ...manualEntry, startedAt: '2026-01-05T08:30:00Z', endedAt: '2026-01-05T09:00:00+01:00' }),
    'IMPUTATION_FIN_AVANT_DEBUT',
  );
});

test('Saisie manuelle : une fin égale au début, ou une saisie qui franchit minuit, est acceptée telle quelle', () => {
  assert.equal(manualEntrySchema.safeParse({ ...manualEntry, endedAt: manualEntry.startedAt }).success, true);
  const overnight = { ...manualEntry, startedAt: '2026-01-05T22:00:00.000Z', endedAt: '2026-01-06T01:00:00.000Z' };
  assert.deepEqual(manualEntrySchema.parse(overnight), overnight);
});

const rangeRefusal = (input: unknown) => reportRangeSchema.safeParse(input).error?.issues[0]?.message;

test('une plage du Rapport se donne par deux Journées AAAA-MM-JJ, bornes incluses, même inversées', () => {
  assert.deepEqual(reportRangeSchema.parse({ from: '2026-01-01', to: '2026-01-31' }), { from: '2026-01-01', to: '2026-01-31' });
  assert.deepEqual(reportRangeSchema.parse({ from: '2026-01-31', to: '2026-01-01' }), { from: '2026-01-31', to: '2026-01-01' });
});

test('une plage sans « Du », sans « Au » ou illisible est refusée avec PLAGE_DATES_REQUISE', () => {
  assert.equal(rangeRefusal({ to: '2026-01-31' }), 'PLAGE_DATES_REQUISE');
  assert.equal(rangeRefusal({ from: '', to: '2026-01-31' }), 'PLAGE_DATES_REQUISE');
  assert.equal(rangeRefusal({ from: '2026-01-01' }), 'PLAGE_DATES_REQUISE');
  assert.equal(rangeRefusal({ from: '05.01.2026', to: '2026-01-31' }), 'PLAGE_DATES_REQUISE');
  assert.equal(rangeRefusal({ from: '2026-02-31', to: '2026-03-01' }), 'PLAGE_DATES_REQUISE');
});

const userRefusal = (input: unknown) => createUserSchema.safeParse(input).error?.issues[0]?.message;

test('un Utilisateur se crée par Login, Nom facultatif, Email et case « Administrateur », espaces de bord retirés', () => {
  assert.deepEqual(createUserSchema.parse({ login: ' emma ', name: ' Emma ', email: ' emma@exemple.test ', isAdmin: true }), {
    login: 'emma',
    name: 'Emma',
    email: 'emma@exemple.test',
    isAdmin: true,
  });
});

test('sans Nom ni case cochée, un Utilisateur naît sans Nom et non Administrateur', () => {
  assert.deepEqual(createUserSchema.parse({ login: 'emma', email: 'emma@exemple.test' }), {
    login: 'emma',
    name: null,
    email: 'emma@exemple.test',
    isAdmin: false,
  });
  assert.equal(createUserSchema.parse({ login: 'emma', name: '  ', email: 'e@x.test' }).name, null);
});

test('un Login absent, vide ou fait d’espaces est refusé avec LOGIN_REQUIS, avant l’Email', () => {
  assert.equal(userRefusal({ email: 'e@x.test' }), 'LOGIN_REQUIS');
  assert.equal(userRefusal({ login: ' ', email: 'e@x.test' }), 'LOGIN_REQUIS');
  assert.equal(userRefusal({}), 'LOGIN_REQUIS');
});

test('un Email absent, vide ou fait d’espaces est refusé avec EMAIL_REQUIS', () => {
  assert.equal(userRefusal({ login: 'emma' }), 'EMAIL_REQUIS');
  assert.equal(userRefusal({ login: 'emma', email: '  ' }), 'EMAIL_REQUIS');
});

test('la modification de l’Email a les mêmes refus qu’à la création : EMAIL_REQUIS', () => {
  assert.deepEqual(updateUserEmailSchema.parse({ email: ' Emma@Exemple.test ' }), { email: 'Emma@Exemple.test' });
  for (const input of [{}, { email: '' }, { email: ' ' }]) {
    assert.equal(updateUserEmailSchema.safeParse(input).error?.issues[0]?.message, 'EMAIL_REQUIS');
  }
});
