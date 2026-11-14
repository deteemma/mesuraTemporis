# ADR-0012 — Journée calendaire Europe/Zurich

- **Statut** : accepté
- **Date** : 2026-11-14

## Contexte

La source découpait les journées à minuit UTC côté serveur, mais interprétait l'heure saisie dans le fuseau du navigateur. La Scission coupait donc à 01:00 ou 02:00 heure suisse, et « aujourd'hui » changeait à 01:00 ou 02:00. Options envisagées : reprendre UTC à l'identique, suivre le fuseau de chaque Utilisateur, ou fixer un fuseau unique.

## Décision

- Une **Journée** est la journée calendaire **Europe/Zurich**, la même pour tous les Utilisateurs, heures d'été et d'hiver comprises.
- Cette frontière s'applique partout : « aujourd'hui », Scission, historique paginé, synthèse journalière, plage du Rapport, colonne « Journée » de l'export Excel, interprétation de l'heure saisie (champ 24h et Saisie manuelle).
- Une Imputation appartient à la Journée de son heure de début (à l'identique).
- Un Chronomètre ou une Saisie manuelle qui franchit minuit reste une seule Imputation, sans Scission (à l'identique).
- Une Saisie manuelle dont la fin précède le début est refusée avec `IMPUTATION_FIN_AVANT_DEBUT` (correction d'un défaut de la source, qui l'acceptait).
- Le calcul de la Journée est écrit une seule fois dans `shared/`, avec ses tests.

## Conséquences

- Écart assumé à la source : des Imputations proches de minuit changent de Journée par rapport à l'ancien découpage UTC (sans effet pratique, aucune donnée n'étant reprise).
- Un Utilisateur hors de Suisse voit les journées découpées à l'heure suisse.
- Les jours de changement d'heure comptent 23 ou 25 heures : les tests de `shared/` doivent les couvrir.

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
