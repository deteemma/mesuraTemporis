# ADR-0017 — L'Administrateur passe outre le partage par Projet ; un seul rôle de Projet attribué

- **Statut** : accepté
- **Date** : 2026-11-14
- **Complète** : ADR-0006 (sans le modifier)

## Contexte

L'ADR-0006 prévoit trois rôles par Projet (propriétaire, contributeur, lecteur) et une double barrière. La source n'a que deux notions : l'Administrateur, qui voit et gère tout, et l'affectation à l'équipe d'un Projet. Il fallait faire correspondre les deux sans perdre l'une ou l'autre.

## Décision

1. **Administrateur au-dessus du partage.** Le rôle Keycloak `administrateur` donne accès à tous les Projets, Activités, équipes et Imputations, et à la liste de tous les Utilisateurs. Il peut saisir du temps sur tout Projet. L'ajouter à une équipe ne change pas ses droits. Les deux barrières le reconnaissent : l'API transmet à chaque transaction l'identifiant de l'Utilisateur et un indicateur « administrateur ».
2. **Un seul rôle attribué.** Être affecté à l'équipe = membre `contributor` : voir le Projet, créer une Activité en démarrant un Chronomètre, renommer une Activité, saisir son temps. `owner` et `reader` restent dans `shared/` mais ne sont jamais attribués ni proposés. Le déclencheur du socle « créateur = propriétaire » est retiré : un Projet naît avec une équipe vide.
3. **Imputations de l'Auteur.** Chacun ne voit que ses propres Imputations, même sur un Projet dont il est membre ; l'Administrateur voit toutes. L'accès d'un Auteur à ses Imputations (lecture, modification, suppression) ne dépend pas de son affectation ; seule la création l'exige.
4. **Non-membre et Imputation d'autrui** : 404 (`PROJET_INTROUVABLE`, `IMPUTATION_INTROUVABLE`), conformément à l'ADR-0006 ; `PROJET_NON_AFFECTE` disparaît du catalogue.
5. **Retrait de l'équipe** : le retrait d'un Utilisateur non administrateur arrête son Chronomètre sur ce Projet dans la même transaction, avec une fin à l'instant du retrait.

## Conséquences

- `scripts/tester-roles.mjs` est étendu pour prouver que l'Administrateur passe les deux barrières, qu'un Affecté ne voit pas les Imputations des autres, et qu'un Utilisateur retiré garde l'accès à ses Imputations.
- Écarts à la source : 404 au lieu de 403 ; arrêt du Chronomètre au retrait (la source le laissait courir).

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
