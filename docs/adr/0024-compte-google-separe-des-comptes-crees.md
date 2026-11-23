# ADR-0024 — Un compte Google n'est jamais rattaché à un compte créé par un Administrateur

- **Statut** : accepté (validé par la responsable fonctionnelle le 2026-11-22)
- **Date** : 2026-11-22
- **Modifie** : ADR-0019 (rattachement par Email à la première connexion Google)
- **Modifié par** : ADR-0028 (règles étendues à Microsoft)

## Contexte

L'ADR-0019 prévoit qu'à sa première connexion Google, une personne est rattachée
à l'Utilisateur existant de même Email, Administrateurs compris.

À l'implémentation (#26), un essai a montré l'effet de ce rattachement sur un
compte créé par un Administrateur. Ce compte porte un mot de passe temporaire
égal au Login (ADR-0018). Après le rattachement, Keycloak impose de changer ce
mot de passe avant d'entrer dans l'application. La personne garde ensuite les
deux moyens de connexion.

Options envisagées :
- garder ce comportement ;
- ne pas exiger le changement de mot de passe lors d'une arrivée par Google ;
- retirer le mot de passe au rattachement ;
- ne jamais rattacher : le compte créé par un Administrateur et le compte Google
  restent séparés.

Les deux options du milieu demandent une extension Java installée dans le
Keycloak du socle, partagé avec d'autres applications : aucune brique standard
de Keycloak ne le permet. La dernière se règle dans le realm de l'application.

## Décision

- Un compte Google n'est jamais rattaché à un Utilisateur existant.
- À sa première connexion, un compte Google crée un Utilisateur (rôle
  `utilisateur`, aucun Projet, sans mot de passe, Login = Email), comme le
  prévoit l'ADR-0019.
- Si l'Email du compte Google est déjà celui d'un Utilisateur, ou déjà le Login
  d'un Utilisateur, la connexion Google est refusée.
- Le refus affiche le message standard de Keycloak (en français « Nom
  d'utilisateur ou mot de passe invalide »). Aucun message dédié.
- Un Utilisateur créé par un Administrateur, Administrateurs compris, se connecte
  uniquement par Login et mot de passe.
- Les autres points de l'ADR-0019 sont inchangés : email vérifié exigé, aucune
  page de profil, pas de Microsoft, pas de connexion par Email.

## Conséquences

- Les récits 4 et 5 de la spécification #11 sont abandonnés : une première
  connexion Google ne rattache plus à un Utilisateur créé par un Administrateur,
  et un Administrateur créé ainsi ne peut pas se connecter avec Google.
- Seul un Utilisateur né de Google se connecte par Google. Devenu
  Administrateur (ADR-0023), il continue de se connecter par Google.
- Le message de refus est trompeur : la personne refusée doit utiliser son Login
  et son mot de passe, ou demander à un Administrateur.
- Le critère d'acceptation de #26 sur le rattachement est remplacé par : « un
  compte Google dont l'Email est celui d'un Utilisateur existant est refusé ».

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
