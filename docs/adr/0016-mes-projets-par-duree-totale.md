# ADR-0016 — « Mes projets » n'affiche que les Projets à Durée totale non nulle

- **Statut** : accepté
- **Date** : 2026-11-14
- **Reprend** : ADR 0010 de la source

## Contexte

Mes projets liste, pour l'Utilisateur courant, ses Projets et Activités avec leur Durée totale. Ailleurs, l'affectation suffit pour voir un Projet ; afficher ici les Projets à Durée totale nulle créerait des entrées vides.

## Décision

Reprise à l'identique :

- Un Projet apparaît dans Mes projets si l'Utilisateur y est **affecté** **et** y a au moins une Imputation terminée ; une Activité apparaît si l'Utilisateur y a au moins une Imputation terminée.
- La Durée totale ne compte que les Imputations terminées ; le Chronomètre en cours est exclu.
- Un Projet dont l'Utilisateur a été retiré disparaît de Mes projets, avec ses Activités et sa Durée totale ; ses Imputations restent visibles dans la Saisie de temps et le Rapport.

## Conséquences

L'affectation reste la condition pour agir ; elle ne suffit pas pour apparaître sur cet écran.

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
