# ADR-0025 — Le Compte initial peut être supprimé et perdre son rôle

- **Statut** : accepté (validé par la responsable fonctionnelle le 2026-11-22)
- **Date** : 2026-11-22
- **Modifie** : ADR-0018 (points « Compte initial » et « Protection »)

## Contexte

L'ADR-0018 déclare le Compte initial `admin` dans `keycloak/realm.json` et
interdit de le supprimer ou de lui retirer son rôle
(`UTILISATEUR_COMPTE_INITIAL_PROTEGE`), pour qu'il reste toujours au moins un
Administrateur.

Depuis l'ADR-0024, un Administrateur né de Google (ADR-0023) peut remplacer le
Compte initial. La responsable fonctionnelle souhaite pouvoir alors supprimer ce
dernier.

Deux constats faits sur le Keycloak local :
- La garantie d'au moins un Administrateur ne dépend pas du Compte initial.
  Seul un Administrateur peut supprimer un compte ou retirer un rôle, et il ne
  peut pas le faire sur lui-même (ADR-0018). Celui qui agit reste donc
  Administrateur.
- Un compte déclaré dans le realm revient au réimport. Après sa suppression,
  l'application d'un realm modifié (nouvelle version) recrée `admin` avec le
  mot de passe `admin` temporaire et le rôle `administrateur`. Un rôle retiré
  est rendu de la même façon.

Options envisagées pour ce retour :
- déclarer le Compte initial à part, et ne l'appliquer qu'à l'installation ;
- garder la déclaration dans le realm et faire vérifier à l'installateur,
  après chaque mise à jour, que `admin` n'est pas revenu.

## Décision

- Le Compte initial peut être supprimé et peut perdre le rôle `administrateur`,
  comme tout autre Administrateur, depuis l'écran Utilisateurs.
- Aucun refus « dernier Administrateur » n'est ajouté : la règle des actions sur
  soi (ADR-0018) suffit. Le Code d'erreur `UTILISATEUR_COMPTE_INITIAL_PROTEGE`
  est retiré.
- Le Compte initial n'est plus déclaré dans `keycloak/realm.json`. Il est
  déclaré dans un fichier à part de l'application, appliqué uniquement quand le
  realm est créé, c'est-à-dire à l'installation.
- Une mise à jour de l'application ne recrée jamais le Compte initial et ne lui
  rend jamais son rôle.
- Le reste de l'ADR-0018 est inchangé : Login `admin`, rôle `administrateur` et
  mot de passe `admin` temporaire à l'installation.

## Conséquences

- Le script `appliquer-realm.sh` du socle doit savoir appliquer ce fichier à la
  création du realm seulement. C'est une modification du socle, partagé avec
  les autres applications ; elle se fait par un commit dans le dépôt du socle.
  `INSTALL.md` de l'application suit.
- Sur une installation existante, retirer `admin` du realm ne doit pas
  supprimer le compte existant. À vérifier à l'implémentation.
- Risque résiduel accepté : deux Administrateurs qui se suppriment l'un l'autre
  au même instant peuvent laisser l'application sans Administrateur.
- Sans Administrateur, il faut passer par la console d'administration du
  Keycloak du socle pour en recréer un.
- La définition « Compte initial » du glossaire (`CONTEXT.md`) change : il n'est
  plus protégé.

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
