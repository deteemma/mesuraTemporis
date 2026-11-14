# ADR-0020 — Interface web maison : traduction, styles et champ heure sans bibliothèque

- **Statut** : accepté
- **Date** : 2026-11-14
- **Reprend** : ADR 0002, 0006 et 0007 de la source

## Contexte

L'interface est reprise à l'identique (aspect Clockify, 4 langues sans rechargement, champ heure 24h). La source avait écarté les bibliothèques de composants et de traduction. L'ébauche React (ticket #6) a vérifié que le même choix reproduit le rendu sans différence.

## Décision

- **Traduction maison** : un contexte React et les dictionnaires fr, en, de, it de la source repris tels quels, chargés statiquement ; repli sur le français puis sur la clé ; changement de langue immédiat et mémorisé.
- **Styles maison** : CSS global reprenant les jetons et styles de la source ; aucune bibliothèque de composants.
- **Champ heure maison** pour l'Édition à la volée : saisie et affichage 24h garantis, frappe directe tolérante. Les champs date (Saisie manuelle, plage du Rapport) restent natifs.

## Conséquences

- Chaque composant est stylé à la main.
- Passer plus tard à une bibliothèque de traduction demanderait de reprendre chaque appel.
- Tout nouveau libellé doit être traduit dans les quatre langues.

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
