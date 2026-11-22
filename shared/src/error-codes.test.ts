import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES, errorBody, isErrorCode } from './error-codes.js';

test('le catalogue des Codes d’erreur est celui de la spécification #11, plus les refus de format du #24', () => {
  assert.deepEqual([...ERROR_CODES].sort(), [
    'ACCES_REFUSE',
    'ACTIVITE_INTROUVABLE',
    'ACTIVITE_NOM_DUPLIQUE',
    'AUCUN_CHRONO_ACTIF',
    'EMAIL_EXISTANT',
    'EMAIL_INVALIDE',
    'EMAIL_REQUIS',
    'ERREUR_INTERNE',
    'IMPUTATION_CHAMPS_REQUIS',
    'IMPUTATION_FIN_AVANT_DEBUT',
    'IMPUTATION_INTROUVABLE',
    'LOGIN_EXISTANT',
    'LOGIN_INVALIDE',
    'LOGIN_REQUIS',
    'NOM_INVALIDE',
    'NOM_REQUIS',
    'PLAGE_DATES_REQUISE',
    'PROJET_INTROUVABLE',
    'UTILISATEUR_ACTION_SUR_SOI_INTERDITE',
    'UTILISATEUR_INTROUVABLE',
  ]);
});

test('un code du catalogue est reconnu', () => {
  assert.equal(isErrorCode('PROJET_INTROUVABLE'), true);
});

test('un code retiré de la source n’est plus reconnu', () => {
  assert.equal(isErrorCode('PROJET_NON_AFFECTE'), false);
  assert.equal(isErrorCode('JETON_INVALIDE'), false);
  assert.equal(isErrorCode('UTILISATEUR_COMPTE_INITIAL_PROTEGE'), false);
});

test('une valeur qui n’est pas un texte n’est pas un code', () => {
  assert.equal(isErrorCode(undefined), false);
  assert.equal(isErrorCode(404), false);
});

test('un refus porte son Code d’erreur et le message français de repli', () => {
  assert.deepEqual(errorBody('PROJET_INTROUVABLE'), { code: 'PROJET_INTROUVABLE', message: 'Projet introuvable' });
});
