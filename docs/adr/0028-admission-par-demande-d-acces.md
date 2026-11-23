# ADR-0028 — Admission des comptes Google et Microsoft par Demande d'accès

- **Statut** : accepté (validé par la responsable fonctionnelle le 2026-11-23)
- **Date** : 2026-11-23
- **Modifie** : ADR-0019 (admission automatique par Google, Microsoft non proposé) ; ADR-0024 (étendu à Microsoft)

## Contexte

Avec l'ADR-0019, toute personne disposant d'un compte Google à l'email vérifié
devient Utilisateur dès sa première connexion. Sans Projet, elle ne voit aucune
donnée. Elle possède pourtant un compte, apparaît dans l'écran Utilisateurs et
peut être affectée, ou rendue Administrateur (ADR-0023), par erreur. La
responsable fonctionnelle veut ouvrir Google et Microsoft sans que n'importe
qui soit admis.

Microsoft avait été écarté à cause du rattachement automatique par Email, que
Keycloak ne protège pas pour ce fournisseur (email non vérifié, tous
locataires). L'ADR-0024 a supprimé tout rattachement. Le risque restant est
l'usurpation : un compte Microsoft peut se présenter avec l'adresse d'une
autre personne.

Options envisagées :
- validation de chaque nouvelle personne par un Administrateur ;
- invitation préalable de l'Email par un Administrateur ;
- liste de domaines autorisés ;
- restriction de Microsoft aux comptes d'organisation ou à une seule
  organisation.

## Décision

**Fournisseurs**
- Google et Microsoft sont proposés. Microsoft accepte tous ses comptes,
  personnels et d'organisation.
- Les règles de l'ADR-0024 valent pour les deux : jamais de rattachement à un
  Utilisateur existant, Login = Email, aucune page de profil. La connexion est
  refusée avec le message standard de Keycloak si l'Email est déjà celui ou le
  Login d'un Utilisateur, ou s'il est réservé par une Demande d'accès.
- Un compte Microsoft qui ne transmet pas d'email est refusé avec le message
  standard, sans Demande d'accès.

**Demande d'accès**
- La première connexion Google ou Microsoft d'une personne inconnue crée une
  Demande d'accès en attente, et non un Utilisateur.
- La Demande d'accès réserve son Email. Créer un Utilisateur avec cet Email
  depuis l'écran Utilisateurs est refusé avec `EMAIL_EXISTANT`.
- En attente, la personne voit une seule page : sa demande est enregistrée et
  doit être validée par un Administrateur, avec son Email et un bouton
  « Se déconnecter ». L'API lui refuse tout le reste.
- Une Demande d'accès n'expire pas et leur nombre n'est pas limité.

**Décision de l'Administrateur**
- L'écran Utilisateurs présente la liste des Demandes d'accès : Email, Nom
  transmis par le fournisseur, fournisseur et date. Pour Microsoft, un
  avertissement indique que l'adresse n'est pas garantie et qu'il faut vérifier
  l'identité de la personne avant d'accepter. Un compteur dans le menu signale
  les demandes en attente.
- Tout Administrateur accepte ou refuse. La décision garde l'Administrateur qui
  l'a prise et sa date.
- **Acceptation** : la personne devient un Utilisateur de rôle `utilisateur`,
  sans Projet. Affectations et rôle se règlent ensuite par les écrans
  existants.
- **Refus** : la demande reste à l'état refusé ; à chaque connexion, la
  personne voit une page indiquant que sa demande a été refusée. Un
  Administrateur peut ensuite l'accepter, ou la supprimer, ce qui libère
  l'Email.

**Existant**
- Les Utilisateurs déjà nés de Google restent des Utilisateurs, sans Demande
  d'accès rétroactive.
- Les comptes créés par un Administrateur (Login et mot de passe) ne passent
  pas par une Demande d'accès.
- Si un Utilisateur né de Google ou de Microsoft est supprimé, sa reconnexion
  crée une nouvelle Demande d'accès en attente.

## Conséquences

- Plus personne n'est admis sans décision d'un Administrateur, quel que soit le
  fournisseur.
- Une personne refusée ne peut pas renouveler sa demande d'elle-même ; seul un
  Administrateur peut la débloquer.
- Sans envoi d'email (ADR-0018), une demande n'est vue que lorsqu'un
  Administrateur ouvre l'application : l'attente peut être longue.
- Le risque d'usurpation d'une adresse par un compte Microsoft repose sur la
  vigilance de l'Administrateur au moment d'accepter.
- Le message standard de Keycloak reste trompeur pour un Email déjà pris
  (ADR-0024).
- Sans limite, un afflux de demandes automatisées encombrerait la liste ; à
  revoir si un abus apparaît.
- Nouvelle donnée partagée : politiques RLS, guards NestJS et extension de
  `scripts/tester-roles.mjs` (ADR-0006).

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
