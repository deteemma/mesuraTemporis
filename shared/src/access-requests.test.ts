import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalOf } from './access-requests.js';

test('un compte inconnu arrivé par Google crée une Demande d’accès du fournisseur « google »', () => {
  assert.deepEqual(arrivalOf(['google']), { kind: 'access-request', provider: 'google' });
});

test('un compte inconnu sans fournisseur d’identité (Compte initial, compte de test) devient Utilisateur', () => {
  assert.deepEqual(arrivalOf([]), { kind: 'user' });
});
