# ADR-0015 — Renommer une Activité est ouvert à tout Affecté

- **Statut** : accepté
- **Date** : 2026-11-14
- **Reprend** : ADR 0005 de la source

## Contexte

Le renommage depuis la Saisie de temps sert au quotidien à toute l'équipe, pas seulement à l'Administrateur. Le garder réservé à l'Administrateur aurait privé l'équipe de ce geste.

## Décision

- Tout Affecté du Projet (rôle `contributor`) et tout Administrateur peut renommer une Activité de ce Projet.
- Créer une Activité hors Chronomètre et supprimer une Activité restent réservés à l'Administrateur (écran Activités du Projet).
- Le nouveau nom s'applique aussitôt à toutes les Imputations de l'Activité, Rapports compris.
- Un renommage vers un nom déjà présent dans le Projet (après normalisation) est refusé avec `ACTIVITE_NOM_DUPLIQUE`.
- Un Utilisateur retiré de l'équipe ne peut plus renommer : 404 `PROJET_INTROUVABLE`.
- Personne ne renomme un Projet (à l'identique).

## Conséquences

Un renommage par un Affecté change l'affichage pour toute l'équipe, sans historique des anciens noms.

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
