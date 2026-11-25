import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalOf, decisionRefusal } from './access-requests.js';

test('un compte inconnu arrivé par Google crée une Demande d’accès du fournisseur « google »', () => {
  assert.deepEqual(arrivalOf(['google']), { kind: 'access-request', provider: 'google' });
});

test('un compte inconnu sans fournisseur d’identité (Compte initial, compte de test) devient Utilisateur', () => {
  assert.deepEqual(arrivalOf([]), { kind: 'user' });
});

test('une demande en attente s’accepte ou se refuse, mais ne se supprime pas', () => {
  assert.equal(decisionRefusal('pending', 'accept'), null);
  assert.equal(decisionRefusal('pending', 'refuse'), null);
  assert.equal(decisionRefusal('pending', 'delete'), 'DEMANDE_ACCES_NON_REFUSEE');
});

test('une demande refusée s’accepte ou se supprime, mais ne se refuse pas une seconde fois', () => {
  assert.equal(decisionRefusal('refused', 'accept'), null);
  assert.equal(decisionRefusal('refused', 'delete'), null);
  assert.equal(decisionRefusal('refused', 'refuse'), 'DEMANDE_ACCES_DEJA_REFUSEE');
});
