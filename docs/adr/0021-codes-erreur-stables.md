# ADR-0021 — Codes d'erreur stables, catalogue dans `shared/`

- **Statut** : accepté
- **Date** : 2026-11-14
- **Reprend** : ADR 0008 de la source

## Contexte

Pour traduire les refus du serveur sans dictionnaires côté API, la source renvoyait un code stable que l'interface traduit.

## Décision

- Tout refus métier de l'API porte un Code d'erreur stable ; l'interface le traduit dans les quatre langues.
- Le catalogue est écrit une seule fois dans `shared/`, partagé par l'API et le web.
- Codes de la source conservés, sauf `PROJET_NON_AFFECTE` (supprimé, ADR-0017) et ceux de l'authentification maison, rendus sans objet par Keycloak. Codes ajoutés : `UTILISATEUR_COMPTE_INITIAL_PROTEGE`, `UTILISATEUR_ACTION_SUR_SOI_INTERDITE`.
- Écart à la source : les refus sont affichés (bandeau sous la Saisie manuelle, notification ailleurs), là où la source n'affichait rien.

## Conséquences

Tout nouveau chemin de refus doit recevoir un code et ses quatre traductions.

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
