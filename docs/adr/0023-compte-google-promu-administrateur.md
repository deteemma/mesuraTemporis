# ADR-0023 — Un compte né de Google peut devenir Administrateur

- **Statut** : accepté (validé par la responsable fonctionnelle le 2026-11-22)
- **Date** : 2026-11-22
- **Complète** : ADR-0018 (point « Un compte né de Google est toujours `utilisateur` »)

## Contexte

L'ADR-0018 permet à un Administrateur d'attribuer ou de retirer le rôle
`administrateur` depuis l'écran Utilisateurs, à la création comme ensuite. Il
précise aussi qu'« un compte né de Google est toujours `utilisateur` ».

À l'implémentation du changement de rôle (#25), cette phrase s'est révélée
ambiguë. Elle peut décrire le rôle d'un compte Google à sa naissance (ADR-0019 :
« un Utilisateur est créé (rôle `utilisateur`, …) »). Elle peut aussi interdire
de lui attribuer le rôle ensuite.

Options envisagées :
- refuser l'attribution du rôle à un compte né de Google, avec un nouveau Code
  d'erreur ;
- traiter un compte né de Google comme tout autre Utilisateur une fois créé.

## Décision

- Un compte né de Google naît avec le rôle `utilisateur`, comme le prévoit
  l'ADR-0019.
- Ensuite, un Administrateur peut lui attribuer ou lui retirer le rôle
  `administrateur` depuis l'écran Utilisateurs, comme pour tout autre compte.
- Aucun Code d'erreur n'est ajouté.

## Conséquences

- Le bouton « Rendre administrateur » s'applique sans exception à toutes les
  lignes de l'écran Utilisateurs.
- Un Administrateur né de Google se connecte uniquement par Google. Le risque
  résiduel accepté par l'ADR-0019 (une adresse ni Gmail ni Workspace, pour
  laquelle Google ne fait pas autorité) porte alors sur des droits
  d'Administrateur. À surveiller au moment d'attribuer le rôle.

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
