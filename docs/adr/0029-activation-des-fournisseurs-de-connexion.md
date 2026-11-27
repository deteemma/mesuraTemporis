# ADR-0029 — Activation des Fournisseurs de connexion par un Administrateur

- **Statut** : accepté (validé par la responsable fonctionnelle le 2026-11-27)
- **Date** : 2026-11-27
- **Modifie** : ADR-0028 (« Google et Microsoft sont proposés »)

## Contexte

Aujourd'hui, Google et Microsoft sont activés au déploiement, dès que leurs
identifiants figurent dans `.env` (`GOOGLE_ENABLED`, `MICROSOFT_ENABLED` fournis
par le socle). La responsable fonctionnelle veut qu'un Administrateur choisisse,
depuis l'application, quels Fournisseurs de connexion l'écran de connexion
propose.

Options envisagées :
- réglage dans la console Keycloak : rien à développer, mais il faut le compte
  administrateur du socle, et une réapplication du realm écrase le choix ;
- réglage dans l'application, mémorisé par elle et réappliqué à Keycloak.

## Décision

**Réglage**
- Un écran « Connexions », réservé aux Administrateurs, présente Google et
  Microsoft, chacun avec un interrupteur. Tout Administrateur peut le changer.
- L'écran indique qui a fait la dernière modification de chaque fournisseur, et
  quand. Aucun historique complet n'est gardé.
- Un fournisseur sans identifiants dans `.env` est affiché « non configuré », et
  son interrupteur est grisé.
- La connexion par Login et mot de passe n'est pas concernée : elle est
  toujours proposée. Les deux fournisseurs peuvent être désactivés ensemble.

**État initial et persistance**
- À l'installation, un fournisseur est activé si ses identifiants sont
  présents, comme avant.
- Ensuite, le choix de l'Administrateur l'emporte. Il est mémorisé dans la base
  de l'application, et l'API le réapplique à Keycloak au démarrage. Il survit
  ainsi à un déploiement et à une réapplication du realm.

**Désactivation**
- Une confirmation indique combien d'Utilisateurs nés de ce fournisseur ne
  pourront plus se connecter, et si l'Administrateur qui désactive en fait
  partie. L'activation se fait sans confirmation.
- La désactivation est refusée, avec un Code d'erreur, si elle ne laisse aucun
  Administrateur capable de se connecter. Un Administrateur est capable de se
  connecter s'il a un mot de passe ou si son fournisseur reste activé.
- Rien d'autre n'est modifié. Les Utilisateurs nés du fournisseur restent
  affichables, affectables et modifiables, sans mention particulière. Les
  Demandes d'accès en attente ou refusées restent dans la liste et peuvent
  encore être acceptées, refusées ou supprimées.
- Les sessions en cours ne sont pas interrompues : elles durent jusqu'à leur
  expiration normale.

**Réactivation**
- Les comptes du fournisseur se reconnectent comme avant. Les règles de
  l'ADR-0028 s'appliquent de nouveau.

## Conséquences

- Le compte de service `api-admin` reçoit le rôle Keycloak
  `manage-identity-providers`. C'est un droit nouveau, limité aux fournisseurs,
  et non `manage-realm`.
- Le réglage est une nouvelle donnée partagée : elle demande des politiques
  RLS, des guards NestJS et une extension de `scripts/tester-roles.mjs`
  (ADR-0006).
- Entre un déploiement et le démarrage de l'API, Keycloak suit `.env` quelques
  instants. Un fournisseur désactivé peut donc réapparaître brièvement.
- Une Demande d'accès acceptée pendant que son fournisseur est désactivé donne
  un Utilisateur qui ne pourra se connecter qu'à la réactivation.
- Un changement fait directement dans la console Keycloak est écrasé au
  prochain démarrage de l'API.

> Rappel : un ADR accepté n'est jamais modifié de sa propre initiative. Pour le
> faire évoluer, on propose un nouvel ADR et on attend une validation explicite.
