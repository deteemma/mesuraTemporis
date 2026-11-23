# ADR-0027 — Codes d'erreur de format de l'Annuaire

- **Statut** : accepté (validé par la responsable fonctionnelle le 2026-11-22)
- **Date** : 2026-11-22
- **Complète** : ADR-0021 (catalogue des Codes d'erreur)

## Contexte

L'ADR-0021 fixe le catalogue des Codes d'erreur : ceux de la source, moins
`PROJET_NON_AFFECTE` et ceux de l'authentification maison, plus
`UTILISATEUR_COMPTE_INITIAL_PROTEGE` et `UTILISATEUR_ACTION_SUR_SOI_INTERDITE`.

À l'écran Utilisateurs (#24), c'est Keycloak qui contrôle le format du Login,
de l'Email et du Nom à la création d'un Utilisateur. Sans code dédié, ses
refus remontaient en erreur interne, sans message compréhensible. La
traduction de ces refus a été validée à la clôture du #24, sans être tracée
par un ADR.

## Décision

Trois Codes d'erreur sont ajoutés au catalogue de `shared/` :

- `LOGIN_INVALIDE` : 3 caractères au moins, lettres, chiffres et `. - _ @`
  seulement ;
- `EMAIL_INVALIDE` : Email mal formé ;
- `NOM_INVALIDE` : 255 caractères au plus, sans caractères spéciaux.

Ils traduisent les refus de format de Keycloak, dans les quatre langues, comme
les autres Codes d'erreur.

## Conséquences

- Le catalogue de la cible est celui de l'ADR-0021, plus ces trois codes.
- Les règles de format restent celles de Keycloak. Si le realm les change, les
  messages de ces trois codes doivent suivre.

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
