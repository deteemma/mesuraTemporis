# ADR-0013 — Scission automatique à l'Édition à la volée

- **Statut** : accepté
- **Date** : 2026-11-14
- **Reprend** : ADR 0003 de la source (« Scission automatique des Imputations à minuit »)

## Contexte

L'Édition à la volée de l'heure de début ou de fin peut produire une Imputation qui franchit minuit (ex. fin éditée à 00:10 pour un début à 23:50). La source a écarté le refus de l'édition et l'Imputation sur deux journées au profit d'une scission automatique.

## Décision

- Lors d'une Édition à la volée, une Imputation qui franchirait minuit est scindée : l'original est tronqué à la fin de sa Journée (23:59:59.999) ; une nouvelle Imputation, même Auteur, Projet et Activité, couvre l'autre Journée jusqu'à l'heure visée.
- En n'éditant que la fin vers une heure antérieure au début, la coupe va vers le lendemain ; en n'éditant que le début vers une heure postérieure à la fin, la coupe va vers la veille.
- Les deux écritures se font dans une seule transaction.
- L'opération est silencieuse (pas de confirmation), avec un simple message d'information.
- La Scission ne s'applique ni au Chronomètre ni à la Saisie manuelle (voir ADR-0012).
- Les minuits sont ceux de la Journée Europe/Zurich (ADR-0012), et non plus de l'UTC.

## Conséquences

- Une seule action peut produire deux Imputations.
- La règle de Scission est écrite dans `shared/` et testée, y compris les jours de changement d'heure.

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
