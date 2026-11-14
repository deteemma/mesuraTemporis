# ADR-0018 — Comptes : changement de rôle et Compte initial protégé

- **Statut** : accepté
- **Date** : 2026-11-14
- **Remplace** : ADR 0001 de la source (« Compte Administrateur créé automatiquement à l'installation »)

## Contexte

La source créait un compte `admin`/`admin` au démarrage, n'avait qu'un Administrateur et aucun changement de rôle. Avec Keycloak (ADR-0005), les comptes vivent dans le realm et l'écran Utilisateurs pilote Keycloak. Options étudiées pour le premier Administrateur : compte déclaré dans le realm avec mot de passe initial ; compte sans mot de passe connecté par un fournisseur externe ; amorçage par l'API depuis une adresse e-mail.

## Décision

- **Compte initial** : `admin` est déclaré dans `keycloak/realm.json`, rôle `administrateur`, mot de passe initial `admin` temporaire (changement imposé par Keycloak). Ce mot de passe n'est posé qu'à la création ; un réimport ne l'écrase pas.
- **Protection** : retirer le rôle du Compte initial ou le supprimer est refusé avec `UTILISATEUR_COMPTE_INITIAL_PROTEGE`. Il reste donc toujours au moins un Administrateur.
- **Changement de rôle** (écart à la source) : un Administrateur attribue ou retire le rôle `administrateur` depuis l'écran Utilisateurs, à la création comme ensuite. Un compte né de Google est toujours `utilisateur`.
- **Actions sur soi-même** : un Administrateur ne peut ni se retirer son rôle ni supprimer son propre compte (`UTILISATEUR_ACTION_SUR_SOI_INTERDITE`) ; un autre Administrateur le peut. Écart à la source, qui autorisait la suppression de soi.
- **Effet immédiat** : un retrait de rôle ou une suppression ferme aussitôt toutes les sessions de la personne.
- **Création** : Login saisi par l'Administrateur, distinct de l'Email et non modifiable ; mot de passe temporaire égal au Login ; Email obligatoire et modifiable ; un seul champ Nom, facultatif. Pas de SMTP, donc pas de « mot de passe oublié ».
- **Suppression** : suppression du compte Keycloak et cascade des Imputations et affectations, après un dialogue de confirmation chiffré (écart à la source).
- L'API pilote Keycloak par un compte de service `api-admin` déclaré dans le realm (rôles `manage-users`, `view-users`, `view-realm`).

## Conséquences

- Le mot de passe `admin` est connu de tous jusqu'à la première connexion : l'installation doit être suivie d'une connexion immédiate.
- `KEYCLOAK_ADMIN_CLIENT_SECRET` doit être transmis au service `api` (ADR-0007).

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
