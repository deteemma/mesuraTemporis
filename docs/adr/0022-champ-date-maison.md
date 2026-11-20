# ADR-0022 — Champ date maison au format jj.mm.aaaa

- **Statut** : accepté (validé par la responsable fonctionnelle le 2026-11-20)
- **Date** : 2026-11-20
- **Complète** : ADR-0020 (point « Les champs date (Saisie manuelle, plage du Rapport) restent natifs »)

## Contexte

L'ADR-0020 gardait les champs date natifs du navigateur, à l'identique de la
source. Au contrôle visuel de la Saisie manuelle (#18), le champ date-heure
natif s'affichait `mm/dd/yyyy` avec une heure AM/PM : son format suit le réglage
de langue du navigateur ou du système, pas la langue de l'application. Un poste
réglé en anglais américain impose donc un format non européen.

Options envisagées : garder le champ natif (format dépendant du poste) ; un
champ date maison au format fixe.

## Décision

- Les champs date de l'application sont des champs maison, au format
  **jj.mm.aaaa** (format suisse), dans les quatre langues, quel que soit le
  réglage du navigateur : Saisie manuelle et, à venir, plage du Rapport.
- L'heure qui accompagne une date est saisie dans un champ texte 24 h, avec
  l'analyse tolérante du champ heure de l'Édition à la volée (« 9 », « 930 »,
  « 9:30 »).
- Une date saisie doit exister au calendrier (pas de 31.02) ; une date ou une
  heure illisible est signalée sur place, sans appel au serveur.
- L'analyse et la mise en forme de la date sont écrites une seule fois dans
  `shared/`, avec leurs tests.
- Écart à la source, à ajouter au registre des écarts de la spécification de
  conversion (#11).

## Conséquences

- Affichage identique sur tous les postes, sans dépendre du navigateur.
- Plus de calendrier déroulant natif : la date se tape au clavier.
- Deux libellés d'erreur à traduire dans les quatre langues (date invalide,
  heure invalide déjà présente).

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
