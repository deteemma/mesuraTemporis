import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSIGNED_ROLE, PROJECT_ROLES, accountActionRefusal, can, isAdministrator } from './roles.js';

const assignedUser = { isAdmin: false, isAssigned: true };

test('un Affecté consulte le Projet, démarre un Chronomètre et renomme une Activité', () => {
  assert.equal(can(assignedUser, 'viewProject'), true);
  assert.equal(can(assignedUser, 'startTimer'), true);
  assert.equal(can(assignedUser, 'renameActivity'), true);
});

test('un Affecté n’administre ni le Projet, ni son équipe, ni ses Activités', () => {
  assert.equal(can(assignedUser, 'deleteProject'), false);
  assert.equal(can(assignedUser, 'manageTeam'), false);
  assert.equal(can(assignedUser, 'createActivity'), false);
  assert.equal(can(assignedUser, 'deleteActivity'), false);
});

test('l’Administrateur peut tout sur un Projet, même sans y être affecté', () => {
  const admin = { isAdmin: true, isAssigned: false };
  assert.equal(can(admin, 'viewProject'), true);
  assert.equal(can(admin, 'startTimer'), true);
  assert.equal(can(admin, 'deleteProject'), true);
  assert.equal(can(admin, 'manageTeam'), true);
});

test('un Utilisateur non affecté n’a aucun droit sur le Projet', () => {
  const unassignedUser = { isAdmin: false, isAssigned: false };
  assert.equal(can(unassignedUser, 'viewProject'), false);
  assert.equal(can(unassignedUser, 'startTimer'), false);
  assert.equal(can(unassignedUser, 'addManualEntry'), false);
});

test('l’Administrateur est reconnu au rôle « administrateur » du jeton', () => {
  assert.equal(isAdministrator(['offline_access', 'administrateur']), true);
  assert.equal(isAdministrator(['offline_access']), false);
});

test('seul le rôle d’équipe « contributor » est attribué', () => {
  assert.equal(ASSIGNED_ROLE, 'contributor');
  assert.deepEqual([...PROJECT_ROLES].sort(), ['contributor', 'owner', 'reader']);
});

test('retirer le rôle du Compte initial ou le supprimer est refusé, quel que soit l’Administrateur', () => {
  assert.equal(
    accountActionRefusal({ actorId: 'diane', target: { id: 'k-admin', login: 'admin' } }),
    'UTILISATEUR_COMPTE_INITIAL_PROTEGE',
  );
});

test('un Administrateur ne peut ni se retirer son rôle ni se supprimer ; un autre Administrateur le peut', () => {
  const target = { id: 'k-diane', login: 'diane' };
  assert.equal(accountActionRefusal({ actorId: 'k-diane', target }), 'UTILISATEUR_ACTION_SUR_SOI_INTERDITE');
  assert.equal(accountActionRefusal({ actorId: 'k-emma', target }), null);
});

test('le Compte initial qui se vise est refusé comme Compte initial', () => {
  assert.equal(
    accountActionRefusal({ actorId: 'k-admin', target: { id: 'k-admin', login: 'admin' } }),
    'UTILISATEUR_COMPTE_INITIAL_PROTEGE',
  );
});
