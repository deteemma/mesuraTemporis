# Piloter Keycloak depuis l'API NestJS (écran Utilisateurs)

> Recherche pour le ticket #3. Branche `research/keycloak-admin-api`, jamais fusionnée.
> Date : 2026-11-12. Aucune règle de gestion n'est tranchée ici : les choix
> fonctionnels sont listés en fin de document comme **questions** pour la responsable fonctionnelle.

## 0. Versions concernées

| Composant | Version | Source |
|---|---|---|
| Keycloak | **26.8.1** (`quay.io/keycloak/keycloak:26.8.1`) | `socle/compose.yaml`, service `keycloak` |
| keycloak-config-cli | **6.5.1** (image `adorsys/keycloak-config-cli:6.5.1-26`, compilée pour Keycloak 26) | `socle/compose.yaml`, service `keycloak-config` |
| `@keycloak/keycloak-admin-client` | 26.8.1 disponible (dernière : 26.8.2), ESM (`"type": "module"`), Node ≥ 18 | registre npm, `https://registry.npmjs.org/@keycloak/keycloak-admin-client/26.8.1` |

Toutes les références de code Keycloak ci-dessous sont lues au tag `26.8.1` du dépôt
`keycloak/keycloak` ; celles de keycloak-config-cli au tag `v6.5.1` de `adorsys/keycloak-config-cli`.

## 1. Ce qui existe déjà (à ne pas réinventer)

**Dans le socle** (lecture seule, `C:\nvm4w\socleApp\socle`) :

- `scripts/appliquer-realm.sh` génère **déjà** un secret `KEYCLOAK_ADMIN_CLIENT_SECRET`
  (`openssl rand -hex 24`), l'écrit **une fois** dans le `.env` de l'application, puis le
  transmet à keycloak-config-cli (`-e KEYCLOAK_ADMIN_CLIENT_SECRET=...`). Le commentaire
  du script annonce un client « `api-admin` », « s'il est déclaré » (commit socle `51e223c`).
- keycloak-config-cli tourne avec `IMPORT_VARSUBSTITUTION_ENABLED=true` (syntaxe `$(env:VAR)`)
  et `IMPORT_MANAGED_CLIENT=full` en production (`no-delete` seulement quand
  `comptes-test.json` est importé en local).
- Le realm d'une autre application du socle (`socle/keycloak/realms/acta.json`) déclare déjà
  ce client `api-admin` et son compte de service : c'est un précédent directement réutilisable
  (extrait en §2).
- Le socle ne configure **aucun serveur SMTP** dans les realms : les actions « par e-mail »
  de Keycloak (`execute-actions-email`, `reset-password-email`) ne sont pas utilisables
  aujourd'hui.

**Dans ce dépôt** :

- `keycloak/realm.json` : rôle de realm `administrateur`, clients publics `web` et `mobile`,
  pas encore de client `api-admin`, aucune entrée `users`.
- `keycloak/comptes-test.json` (local uniquement) : `admin` porte déjà `realmRoles: ["administrateur"]`.
- `api/src/auth/oidc-verifier.service.ts` lit `realm_access.roles` du jeton ;
  `@RequireAppRole('administrateur')` (`api/src/auth/authenticated-user.ts`) et `AuthGuard`
  protègent déjà les routes par rôle.
- `api/src/config/app-config.ts` valide l'environnement (zod) ; `compose.yaml` ne transmet
  pas encore `KEYCLOAK_ADMIN_CLIENT_SECRET` au conteneur `api`.

## 2. Compte de service : client confidentiel `api-admin`

### Déclaration dans `keycloak/realm.json`

À ajouter (repris du précédent `acta.json` du socle) :

```jsonc
"clients": [
  // … web, mobile …
  {
    "clientId": "api-admin",
    "name": "API : administration des comptes (compte technique)",
    "publicClient": false,
    "clientAuthenticatorType": "client-secret",
    "secret": "$(env:KEYCLOAK_ADMIN_CLIENT_SECRET)",
    "serviceAccountsEnabled": true,
    "standardFlowEnabled": false,
    "directAccessGrantsEnabled": false,
    "implicitFlowEnabled": false
  }
],
"users": [
  {
    "username": "service-account-api-admin",
    "enabled": true,
    "serviceAccountClientId": "api-admin",
    "clientRoles": {
      "realm-management": ["view-users", "manage-users", "view-realm"]
    }
  }
]
```

Points vérifiés :

- keycloak-config-cli traite spécialement l'utilisateur portant `serviceAccountClientId`
  (`UserImportService.java`, `importUser()` : « The service accounts shall not be taken into
  account » pour la règle e-mail = identifiant ; `serviceAccountClientId` fait partie des
  propriétés ignorées à la mise à jour, `ALWAYS_IGNORED_PROPERTIES_FOR_UPDATE`).
- Comme `IMPORT_MANAGED_CLIENT=full` en production, le client **doit** figurer dans
  `realm.json` (et pas dans `comptes-test.json`), sinon il serait supprimé au prochain
  `appliquer-realm.sh` (`docs/MANAGED.md` de keycloak-config-cli, « Full Managed Resources » : `client`).
- Les utilisateurs ne sont **pas** une ressource « gérée » : keycloak-config-cli ne supprime
  jamais un compte absent du fichier (`docs/MANAGED.md`, la table ne contient pas `user`).
  Les comptes créés depuis l'écran Utilisateurs ne seront donc pas effacés par un réimport.
- Le secret est réappliqué à chaque import à partir du `.env` : il reste stable tant que
  `KEYCLOAK_ADMIN_CLIENT_SECRET` ne change pas (le socle ne le régénère que s'il est vide).

### Rôles `realm-management` minimaux — justification par le code

Keycloak 26.8.1, mode « rôles d'administration » classique (sans permissions fines) :

| Opération de l'écran | Endpoint Admin REST | Contrôle dans le code | Rôle suffisant |
|---|---|---|---|
| Lister / chercher les comptes | `GET /admin/realms/{realm}/users?search=&first=&max=` | `UsersResource.getUsers` → `requireQuery()` ; `canQuery()` = `query-users` **ou** `canView()` (`fgap/UserPermissions.java` l. 275) ; `canView()` accepte `manage-users` ou `view-users` (l. 300) | `view-users` |
| Créer un compte | `POST /admin/realms/{realm}/users` | `UsersResource.createUser` → `requireManage()` ; si un mot de passe est fourni → `requireResetPassword` (défaut : `canManage`) | `manage-users` |
| Modifier un compte | `PUT /admin/realms/{realm}/users/{id}` | `UserResource.updateUser` → `requireManage(user)` | `manage-users` |
| Supprimer un compte | `DELETE /admin/realms/{realm}/users/{id}` | `UserResource.deleteUser` → `requireManage(user)` | `manage-users` |
| Mot de passe temporaire | `PUT /admin/realms/{realm}/users/{id}/reset-password` | `requireResetPassword(user)` → défaut `canManage(user)` (`fgap/UserPermissionEvaluator.java` l. 74) | `manage-users` |
| Lire le rôle `administrateur` (son `id` est exigé pour l'attribuer) | `GET /admin/realms/{realm}/roles/administrateur` | `RoleContainerResource.getRole` → `auth.roles().requireView(realm)` → `canViewRealm()` (`fgap/RolePermissions.java` l. 396) | **`view-realm`** |
| Attribuer / retirer `administrateur` | `POST` / `DELETE /admin/realms/{realm}/users/{id}/role-mappings/realm` | `RoleMapperResource.add/deleteRealmRoleMappings` → `managePermission.require()` puis `requireMapRole(role)` ; `canMapRole` : si `manage-users` → `checkAdminRoles(role)`, qui n'ajoute une contrainte que pour les rôles d'administration de `realm-management` (`RolePermissions.java` l. 154 et 322) | `manage-users` |
| Lister les Administrateurs | `GET /admin/realms/{realm}/roles/administrateur/users` | `requireView(realm)` + `requireQuery()` | `view-realm` + `view-users` |
| Fermer les sessions d'un compte | `POST /admin/realms/{realm}/users/{id}/logout` | `requireManage(user)` | `manage-users` |

Conclusion : **`manage-users` + `view-realm`** suffisent ; `view-users` est inclus de fait
par `manage-users` pour la lecture (`canView()`), mais le déclarer explicitement documente
l'intention (c'est ce que fait `acta.json`). Aucun rôle sur les clients, le realm
(`manage-realm`) ou les fournisseurs d'identité n'est nécessaire. Le compte de service ne
peut pas s'octroyer ni octroyer un rôle `realm-management` qu'il n'a pas
(`checkAdminRoles`) : il ne peut pas fabriquer un super-administrateur Keycloak.

Remarque : l'ajout d'un mappage de rôle exige `name` **et** `id` du rôle
(`RoleMapperResource.addRealmRoleMappings` : « `!roleModel.getId().equals(role.getId())` →
Role not found »). D'où le besoin de `view-realm` (ou, alternative sans `view-realm`,
`GET /users/{id}/role-mappings/realm/available`, contrôlée par la seule permission de lecture
de l'utilisateur ; elle ne permet en revanche pas de lister les Administrateurs).

## 3. Appels depuis NestJS

### Jeton du compte de service

Flux `client_credentials` sur le **réseau interne** :

```
POST {interne}/realms/{realm}/protocol/openid-connect/token
grant_type=client_credentials&client_id=api-admin&client_secret=…
```

- Le jeton dure `accessTokenLifespan` = 300 s (`realm.json`) ; il n'y a pas de jeton de
  rafraîchissement en `client_credentials` : on redemande un jeton peu avant l'expiration
  (le README du client officiel le préconise : « simply call `kcAdminClient.auth` to get a
  new access token », `js/libs/keycloak-admin-client/README.md`).
- Le socle démarre Keycloak avec `KC_HOSTNAME=https://auth.${DOMAINE}` et
  `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true` ; la documentation Keycloak range le **token
  endpoint** parmi les URL « backchannel » joignables par le réseau privé
  (https://www.keycloak.org/server/hostname). L'émetteur reste l'URL publique fixée par
  `hostname`. L'API REST d'administration (`/admin/realms/...`) est servie sur la même
  instance ; la doc précise que `hostname-admin` « does not prevent accessing the
  Administration REST API endpoints via the frontend URL » (restriction éventuelle : au
  niveau du proxy, donc du socle — hors périmètre).
- `sslRequired: "external"` (`realm.json`) n'exige pas HTTPS pour les adresses privées, ce
  qui couvre le réseau Docker `socle`.

### Client HTTP : deux options

| | `@keycloak/keycloak-admin-client` 26.8.x | `fetch` natif (Node 24) |
|---|---|---|
| Dépendances | 8 (dont 6 paquets `@microsoft/kiota-*`) | aucune |
| Typage | `UserRepresentation`, `RoleRepresentation` fournis | à écrire (≈ 6 endpoints) |
| Méthodes utiles | `auth({grantType:'client_credentials', clientId, clientSecret})`, `users.find/create/update/del/resetPassword/addRealmRoleMappings/delRealmRoleMappings/logout`, `roles.findOneByName`, `roles.findUsersWithRole` (`src/resources/users.ts`, `roles.ts`) | mêmes endpoints que le tableau §2 |
| Format | ESM, compatible avec `api/` (`"type": "module"`) | — |

Les deux conviennent techniquement. Le périmètre est petit (moins de dix endpoints) ; un
service `KeycloakAdminService` à base de `fetch` évite d'ajouter neuf dépendances transitives
à l'image. Choix à faire au moment de l'implémentation (pas une règle de gestion).

### Recettes (endpoints Keycloak 26.8.1)

**Créer un compte avec mot de passe temporaire et changement imposé :**

```
POST /admin/realms/{realm}/users
{ "username": "…", "email": "…", "firstName": "…", "lastName": "…",
  "enabled": true, "emailVerified": true,
  "requiredActions": ["UPDATE_PASSWORD"],
  "credentials": [{ "type": "password", "value": "<temporaire>", "temporary": true }] }
→ 201, en-tête Location: …/users/{id}   (409 « User exists with same username or email »)
```

- `UserResource.updateUserFromRep` (appelé par `createUser`) ajoute `UPDATE_PASSWORD` dès
  qu'un identifiant `password` porte `temporary: true` ; `requiredActions` explicite est
  redondant mais sans effet de bord.
- Variante en deux temps : création sans `credentials`, puis
  `PUT /users/{id}/reset-password` avec `{"type":"password","value":"…","temporary":true}`
  (`UserResource.resetPassword` : `temporary` → `addRequiredAction(UPDATE_PASSWORD)`, sinon
  l'action est retirée).
- L'identifiant `id` renvoyé est le futur `sub` du jeton, donc la clé de `app_user`.
- La politique de mot de passe du realm s'applique (erreur 400 `PasswordPolicyNotMetException`).
- Avec Google/Microsoft (`trustEmail: true`), une personne peut aussi se connecter par son
  fournisseur ; si un compte local de même e-mail existe, le flux « first broker login »
  demande de lier les comptes (comportement standard de Keycloak, non vérifié ici en détail).

**Modifier :** `PUT /users/{id}` avec les seuls champs à changer. Attention :
`requiredActions` transmis **remplace** la liste (`removeMissingRequiredActions` vaut vrai en
mise à jour) ; ne pas l'envoyer si on ne veut pas y toucher. Désactiver :
`{"enabled": false}`.

**Supprimer :** `DELETE /users/{id}` → 204.

**Rôle `administrateur` :** `GET /roles/administrateur` (récupère `{id, name}`), puis
`POST` ou `DELETE /users/{id}/role-mappings/realm` avec `[{"id": "…", "name": "administrateur"}]`.

**Effet sur les sessions :** le rôle est lu dans le jeton (`realm_access.roles`). Un retrait
de rôle, une désactivation ou une suppression ne prend effet côté API qu'au prochain jeton
(≤ 300 s). Pour un effet immédiat : `POST /users/{id}/logout` (ferme les sessions, donc les
rafraîchissements).

## 4. Premier Administrateur à l'installation, sans manipulation manuelle

Comportement vérifié de keycloak-config-cli 6.5.1 pour un utilisateur déclaré dans `users` :

1. Recherche par `username` (puis par e-mail/nom) ; s'il existe → mise à jour, sinon création.
2. **À chaque import**, ses rôles de realm sont **synchronisés** sur le fichier : les rôles
   manquants sont ajoutés, ceux absents du fichier sont **retirés**
   (`handleRealmRoles`, sauf `IMPORT_USERS_MERGEROLES=true` qui ne fait qu'ajouter ;
   `default-roles-<realm>` est préservé par défaut).
3. Mot de passe : un identifiant dont `userLabel` vaut `"initial"` n'est appliqué **qu'à la
   création** (`docs/FEATURES.md`, « User - initial password » ; `USER_LABEL_FOR_INITIAL_CREDENTIAL`).
   Sans ce libellé, le mot de passe est **réécrit à chaque import**.
4. `temporary: true` sur cet identifiant → `UPDATE_PASSWORD` à la création (même code
   Keycloak que §3).

Options possibles (aucune n'est décidée ici) :

| Option | Mécanisme | Mot de passe connu en production ? | Limites |
|---|---|---|---|
| **A. Compte déclaré + mot de passe initial jetable** | `realm.json` : utilisateur `$(env:ADMINISTRATEUR_INITIAL_EMAIL)`, `realmRoles: ["administrateur"]`, `credentials: [{type: password, userLabel: "initial", temporary: true, value: "$(env:ADMINISTRATEUR_INITIAL_MOT_DE_PASSE)"}]` ; le socle génère la valeur comme il le fait pour le secret `api-admin`. | Oui, **une fois** : valeur aléatoire lisible dans le `.env` du serveur, invalidée au premier changement imposé. | Exige une évolution du socle (`appliquer-realm.sh` : générer/transmettre deux variables). Le rôle `administrateur` est **réattribué à chaque réimport** (point 2) : impossible de le retirer durablement à ce compte depuis l'écran. |
| **B. Compte déclaré sans mot de passe, connexion par Google/Microsoft** | Même déclaration sans `credentials` ; la personne se connecte par son fournisseur (e-mail identique). | Non. | Liaison au compte existant via « first broker login » : vérification par e-mail (pas de SMTP dans le socle) ou ré-authentification (pas de mot de passe) → à tester, probablement bloquant. Même réattribution du rôle qu'en A. Suppose un fournisseur configuré. |
| **C. Amorçage par l'API, sans compte dans le realm** | Variable `ADMINISTRATEUR_INITIAL_EMAIL` lue par l'API ; à la connexion d'un jeton dont l'e-mail (vérifié) correspond **et** tant qu'aucun Administrateur n'existe (`GET /roles/administrateur/users?max=1`), l'API lui attribue le rôle via le compte de service. | Non (connexion Google/Microsoft) ; un compte local exigerait de toute façon un premier mot de passe ou un SMTP. | C'est une **règle de gestion** (condition d'attribution, e-mail vérifié, « aucun Administrateur ») : à valider. Le rôle n'apparaît qu'au jeton suivant. Aucune évolution du socle si l'e-mail est saisi dans le `.env` de l'application. |

En local, `comptes-test.json` fournit déjà `admin` / `Test1234!` : le besoin ne concerne que
la production.

## 5. Variables d'environnement (conformes à ADR-0007)

Le module ne connaît Keycloak que par des URL de `.env`, jamais par un nom de conteneur codé
en dur. `OIDC_JWKS_URL` (rempli par le socle : `http://keycloak:8080/realms/<nom>/protocol/openid-connect/certs`)
contient déjà l'adresse interne.

| Variable | Rôle | Qui la remplit | Statut |
|---|---|---|---|
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | Secret du client `api-admin` | socle (`appliquer-realm.sh`), **existe déjà** | à ajouter à `compose.yaml` (service `api`), `.env.example`, `app-config.ts` |
| `KEYCLOAK_ADMIN_CLIENT_ID` | `api-admin` | défaut dans `app-config.ts` (comme `OIDC_AUDIENCE`) | optionnelle |
| `KEYCLOAK_ADMIN_URL` (nom à choisir) | Base interne, ex. `http://keycloak:8080/admin/realms/<nom>` | dérivable : origine de `OIDC_JWKS_URL` + nom du realm tiré du chemin de `OIDC_ISSUER_URL` (`/realms/<nom>`) ; variable explicite seulement si on préfère que le socle la fournisse | optionnelle, sur le modèle de `OIDC_JWKS_URL` (défaut calculé) |
| `ADMINISTRATEUR_INITIAL_EMAIL` (et, option A, `ADMINISTRATEUR_INITIAL_MOT_DE_PASSE`) | Premier Administrateur | selon l'option du §4 | à décider |

ADR-0007 énumère des variables « complémentaires » dans sa mise en œuvre ; ajouter
`KEYCLOAK_ADMIN_CLIENT_SECRET` à cette liste ne change pas la décision, mais toute
modification du texte de l'ADR passe par un nouvel ADR validé (consigne `CLAUDE.md`).
Le secret ne doit jamais être exposé au client web : il n'est lu que par `api`.

## 6. Points d'attention pour l'implémentation

- Garder **un seul** service NestJS (`KeycloakAdminService`) qui détient le secret ; les
  routes de l'écran Utilisateurs portent `@RequireAppRole('administrateur')`.
- Les schémas zod des formulaires (création/modification de compte) vont dans `shared/`.
- Aucune nouvelle table n'est nécessaire pour piloter Keycloak ; si l'écran s'appuie sur
  `app_user`, ce n'est qu'en lecture et toujours via `DatabaseService.asUser()`.
  Étendre `scripts/tester-roles.mjs` : un non-Administrateur reçoit 403 sur ces routes.
- Profil utilisateur déclaratif (Keycloak ≥ 24) : si des attributs obligatoires (prénom,
  nom…) manquent à la création, Keycloak les demandera à la première connexion. À vérifier
  sur le realm réel.
- Réimport du realm : ne déclarer dans `realm.json` que les comptes qu'on accepte de voir
  « resynchronisés » à chaque `appliquer-realm.sh` (rôles, prénom, nom…).

## 7. Questions pour la responsable fonctionnelle (non tranchées)

1. Premier Administrateur : option A, B ou C (§4) ? Quelle personne / quel e-mail ?
2. Le premier Administrateur peut-il perdre son rôle ? (Options A et B : non, le réimport le lui rend.)
3. Faut-il interdire de retirer le rôle au **dernier** Administrateur, ou de se le retirer / se supprimer soi-même ?
4. Suppression d'un compte : suppression définitive ou désactivation (`enabled: false`) ? Que deviennent ses lignes `app_user` et ses appartenances aux entités partagées ?
5. Mot de passe temporaire : saisi par l'Administrateur ou généré par l'application, et comment est-il communiqué à la personne (pas d'e-mail disponible tant que le socle n'a pas de SMTP) ?
6. Un retrait de rôle ou une désactivation doit-il couper immédiatement les sessions (`logout`) ou attendre l'expiration du jeton (≤ 5 min) ?
7. L'identifiant de connexion (`username`) est-il l'e-mail ?

## Sources

- Keycloak 26.8.1, `services/src/main/java/org/keycloak/services/resources/admin/` :
  `UsersResource.java`, `UserResource.java`, `RoleContainerResource.java`,
  `RoleMapperResource.java`, `fgap/UserPermissions.java`, `fgap/UserPermissionEvaluator.java`,
  `fgap/RolePermissions.java` — https://github.com/keycloak/keycloak/tree/26.8.1
- Keycloak, `server-spi-private/.../models/utils/RepresentationToModel.java` (création des identifiants), tag 26.8.1
- Keycloak, « Configuring the hostname (v2) » — https://www.keycloak.org/server/hostname
- `@keycloak/keycloak-admin-client` : `js/libs/keycloak-admin-client/README.md`,
  `src/resources/users.ts`, `src/resources/roles.ts` (tag 26.8.1) ; métadonnées npm 26.8.1
- keycloak-config-cli v6.5.1 : `docs/MANAGED.md`, `docs/FEATURES.md`, `README.md`,
  `src/main/java/de/adorsys/keycloak/config/service/UserImportService.java`,
  `src/main/java/de/adorsys/keycloak/config/properties/ImportConfigProperties.java` —
  https://github.com/adorsys/keycloak-config-cli/tree/v6.5.1
- Socle : `compose.yaml`, `scripts/appliquer-realm.sh`, `scripts/ajouter-application.sh`, `keycloak/realms/acta.json`
- Ce dépôt : `keycloak/realm.json`, `keycloak/comptes-test.json`, `api/src/`, `compose.yaml`, `.env.example`, ADR-0005, ADR-0007
