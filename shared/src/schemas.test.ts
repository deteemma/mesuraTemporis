import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActivitySchema, createProjectSchema, renameActivitySchema } from './schemas.js';

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
