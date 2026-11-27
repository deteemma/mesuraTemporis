import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deactivationRefusal, isProviderEnabled } from './identity-providers.js';

test('sans choix d’un Administrateur, un fournisseur est activé si ses identifiants sont présents', () => {
  assert.equal(isProviderEnabled(true, null), true);
  assert.equal(isProviderEnabled(false, null), false);
});

test('le choix de l’Administrateur l’emporte, mais un fournisseur non configuré reste désactivé', () => {
  assert.equal(isProviderEnabled(true, false), false);
  assert.equal(isProviderEnabled(true, true), true);
  assert.equal(isProviderEnabled(false, true), false);
});

const withPassword = { hasPassword: true, providers: [] };
const bornOfGoogle = { hasPassword: false, providers: ['google'] };
const bornOfMicrosoft = { hasPassword: false, providers: ['microsoft'] };

test('désactiver Google est permis tant qu’un Administrateur garde un mot de passe', () => {
  assert.equal(deactivationRefusal([bornOfGoogle, withPassword], 'google', ['google', 'microsoft']), null);
});

test('désactiver Google est permis si un Administrateur né de Microsoft garde son fournisseur activé', () => {
  assert.equal(deactivationRefusal([bornOfGoogle, bornOfMicrosoft], 'google', ['google', 'microsoft']), null);
});

test('désactiver Google est refusé s’il ne laisse aucun Administrateur capable de se connecter', () => {
  assert.equal(deactivationRefusal([bornOfGoogle], 'google', ['google', 'microsoft']), 'AUCUN_ADMINISTRATEUR_CONNECTABLE');
});

test('un Administrateur né de Microsoft ne compte pas si Microsoft est déjà désactivé', () => {
  assert.equal(deactivationRefusal([bornOfGoogle, bornOfMicrosoft], 'google', ['google']), 'AUCUN_ADMINISTRATEUR_CONNECTABLE');
});
