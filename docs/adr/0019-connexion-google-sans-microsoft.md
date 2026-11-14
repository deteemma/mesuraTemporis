# ADR-0019 — Connexion Google avec rattachement par Email, sans Microsoft

- **Statut** : accepté
- **Date** : 2026-11-14
- **Reprend** : ADR 0009 de la source ; **écart** à l'ADR-0005 (Microsoft)

## Contexte

La source offrait la connexion Google en complément du mot de passe, avec création automatique ou rattachement par Email. L'ADR-0005 prévoit Google et Microsoft. La recherche (tickets #3 et #4) montre que le rattachement automatique par Email est sûr pour Google si l'email vérifié est exigé, mais ouvre une prise de contrôle de compte avec le fournisseur Microsoft de Keycloak (email non vérifié, tous locataires).

## Décision

- **Google** : ouvert à tout compte Google. À la première connexion, un Utilisateur est créé (rôle `utilisateur`, aucun Projet, pas de mot de passe, Login = Email) ou rattaché à l'Utilisateur existant de même Email. L'email vérifié par Google est exigé. Aucune page de profil ne s'affiche. Les Administrateurs sont rattachables comme les autres.
- **Microsoft** : non proposé. Le fournisseur reste sans identifiants, donc désactivé.
- **Connexion par Email désactivée** : seul le Login sert à la connexion par mot de passe.

## Conséquences

- Risque résiduel accepté : un compte Google dont l'adresse n'est ni Gmail ni Workspace, pour laquelle Google ne fait pas autorité.
- Un rattachement est aussi possible vers un compte dont le Login égale l'Email ; seuls les comptes nés de Google sont dans ce cas.
- Ajouter Microsoft plus tard demanderait un nouvel ADR (sans rattachement automatique, ou limité à un locataire).

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
