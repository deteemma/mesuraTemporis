# Connexion Google et Microsoft dans Keycloak : création automatique et rattachement par Email

- **Ticket** : #4
- **Date** : 2026-11-12
- **Statut** : recherche (aucune décision, aucun ADR modifié)
- **Versions concernées** : Keycloak **26.8.1** (`quay.io/keycloak/keycloak:26.8.1`, `socle/compose.yaml`) et keycloak-config-cli **6.5.1** pour Keycloak 26 (`adorsys/keycloak-config-cli:6.5.1-26`, même fichier). La documentation en ligne lue est celle de Keycloak 26.8.2. Le code source cité est celui de l'étiquette `26.8.1` du dépôt `keycloak/keycloak`.

## Question

Comment obtenir dans Keycloak, avec un realm livré en JSON (ADR-0005), le comportement de l'application source (`mesureTemporisMP`, ADR-0009) ?

- La connexion Google est ouverte à tout compte Google.
- Au premier login, un compte est **créé automatiquement**, sans Projet, **ou rattaché** au compte existant dont l'Email correspond.
- Il n'y a ni étape manuelle ni écran intermédiaire.
- Un compte créé via Google **n'a pas de mot de passe**.

Le ticket ajoute Microsoft. Il demande aussi les flux, les risques et le paramétrage de `realm.json`.

## Réponse courte

1. **C'est possible avec ce que Keycloak fournit, sans extension.** Il faut un flux de première connexion propre à l'application. Il combine deux authentificateurs : « Create User If Unique » (`idp-create-user-if-unique`) et « Automatically set existing user » (`idp-auto-link`), tous deux en `ALTERNATIVE`. On rattache ensuite ce flux au fournisseur par `firstBrokerLoginFlowAlias`. C'est la configuration que la documentation officielle décrit sous « Automatically link existing first login flow ». keycloak-config-cli sait déclarer ce flux en JSON.
2. **La documentation Keycloak qualifie cet authentificateur de dangereux.** Il rattache **sans aucune vérification**. Le code source confirme qu'il ne regarde ni `email_verified` ni `trustEmail`. La sécurité repose donc entièrement sur la fiabilité de l'adresse renvoyée par le fournisseur.
3. **Google** : le risque est maîtrisable. Il suffit d'exiger `email_verified = true` dans le jeton d'identité, par l'option « Verify essential claim » du fournisseur. Un risque résiduel est documenté par Google : les comptes Google dont l'adresse n'est ni Gmail ni Workspace.
4. **Microsoft** : **il ne faut pas reproduire tel quel le rattachement automatique.**
   - Le fournisseur Microsoft de Keycloak lit l'adresse dans Microsoft Graph (`mail`, sinon `userPrincipalName`), sans aucun indicateur de vérification.
   - Il fonctionne par défaut en multi-locataire (`common`), et c'est la configuration que prévoit `INSTALL.md`.
   - L'option « Verify essential claim » ne s'applique pas à ce fournisseur.
   - L'administrateur de n'importe quel locataire Entra peut donc présenter l'adresse d'un utilisateur existant, y compris celle d'un compte `administrateur`, et en prendre le contrôle.
   - **L'application source n'avait d'ailleurs que Google.** Pour Microsoft, le comportement est à décider (voir « Questions ouvertes »).
5. **« Pas de mot de passe »** : c'est le comportement par défaut de Keycloak, à condition de ne pas activer l'option `require.password.update.after.registration`. Le realm désactive déjà la réinitialisation (`resetPasswordAllowed: false`).
6. **« Sans Projet »** : cela ne concerne pas Keycloak. L'API crée déjà la ligne `app_user` au premier jeton (`api/src/users/users.service.ts`), et personne n'est membre d'aucun Projet par défaut. Lors d'un rattachement, l'identifiant Keycloak (`sub`) du compte existant est conservé, donc son historique dans l'application aussi.

## 1. Situation actuelle de `keycloak/realm.json`

Les deux fournisseurs déclarent `"trustEmail": true`, `"firstBrokerLoginFlowAlias": "first broker login"` (le flux intégré par défaut) et `"syncMode": "IMPORT"`. Le realm a `duplicateEmailsAllowed: false`, `loginWithEmailAllowed: true`, `registrationAllowed: false` et `resetPasswordAllowed: false`. Aucun serveur d'envoi de courriels (SMTP) n'est configuré.

Avec le flux par défaut, voici ce qui se passe quand l'adresse correspond à un compte existant (documentation, « Default first login flow authenticators ») :

1. un écran « Confirm Link Existing Account » s'affiche ;
2. sans SMTP, l'authentificateur « Verify Existing Account By Email » est sauté (code : `smtpNotConfigured` puis `attempted`) ;
3. un écran de **ré-authentification** demande le mot de passe du compte existant, ou une connexion par un autre fournisseur déjà lié.

C'est sûr, mais ce n'est pas le comportement voulu : il y a deux écrans intermédiaires.

## 2. Ce que fait chaque authentificateur (Keycloak 26.8.1)

| Authentificateur (affichage / `providerId`) | Comportement vérifié dans le code | Source |
|---|---|---|
| Review Profile / `idp-review-profile` | Affiche la page de profil selon le réglage `update.profile.on.first.login` : `on` (toujours), `missing` (si un attribut obligatoire du profil manque ; valeur par défaut) ou `off` (jamais, sauf si un autre authentificateur force l'affichage, par exemple quand le nom d'utilisateur est vide). | `IdpReviewProfileAuthenticator.java`, `IdpReviewProfileAuthenticatorFactory.java` |
| Create User If Unique / `idp-create-user-if-unique` | Cherche un compte existant (détail ci-dessous). S'il n'y a pas de doublon, il crée le compte, l'active, copie les attributs et termine en succès. En cas de doublon, il mémorise le compte trouvé (`EXISTING_USER_INFO`) puis passe la main (`attempted`). S'il est `REQUIRED`, il affiche à la place une page d'erreur 409. Option : `require.password.update.after.registration`. | `IdpCreateUserIfUniqueAuthenticator.java` |
| Automatically set existing user / `idp-auto-link` | Lit le compte mémorisé et l'authentifie : `context.setUser(existingUser); context.success();`. **Aucune vérification.** Texte d'aide officiel : « Automatically set existing user to authentication context without any verification ». Il n'a pas de configuration. | `IdpAutoLinkAuthenticator.java`, `IdpAutoLinkAuthenticatorFactory.java` |
| Detect existing broker user / `idp-detect-existing-broker-user` | Pour un flux où **seuls les comptes déjà présents** peuvent se connecter, sans création. Ne correspond pas à la source. | Doc « Detect existing user first login flow » |

Comment « Create User If Unique » trouve un compte existant (`checkExistingUser`) :

- d'abord par **Email**, puisque les doublons d'Email sont interdits dans ce realm ;
- puis par **nom d'utilisateur égal à cet Email**, puisque `loginWithEmailAllowed` est actif ;
- puis par **nom d'utilisateur** ;
- enfin par Email égal au nom d'utilisateur fourni par le fournisseur.

Le rattachement peut donc aussi se faire sur le nom d'utilisateur, pas seulement sur l'Email. Pour Google et Microsoft, le nom d'utilisateur transmis est l'adresse email, d'où l'effet pratique : on cherche l'Email.

Avertissement officiel (Server Administration Guide, « Automatically link existing first login flow ») :

> The AutoLink authenticator is dangerous in a generic environment where users can register themselves using arbitrary usernames or email addresses. Do not use this authenticator unless you are carefully curating user registration and assigning usernames and email addresses.

Et, en introduction de « First login flow » :

> Automatically linking the existing local account to the external identity provider is a potential security hole. You cannot always trust the information you get from the external identity provider.

### `trustEmail` et `syncMode`

- **Trust Email** (doc « General configuration ») : si l'option est active, Keycloak fait confiance à l'adresse du fournisseur. Pour un fournisseur OIDC, il reprend la valeur `email_verified` du jeton. Il ne retombe sur `trustEmail` que si cette valeur est absente (code : `OIDCIdentityProvider.setEmailVerified`).
  - Cette option ne fait que **marquer l'adresse comme vérifiée sur le compte créé**.
  - Elle n'a **aucune influence sur `idp-auto-link`**, qui rattache même si l'adresse n'est pas vérifiée.
- **Sync Mode** : `IMPORT` importe le profil à la première connexion seulement. `FORCE` le met à jour à chaque connexion. Avec le rattachement par Email, **garder `IMPORT`** : sinon un changement d'adresse chez le fournisseur réécrirait l'Email du compte Keycloak, qui sert de pivot.

## 3. Risque de prise de contrôle de compte

Le scénario est le suivant :

1. un compte existe déjà, par exemple créé par un administrateur, avec l'Email `x@domaine` ;
2. un attaquant se présente via un fournisseur qui affirme « mon adresse est `x@domaine` » sans que cette adresse ait été vérifiée ;
3. `idp-auto-link` l'authentifie comme ce compte et lie son identité externe à ce compte de façon durable.

Il obtient alors tous les droits du compte : ses Projets et, le cas échéant, le rôle `administrateur`.

Variante dite « pré-prise de contrôle » :

1. l'attaquant se connecte **avant** la victime avec une adresse falsifiée : un compte est créé automatiquement à son nom ;
2. quand la vraie personne se connecte plus tard avec Google, elle est rattachée automatiquement à ce même compte, que l'attaquant contrôle aussi.

### Google

- Le fournisseur Google de Keycloak est un fournisseur OIDC (`GoogleIdentityProvider extends OIDCIdentityProvider`). Il reçoit un jeton d'identité signé contenant `email` et `email_verified`.
- Google définit `email_verified` ainsi : « True if the user's email address has been verified; otherwise false ». Il recommande de ne jamais utiliser l'adresse comme identifiant, mais `sub` (OpenID Connect, tableau des claims).
- Google précise quand il fait autorité sur l'adresse (« Verify the Google ID token on your server side ») :
  - adresse en `@gmail.com` : compte Gmail, Google fait autorité ;
  - `email_verified` vrai et `hd` présent : compte Google Workspace, Google fait autorité ;
  - sinon, « Google is not authoritative and password or other challenge methods are recommended ». La page ajoute que `email_verified` peut être vrai alors que « ownership of the third party email account may have since changed ».
- **Parade disponible dans Keycloak** : l'option « Verify essential claim » du fournisseur (clés de configuration `filteredByClaim`, `claimFilterName`, `claimFilterValue` dans `IdentityProviderModel`). Elle est appliquée au jeton d'identité dans `OIDCIdentityProvider`, avec une expression régulière sur la valeur convertie en texte.
  - Avec `email_verified` et `true`, une connexion Google dont l'adresse n'est pas vérifiée est **refusée**, que ce soit pour une création ou un rattachement.
- **Risque résiduel** : un compte Google « grand public » créé avec une adresse tierce (ni Gmail, ni Workspace) dont la propriété a changé depuis.
  - Pour l'éliminer, il faudrait restreindre l'accès à certains domaines, ce que la source a explicitement écarté.
  - Autre solution : refuser le rattachement automatique pour ces comptes, ce qui demande un authentificateur personnalisé (hors du « rien n'est configuré à la main » et hors realm JSON).
  - **À accepter ou non par la responsable fonctionnelle.**

### Microsoft

Constats dans le code (`MicrosoftIdentityProvider.java`, Keycloak 26.8.1) :

- C'est un fournisseur **OAuth 2**, pas OIDC (`extends AbstractOAuth2IdentityProvider`). Il lit le profil dans Microsoft Graph `GET /v1.0/me`.
- L'adresse vient de `mail`, ou à défaut de `userPrincipalName` s'il a la forme d'une adresse email. **Aucun indicateur de vérification n'est lu.** Avec `trustEmail: true`, l'adresse est donc marquée vérifiée d'office.
- Le locataire par défaut est `common` : tout locataire Entra **et** les comptes Microsoft personnels sont acceptés (clé de configuration `tenantId`, `MicrosoftIdentityProviderConfig.java`). `INSTALL.md` §6.2 prescrit justement « Comptes dans un annuaire organisationnel et comptes Microsoft personnels ».
- L'option « Verify essential claim » est codée dans `OIDCIdentityProvider` : elle **ne s'applique pas** à ce fournisseur.

Constats dans la documentation Microsoft Graph (ressource `user`) :

- `mail` est un attribut que l'administrateur du locataire **renseigne librement**. La documentation ne mentionne aucune vérification.
- `userPrincipalName` doit au contraire appartenir à un domaine vérifié du locataire.

Microsoft a publié une page « Migrate away from using email claims for user identification or authorization » (`learn.microsoft.com/entra/identity-platform/migrate-off-email-claim-authorization`).

- Elle redirigeait vers la page d'accueil de la documentation au moment de cette recherche : son contenu n'a donc **pas pu être relu à la source**.
- D'après les extraits indexés, elle demande de ne jamais utiliser l'email comme identifiant ni pour l'autorisation, de préférer le couple `tid` + `oid` et de vérifier l'option `xms_edov`. Elle parle aussi d'un risque de prise de contrôle de compte avec des emails non vérifiés.
- **À relire avant toute décision.**

Conclusion : avec le fournisseur Microsoft intégré en mode `common`, **le rattachement automatique par Email est une faille de prise de contrôle de compte.** Il ne faut pas l'activer sans une des parades ci-dessous.

## 4. Options sûres

| Option | Google | Microsoft | Effet utilisateur |
|---|---|---|---|
| A. Flux « création + rattachement automatiques » avec `email_verified` exigé | **Recommandé** | Impossible (pas de vérification d'adresse côté Keycloak) | Aucun écran |
| B. Flux par défaut (`first broker login`) : confirmation puis ré-authentification (ou courriel si SMTP) | Sûr | **Sûr** | Deux écrans en cas de compte existant. Un compte créé via Google ou Microsoft ne peut se ré-authentifier que par un autre fournisseur déjà lié. |
| C. Flux « création seule » : `idp-create-user-if-unique` en `REQUIRED`, pas de rattachement | Sûr | **Sûr** | Création automatique si l'adresse est nouvelle, page d'erreur si elle existe déjà. Le rattachement passe alors par la console de compte, après connexion par mot de passe. |
| D. Rattachement automatique Microsoft limité à **un** locataire (`tenantId` = GUID du locataire de l'organisation) | – | Acceptable si on fait confiance aux administrateurs de ce locataire | Aucun écran, mais la connexion Microsoft est fermée aux autres organisations et aux comptes personnels. Contraire à « ouvert à tous ». |
| E. Remplacer le fournisseur Microsoft par un fournisseur OIDC générique vers Entra, avec contrôle d'un claim | – | Possible en théorie (`xms_edov`, option à ajouter dans Entra). Non vérifié ici. | Plus complexe. Hors périmètre de cette recherche. |

**Recommandation (à valider)** :

- **Google** : option A.
- **Microsoft** : option B (ou C), donc **pas de rattachement automatique**.
- Changer aussi `trustEmail` à `false` pour Microsoft, afin que l'adresse importée ne soit pas marquée vérifiée.
  - Attention : avec `trustEmail: false`, si le realm exige un jour la vérification des adresses (`verifyEmail`), l'utilisateur Microsoft devra vérifier la sienne par courriel.
  - Aujourd'hui, `verifyEmail` n'est pas activé : rien ne change pour lui.

## 5. Paramétrage attendu dans `realm.json` (proposition, non appliquée)

Format conforme aux fichiers de test de keycloak-config-cli 6.5.1 (`src/test/resources/import-files/auth-flows/61_update_realm__add_and_set_custom_first-broker-login-flow_for_identity-provider.json` et `32_..._with_config.json`) :

- les sous-flux sont référencés par `flowAlias` ;
- la configuration d'un authentificateur est déclarée dans `authenticatorConfig` au niveau du realm et référencée par son alias.

D'après `docs/MANAGED.md` de keycloak-config-cli, les flux d'authentification sont des ressources « entièrement gérées », **à l'exception des flux intégrés**. Déclarer ces flux ne supprime donc pas `first broker login`, `browser`, etc. Les noms de flux sont en français, comme les autres libellés du realm.

```jsonc
{
  // … clés existantes inchangées …

  "authenticationFlows": [
    {
      "alias": "premiere connexion externe",
      "description": "Création automatique ou rattachement automatique par Email, sans écran (ticket #4)",
      "providerId": "basic-flow",
      "topLevel": true,
      "builtIn": false,
      "authenticationExecutions": [
        {
          "authenticator": "idp-review-profile",
          "authenticatorConfig": "profil premiere connexion externe",
          "requirement": "REQUIRED",
          "priority": 10,
          "authenticatorFlow": false
        },
        {
          "flowAlias": "premiere connexion externe - creation ou rattachement",
          "requirement": "REQUIRED",
          "priority": 20,
          "authenticatorFlow": true
        }
      ]
    },
    {
      "alias": "premiere connexion externe - creation ou rattachement",
      "description": "Crée le compte si l'Email est nouveau, sinon le rattache sans vérification",
      "providerId": "basic-flow",
      "topLevel": false,
      "builtIn": false,
      "authenticationExecutions": [
        { "authenticator": "idp-create-user-if-unique", "requirement": "ALTERNATIVE", "priority": 10, "authenticatorFlow": false },
        { "authenticator": "idp-auto-link",             "requirement": "ALTERNATIVE", "priority": 20, "authenticatorFlow": false }
      ]
    }
  ],
  "authenticatorConfig": [
    {
      "alias": "profil premiere connexion externe",
      "config": { "update.profile.on.first.login": "off" }
    }
  ],

  "identityProviders": [
    {
      "alias": "google",
      "providerId": "google",
      "displayName": "Google",
      "enabled": "$(env:GOOGLE_ENABLED)",
      "trustEmail": true,
      "firstBrokerLoginFlowAlias": "premiere connexion externe",
      "config": {
        "clientId": "$(env:GOOGLE_CLIENT_ID)",
        "clientSecret": "$(env:GOOGLE_CLIENT_SECRET)",
        "syncMode": "IMPORT",
        "filteredByClaim": "true",
        "claimFilterName": "email_verified",
        "claimFilterValue": "true"
      }
    },
    {
      "alias": "microsoft",
      "providerId": "microsoft",
      "displayName": "Microsoft",
      "enabled": "$(env:MICROSOFT_ENABLED)",
      "trustEmail": false,
      "firstBrokerLoginFlowAlias": "first broker login",
      "config": {
        "clientId": "$(env:MICROSOFT_CLIENT_ID)",
        "clientSecret": "$(env:MICROSOFT_CLIENT_SECRET)",
        "syncMode": "IMPORT"
      }
    }
  ]
}
```

Notes :

- Le JSON réel ne doit pas contenir les commentaires `//` : ils sont là uniquement pour la lecture.
- **Review Profile à `off`** plutôt que retiré du flux : « Create User If Unique » relance le flux en forçant la page de profil si le nom d'utilisateur ou l'Email est vide. Il faut donc un authentificateur capable de l'afficher. Avec `off`, la page n'apparaît que dans ce cas anormal.
  - À l'inverse, `missing` (valeur par défaut) afficherait la page dès qu'un attribut obligatoire du profil manque, par exemple un compte Google sans nom de famille.
- **Profil utilisateur** : même avec `off`, l'action requise « Verify Profile » peut afficher une page à la connexion si le compte ne respecte pas la configuration du profil utilisateur (doc « Defining actions required at login »). C'est le cas si prénom ou nom sont obligatoires et absents chez le fournisseur.
  - Pour garantir « aucun écran », il faudrait rendre ces attributs facultatifs dans le profil utilisateur du realm.
  - **Non vérifié ici** : l'obligation par défaut de ces attributs en 26.8.1 et la manière de déclarer le profil utilisateur dans keycloak-config-cli. À tester.
- **Pas de mot de passe** : ne pas ajouter `require.password.update.after.registration` à « Create User If Unique ». Le compte est créé sans identifiant de connexion local.
- **Si Microsoft doit être rattaché automatiquement malgré tout** (option D) :
  - lui donner aussi `"firstBrokerLoginFlowAlias": "premiere connexion externe"` ;
  - ajouter `"tenantId": "$(env:MICROSOFT_TENANT_ID)"` dans `config` ;
  - créer la variable correspondante dans `.env.example` et dans `appliquer-realm.sh` du socle. **Ce script appartient au socle, il faut demander son accord.**
- **Éviter la page de connexion Keycloak** : le bouton de l'application peut ajouter `kc_idp_hint=google` à l'URL d'autorisation pour aller directement chez Google (doc, authentificateur « Identity Provider Redirector »). L'écran de consentement Google, lui, reste affiché.

## 6. Comportements de la source impossibles ou risqués à reproduire

1. **Rattachement automatique Microsoft par Email** : **risqué**, faille de prise de contrôle (§3). La source ne l'avait pas, elle n'avait que Google. À trancher par la responsable fonctionnelle.
2. **Rattachement automatique Google** : reproductible, avec deux réserves.
   - Il faut exiger `email_verified`, ce que la source ne précisait pas.
   - Il reste le risque résiduel des comptes Google à adresse tierce.
3. **« Aucun écran intermédiaire »** : reproductible pour la création comme pour le rattachement. Une page de profil peut toutefois apparaître si un attribut obligatoire manque (§5, à tester).
4. **Rattachement aussi par nom d'utilisateur** : Keycloak rattache aussi un compte dont le **nom d'utilisateur** est égal à l'adresse du fournisseur (§2). La source ne rapprochait que par Email. Sans effet si aucun nom d'utilisateur n'a la forme d'une adresse email, ce qui est à garantir dans les écrans d'administration des comptes.
5. **Les comptes `administrateur` sont rattachables** comme les autres. Si l'Email d'un administrateur est celui d'un compte Google qu'il ne contrôle pas plus, ou si une faille du §3 s'applique, la prise de contrôle donne les droits d'administration. Aucun mécanisme intégré de Keycloak n'exclut un rôle du rattachement automatique.
6. **Adresse modifiée chez le fournisseur** : avec `syncMode: IMPORT`, l'Email Keycloak reste celui de la première connexion. Le lien est fait par l'identifiant du fournisseur (`sub` Google, `id` Graph), pas par l'adresse : la personne continue donc à se connecter. Comportement conforme à la recommandation Google.

## Questions ouvertes pour la responsable fonctionnelle

1. Pour Microsoft, accepte-t-on l'**option B** (pas de rattachement automatique : écran de confirmation puis ré-authentification), l'**option C** (création seule, erreur si l'Email existe), ou faut-il restreindre à un seul locataire (**option D**) ?
2. Pour Google, accepte-t-on le risque résiduel des comptes Google à adresse tierce (ni Gmail, ni Workspace) ?
3. Faut-il exclure les comptes `administrateur` du rattachement automatique ? Cela demanderait un développement spécifique, hors realm JSON.

## Sources

- Keycloak, *Server Administration Guide* (version 26.8.2), chapitre « Integrating identity providers » : sections « General configuration » (Trust Email, Sync Mode, Verify essential claim), « First login flow », « Default first login flow authenticators », « Automatically link existing first login flow », « Disabling automatic user creation », « Detect existing user first login flow ». https://www.keycloak.org/docs/latest/server_admin/index.html
- Code source Keycloak, étiquette `26.8.1` (https://github.com/keycloak/keycloak/tree/26.8.1) :
  - `services/src/main/java/org/keycloak/authentication/authenticators/broker/IdpCreateUserIfUniqueAuthenticator.java` (+ `Factory`)
  - `services/src/main/java/org/keycloak/authentication/authenticators/broker/IdpAutoLinkAuthenticator.java` (+ `Factory`)
  - `services/src/main/java/org/keycloak/authentication/authenticators/broker/IdpReviewProfileAuthenticator.java` (+ `Factory`)
  - `services/src/main/java/org/keycloak/authentication/authenticators/broker/IdpEmailVerificationAuthenticator.java`
  - `services/src/main/java/org/keycloak/authentication/authenticators/broker/IdpDetectExistingBrokerUserAuthenticatorFactory.java`
  - `services/src/main/java/org/keycloak/broker/oidc/OIDCIdentityProvider.java` (filtrage par claim, `email_verified`)
  - `services/src/main/java/org/keycloak/social/google/GoogleIdentityProvider.java`
  - `services/src/main/java/org/keycloak/social/microsoft/MicrosoftIdentityProvider.java` et `MicrosoftIdentityProviderConfig.java`
  - `server-spi/src/main/java/org/keycloak/models/IdentityProviderModel.java` (noms des clés de configuration)
  - `core/src/main/java/org/keycloak/representations/idm/IdentityProviderRepresentation.java` (`on` / `missing` / `off`, `firstBrokerLoginFlowAlias`)
- keycloak-config-cli `v6.5.1` (https://github.com/adorsys/keycloak-config-cli/tree/v6.5.1) : `docs/FEATURES.md`, `docs/MANAGED.md`, `src/test/resources/import-files/auth-flows/61_…json`, `32_…json`.
- Google, *OpenID Connect* (claims `sub`, `email`, `email_verified`, `hd`) : https://developers.google.com/identity/openid-connect/openid-connect
- Google, *Verify the Google ID token on your server side* (quand Google fait autorité sur l'adresse) : https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- Microsoft Graph v1.0, ressource `user` (propriétés `mail`, `userPrincipalName`, `id`) : https://learn.microsoft.com/en-us/graph/api/resources/user?view=graph-rest-1.0
- Microsoft, *Migrate away from using email claims for user identification or authorization* : https://learn.microsoft.com/en-us/entra/identity-platform/migrate-off-email-claim-authorization (redirigeait vers la page d'accueil le 2026-11-12 : contenu non relu, voir §3).
- Dépôt : `keycloak/realm.json`, `docs/adr/0005-identite.md`, `INSTALL.md` §6, `api/src/users/users.service.ts` ; socle : `compose.yaml`, `scripts/appliquer-realm.sh` ; source : `mesureTemporisMP/docs/adr/0009-connexion-google-en-complement-du-mot-de-passe.md`, `CONTEXT.md`.
