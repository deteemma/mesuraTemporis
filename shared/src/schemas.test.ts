import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectSchema } from './schemas.js';

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
