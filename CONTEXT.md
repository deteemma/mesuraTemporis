# Contexte et glossaire métier

Glossaire français ↔ anglais : la documentation et les tickets sont en français,
les identifiants de code en anglais.

## L'application

- **Nom** : Mesura Temporis (nom affiché dans l'interface). `mesuraTemporis` reste le nom technique (dépôt, identifiants).
- **Objectif** : mesurer le temps consommé par chaque Utilisateur sur les Activités des Projets, et en produire des Rapports. Conversion à l'identique de l'application `mesureTemporisMP` ; chaque écart est une décision tracée (ADR 0012+ ou spécification de conversion).
- **Utilisateurs visés** : les membres d'une équipe qui saisissent leur temps, et les Administrateurs qui gèrent comptes, Projets et équipes.
- **Entité partagée** : Projet / `project` (son équipe : `project_member`).
- **Mobile** : phase ultérieure. La conversion de `mesureTemporisMP` est web seule.
- **Hors ligne sur mobile** : plus tard, après la phase mobile en ligne.
- **Données présentes sur le téléphone** : à préciser avec la phase hors ligne.

## Glossaire

### Personnes et comptes

| Français | Code (anglais) | Définition | À éviter |
|---|---|---|---|
| Utilisateur | `app_user` | Personne disposant d'un compte, qui peut saisir du temps. Naît de l'écran Utilisateurs ou de l'acceptation d'une Demande d'accès. | Membre, employé |
| Demande d'accès | `access_request` | Créée par la première connexion Google ou Microsoft d'une personne inconnue. Elle n'est pas un Utilisateur : en attente, elle n'ouvre aucun écran ni aucune donnée. Acceptée par un Administrateur, elle devient un Utilisateur ; refusée, elle reste bloquée jusqu'à ce qu'un Administrateur l'accepte ou la supprime. | Inscription, compte en attente |
| Administrateur | `administrateur` (rôle Keycloak) | Utilisateur qui gère comptes, Projets, Activités et équipes, et voit toutes les Imputations. Il garde tous les droits d'un Utilisateur ; ce n'est pas un compte séparé. | Admin, manager, chef de projet |
| Compte initial | `admin` | Compte Administrateur créé avec le realm, à l'installation seulement. Il n'est pas protégé : comme tout Administrateur, il peut perdre son rôle ou être supprimé, et une mise à jour ne le recrée pas (ADR-0025). | Super-admin, compte racine |
| Login | `login` | Identifiant de connexion par mot de passe, choisi par l'Administrateur, distinct de l'Email et non modifiable. Pour un compte né de Google ou de Microsoft, c'est son Email. | Identifiant email, nom d'utilisateur |
| Email | `email` | Adresse unique d'un Utilisateur. Une première connexion Google ou Microsoft dont l'Email est déjà pris, ou réservé par une Demande d'accès, est refusée : aucun rattachement (ADR-0024, ADR-0028). | Adresse mail, courriel |
| Fournisseur de connexion | `identity_provider` | Google ou Microsoft, par lequel une personne se connecte sans mot de passe. Un Administrateur l'active ou le désactive ; désactivé, il disparaît de l'écran de connexion, mais ses Utilisateurs et ses Demandes d'accès restent inchangés. La connexion par Login et mot de passe n'est pas un Fournisseur de connexion : elle est toujours proposée. | Mode de connexion, type de connexion |
| Nom | `name` | Nom affiché d'un Utilisateur, en un seul champ, facultatif. | Prénom / nom de famille |
| Annuaire des comptes | `AccountDirectory` | Source de vérité des comptes de connexion et de leur rôle (Keycloak), interrogée par l'application. Un compte absent de l'Annuaire n'a aucun rôle. | Keycloak (dans l'interface), annuaire LDAP |

### Projets et temps

| Français | Code (anglais) | Définition | À éviter |
|---|---|---|---|
| Projet | `project` | Regroupement de premier niveau auquel le temps est imputé, via ses Activités. | |
| Équipe | `project_member` | Ensemble des Utilisateurs affectés à un Projet. | Membres |
| Affecté | `contributor` | Utilisateur faisant partie de l'équipe d'un Projet : il peut y saisir du temps, y créer et y renommer des Activités. Seul rôle de Projet attribué. | Membre, contributeur (dans l'interface) |
| Activité | `activity` | Item de travail propre à un Projet, auquel le temps est réellement imputé. Son nom est unique dans le Projet, sans tenir compte de la casse ni des accents. | Tâche |
| Imputation | `time_entry` | Plage de temps (début, fin) d'un Utilisateur sur une Activité d'un Projet. Plusieurs Imputations peuvent se chevaucher. | entrée de temps |
| Auteur | `user_id` (de l'Imputation) | Utilisateur à qui appartient une Imputation. | Propriétaire (réservé au rôle de Projet) |
| Chronomètre | — | Imputation en cours, sans heure de fin. Un Utilisateur n'en a qu'un à la fois ; en démarrer un arrête celui en cours. | Timer, chrono actif |
| Saisie manuelle | — | Création d'une Imputation terminée en indiquant son début et sa fin. | Ajout manuel |
| Édition à la volée | — | Modification sur place de l'heure de début ou de fin d'une Imputation existante. | Édition inline |
| Relancer | — | Démarrer un Chronomètre aujourd'hui sur le Projet et l'Activité d'une Imputation terminée, de n'importe quel jour. L'Imputation d'origine reste inchangée. | Reprendre, redémarrer |
| Scission | — | Découpage automatique, lors d'une Édition à la volée, d'une Imputation qui franchirait minuit : l'original est tronqué à la fin de sa Journée, une nouvelle Imputation couvre l'autre Journée. | Split, découpage |
| Journée | — | Journée calendaire Europe/Zurich, la même pour tous les Utilisateurs. Une Imputation appartient à la Journée de son heure de début. | Jour UTC, date |
| Historique | `history` | Liste des Imputations dans le temps. | Journal, chronologie |

### Mesures et restitution

| Français | Code (anglais) | Définition | À éviter |
|---|---|---|---|
| Durée | — | Temps écoulé entre le début et la fin d'une Imputation : à la seconde au Chronomètre, à la minute en Saisie manuelle ou Édition à la volée. | Temps imputé, temps passé |
| Durée totale | — | Somme des Durées des Imputations terminées d'un Utilisateur sur un Projet ou une Activité, toutes dates confondues. | Total imputé |
| Rapport | — | Agrégation des Durées des Imputations terminées sur une plage de Journées (bornes incluses), groupée par Journée puis par Utilisateur, Projet et Activité ; consultable à l'écran ou exportable en Excel. | Synthèse, résumé, export |
| Synthèse journalière | `daily summary` | Durées des Imputations terminées de l'Utilisateur courant sur une Journée, groupées par Projet et Activité, avec leur total ; exposée par l'API seulement, sans écran. | Rapport journalier |
| Mes projets | — | Écran listant, pour l'Utilisateur courant, les Projets et Activités où il a une Durée totale non nulle. | Mes temps |
| Code d'erreur | — | Identifiant stable d'un refus du serveur, traduit par l'interface (ex. `IMPUTATION_FIN_AVANT_DEBUT`). | Message d'erreur |

### Rôles hérités du socle (jamais attribués)

| Français | Code (anglais) | Définition |
|---|---|---|
| Propriétaire | `owner` | Rôle de Projet du socle, conservé dans `shared/` mais jamais attribué ni proposé. |
| Lecteur | `reader` | Rôle de Projet du socle, conservé dans `shared/` mais jamais attribué ni proposé. |
