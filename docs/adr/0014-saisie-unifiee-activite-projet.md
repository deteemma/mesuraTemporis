# ADR-0014 — Saisie unifiée Activité→Projet par recherche combinée

- **Statut** : accepté
- **Date** : 2026-11-14
- **Reprend** : ADR 0004 de la source

## Contexte

Démarrer un Chronomètre en choisissant d'abord un Projet puis une Activité s'éloigne du flux visé (aspect Clockify). La source a retenu un champ unique proposant des paires « Activité — Projet ».

## Décision

Reprise à l'identique :

- Un champ « Activité » unique ; la frappe recherche les Activités de tous les Projets auxquels l'Utilisateur est affecté (tous les Projets pour un Administrateur), en préfixe ou sous-chaîne.
- Les suggestions sont des paires « Nom d'Activité — Nom de Projet », une ligne par Projet quand le même nom existe dans plusieurs.
- Le démarrage exige une sélection explicite (clic, ou flèches puis Entrée), jamais la frappe seule.
- Sans correspondance, « créer une nouvelle Activité » propose les Projets affectés où ce nom n'existe pas encore ; un Chronomètre sur un nom existant réutilise l'Activité existante.
- L'existence d'un nom est jugée après normalisation (casse et accents ignorés), règle écrite une fois dans `shared/`.

Écart à la source : l'unicité normalisée du nom d'Activité dans un Projet est **garantie par la base** (la source s'en remettait à l'interface). Elle s'applique aussi à la création par l'Administrateur, refusée en doublon avec `ACTIVITE_NOM_DUPLIQUE`. Le même nom reste permis dans deux Projets différents.

## Conséquences

- L'API expose une recherche d'Activités à travers les Projets, filtrée sur l'affectation par l'API (et pas seulement par la RLS).
- Deux créations simultanées du même nom ne peuvent plus produire de doublon.

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
