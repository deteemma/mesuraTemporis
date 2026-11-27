# Installation de l'application (paquet complet)

Ce document installe **cette application** sur un serveur où le **socle** est déjà
installé (voir le `INSTALL.md` du dépôt `socle`). Dans les exemples, l'application
s'appelle `monappli` et le domaine est `exemple.ch` : remplacez-les par les vôtres.

## 1. Récupérer les fichiers de déploiement

Sur le serveur :

```bash
sudo mkdir -p /opt/applications && sudo chown "$USER" /opt/applications
cd /opt/applications
git clone https://github.com/<propriétaire>/<dépôt>.git monappli
```

Le dépôt est privé : utilisez un jeton GitHub (*fine-grained token*, lecture seule
sur ce dépôt) comme mot de passe lors du `git clone`.

## 2. Autoriser le téléchargement des images (GHCR)

Créez sur GitHub un jeton classique (*Settings › Developer settings › Personal
access tokens › Tokens (classic)*) avec la seule permission `read:packages`, puis :

```bash
docker login ghcr.io -u <votre-compte-github>
# mot de passe : le jeton
```

## 3. Enregistrer l'application dans le socle

```bash
cd /opt/socle
bash scripts/ajouter-application.sh monappli /opt/applications/monappli
# ajouter --hors-ligne si l'application a un mobile hors ligne
# NE PAS utiliser --comptes-test en production
```

Le script crée la base et ses comptes, la route `https://monappli.exemple.ch`,
le realm Keycloak, et remplit `/opt/applications/monappli/.env`.

Deux variables de ce `.env` peuvent rester vides. Elles servent à l'API pour
gérer les comptes dans Keycloak (écran Utilisateurs) :

| Variable | Vide = valeur par défaut |
|---|---|
| `KEYCLOAK_ADMIN_URL` | adresse déduite de `OIDC_JWKS_URL` : `<keycloak>/admin/realms/<realm>` |
| `KEYCLOAK_ADMIN_CLIENT_ID` | `api-admin`, le compte de service déclaré dans le realm |

Renseignez-les seulement si le socle publie l'administration de Keycloak à une
autre adresse, ou sous un autre compte de service.

## 4. Déployer une version

```bash
cd /opt/applications/monappli
APPLICATIONS_DIR=/opt/applications ./deployer.sh monappli 1.0.0
```

Le script sauvegarde la base, applique les migrations, démarre les conteneurs et
attend que l'API réponde.

## 5. Compte initial

À la création du realm (étape 3), le script crée le **Compte initial** `admin`,
Administrateur, avec le mot de passe `admin` à changer à la première connexion.
Il est déclaré à part, dans `keycloak/compte-initial.json`, et n'est appliqué
qu'à la création du realm.

Une fois un autre Administrateur en place, le Compte initial peut perdre son rôle
ou être supprimé depuis l'écran Utilisateurs, comme tout autre Administrateur
(ADR-0025). Les mises à jour ne le recréent pas et ne lui rendent pas son rôle.

Un Administrateur ne peut ni se supprimer ni se retirer son rôle. S'il ne reste
plus aucun Administrateur (deux Administrateurs qui se suppriment l'un l'autre au
même instant), recréez-en un dans la console Keycloak (`https://auth.exemple.ch`,
compte `admin` du socle) : realm `monappli` › *Users* › *Add user*, onglet
*Credentials* › *Set password*, onglet *Role mapping* › *Assign role* ›
`administrateur`.

## 6. Connexion avec Google ou Microsoft (facultatif)

Chaque fournisseur demande de créer une « application OAuth ». Adresse de retour
à déclarer :

| Fournisseur | Adresse de retour (*redirect URI*) |
|---|---|
| Google | `https://auth.exemple.ch/realms/monappli/broker/google/endpoint` |
| Microsoft | `https://auth.exemple.ch/realms/monappli/broker/microsoft/endpoint` |

### 6.1 Google

1. Ouvrez https://console.cloud.google.com et connectez-vous avec un compte Google.
2. En haut, sélecteur de projet › **Nouveau projet** › nom `monappli` › **Créer**, puis sélectionnez-le.
3. Menu › **API et services** › **Écran de consentement OAuth** (ou *Google Auth Platform*) › **Commencer** :
   - nom de l'application, e-mail d'assistance ;
   - audience : **Externe** ;
   - coordonnées du développeur : votre e-mail › **Créer**.
4. **Accès aux données** › **Ajouter des champs d'application** : cochez `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` › **Mettre à jour** › **Enregistrer**.
5. **Clients** › **Créer un client** :
   - type : **Application Web** ;
   - nom : `Keycloak monappli` ;
   - **URI de redirection autorisés** › ajoutez l'adresse de retour Google ci-dessus › **Créer**.
6. Copiez l'**ID client** et le **Code secret du client**.
7. **Audience** › **Publier l'application** : sans cette étape, seuls les comptes déclarés comme testeurs peuvent se connecter.

### 6.2 Microsoft

1. Ouvrez https://portal.azure.com et connectez-vous (un compte Microsoft gratuit suffit).
2. Recherchez **Microsoft Entra ID** › **Inscriptions d'applications** › **Nouvelle inscription** :
   - nom : `Keycloak monappli` ;
   - types de comptes : **Comptes dans un annuaire organisationnel et comptes Microsoft personnels** ;
   - URI de redirection : plateforme **Web**, adresse de retour Microsoft ci-dessus › **S'inscrire**.
3. Sur la page de l'application, copiez l'**ID d'application (client)**.
4. **Certificats et secrets** › **Nouveau secret client** › description `keycloak`, expiration 24 mois › **Ajouter**.
5. Copiez immédiatement la colonne **Valeur** (pas « ID du secret ») : elle ne sera plus affichée.
6. Notez la date d'expiration dans votre agenda : il faudra créer un nouveau secret avant cette date.

### 6.3 Activer les boutons

Dans `/opt/applications/monappli/.env`, renseignez les identifiants du ou des
fournisseurs retenus :

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
```

puis réappliquez le realm et redémarrez l'API, qui lit ces identifiants à son
démarrage :

```bash
bash /opt/socle/scripts/appliquer-realm.sh monappli /opt/applications/monappli/.env
cd /opt/applications/monappli && docker compose up -d api
```

Les boutons « Google » et « Microsoft » s'ajoutent à la page de connexion.
Le bouton d'un fournisseur n'apparaît que si son identifiant est renseigné.

Un Administrateur active ou désactive ensuite chaque fournisseur depuis l'écran
**Connexions** de l'application (ADR-0029). Un fournisseur sans identifiant y
est affiché « non configuré ». Le choix est gardé par l'application et
réappliqué à Keycloak à chaque démarrage de l'API : un changement fait dans la
console Keycloak est écrasé.

La première connexion Google ou Microsoft d'une personne inconnue crée une
Demande d'accès en attente, sans page de profil (Login = Email). Un
Administrateur l'accepte ou la refuse depuis l'écran Utilisateurs. Pour une
demande Microsoft, un avertissement rappelle que l'adresse n'est pas garantie :
vérifiez l'identité de la personne avant d'accepter.

La connexion est refusée avec le message standard de Keycloak (« Nom
d'utilisateur ou mot de passe invalide ») dans les cas suivants :

- l'Email est déjà celui, ou le Login, d'un Utilisateur ;
- l'Email est réservé par une Demande d'accès ;
- l'email d'un compte Google n'est pas vérifié ;
- un compte Microsoft ne transmet pas d'email.

Un compte créé par un Administrateur se connecte uniquement par Login et mot de
passe. Ces réglages (ADR-0024, ADR-0028) sont livrés dans le realm : rien à
configurer dans Keycloak.

## Mettre à jour

Pour chaque nouvelle version : `APPLICATIONS_DIR=/opt/applications ./deployer.sh monappli <version>`.
Si `keycloak/realm.json` a changé dans la version, recopiez-le dans le socle et
réappliquez-le. Le realm existe déjà : le Compte initial n'est pas réappliqué,
qu'il ait été supprimé ou non.

```bash
cp /opt/applications/monappli/keycloak/realm.json /opt/socle/keycloak/realms/monappli.json
bash /opt/socle/scripts/appliquer-realm.sh monappli /opt/applications/monappli/.env
cd /opt/applications/monappli && docker compose restart api
```

La réapplication du realm remet Google et Microsoft dans l'état de `.env` ; le
redémarrage de l'API y réapplique aussitôt les choix faits à l'écran
Connexions (ADR-0029).
