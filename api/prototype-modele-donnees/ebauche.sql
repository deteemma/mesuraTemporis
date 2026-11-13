-- PROTOTYPE — ÉBAUCHE JETABLE, NE PAS EXÉCUTER EN L'ÉTAT.
-- Ticket « Ébauche du modèle de données PostgreSQL et des politiques RLS » (carte #1).
-- Remplacera api/migrations/0001_projets_et_rls.sql (aucun déploiement en production :
-- on peut modifier 0001/0002, cf. docs/renommer-entite-partagee.md).
--
-- Contexte transmis par l'API à chaque transaction (DatabaseService.asUser) :
--   set_config('app.user_id',  '<sub Keycloak>', true)
--   set_config('app.is_admin', 'true' | 'false', true)   -- rôle Keycloak « administrateur »

CREATE TYPE project_role AS ENUM ('reader', 'contributor', 'owner');  -- seul 'contributor' est attribué

CREATE FUNCTION current_app_user_id() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')
$$;
CREATE FUNCTION current_is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.is_admin', true) = 'true', false)
$$;

-- Utilisateur ---------------------------------------------------------------------
-- Copie locale du compte Keycloak. Ligne créée par l'écran Utilisateurs dès la
-- création du compte Keycloak (pour pouvoir l'affecter avant sa première connexion),
-- ou à la première connexion Google.
CREATE TABLE app_user (
  id           text PRIMARY KEY,           -- id Keycloak (sub)
  login        text NOT NULL,              -- username Keycloak (colonne « Utilisateur » du Rapport)
  email        text,
  display_name text,                       -- champ Nom unique
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_user_login_key ON app_user (login);
CREATE UNIQUE INDEX app_user_email_key ON app_user (lower(email));

-- Projet --------------------------------------------------------------------------
CREATE TABLE project (
  id         uuid PRIMARY KEY,
  name       text NOT NULL CHECK (btrim(name) <> ''),
  status     text NOT NULL DEFAULT 'actif',   -- badge « actif » repris à l'identique, jamais modifié
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Pas de déclencheur « créateur = propriétaire » : un Projet naît avec une équipe vide.

CREATE TABLE project_member (               -- l'équipe ; role toujours 'contributor'
  project_id uuid NOT NULL REFERENCES project (id)  ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  role       project_role NOT NULL DEFAULT 'contributor' CHECK (role = 'contributor'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_member_user_id_idx ON project_member (user_id);

-- Activité ------------------------------------------------------------------------
-- Normalisation identique à normaliserTexte() de la source : NFD, retrait des
-- diacritiques (U+0300–U+036F), trim, minuscules. Calculée dans shared/ et stockée.
CREATE TABLE activity (
  id              uuid PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  normalized_name text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, project_id)                   -- cible de la clé composite de time_entry
);
-- Unicité normalisée dans un Projet garantie par la base (écart validé : la création par
-- l'Administrateur refuse aussi le doublon, ACTIVITE_NOM_DUPLIQUE).
CREATE UNIQUE INDEX activity_project_name_key ON activity (project_id, normalized_name);

-- Imputation ----------------------------------------------------------------------
CREATE TABLE time_entry (
  id          uuid PRIMARY KEY,
  user_id     text NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,   -- l'auteur
  project_id  uuid NOT NULL REFERENCES project (id)  ON DELETE CASCADE,
  activity_id uuid NOT NULL,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz,                                                -- NULL = chronomètre actif
  FOREIGN KEY (activity_id, project_id) REFERENCES activity (id, project_id) ON DELETE CASCADE,
  CONSTRAINT time_entry_end_after_start CHECK (ended_at IS NULL OR ended_at >= started_at)
);
-- Un seul chronomètre actif par Utilisateur.
CREATE UNIQUE INDEX time_entry_one_running_timer ON time_entry (user_id) WHERE ended_at IS NULL;
CREATE INDEX time_entry_user_started_idx ON time_entry (user_id, started_at DESC);
-- Auteur, Projet et Activité d'une Imputation ne changent jamais (Relancer en crée une nouvelle).
-- Mis en œuvre par un déclencheur BEFORE UPDATE qui refuse leur modification.

-- Fonctions d'aide (SECURITY DEFINER : pas de récursion des politiques) -------------
CREATE FUNCTION is_project_member(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM project_member
                 WHERE project_id = p_project_id AND user_id = current_app_user_id())
$$;
CREATE FUNCTION is_author_on_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM time_entry
                 WHERE project_id = p_project_id AND user_id = current_app_user_id())
$$;
CREATE FUNCTION is_author_on_activity(p_activity_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM time_entry
                 WHERE activity_id = p_activity_id AND user_id = current_app_user_id())
$$;

-- Retrait d'un Utilisateur de l'équipe : arrêt de son chronomètre sur ce Projet,
-- dans la même transaction, sauf s'il est Administrateur (ticket « Imputations d'un
-- Utilisateur retiré d'un Projet »). Fait par le service NestJS, juste avant le DELETE,
-- car la base ne connaît pas le rôle Keycloak de l'Utilisateur retiré :
--   UPDATE time_entry SET ended_at = now()
--   WHERE user_id = :retire AND project_id = :projet AND ended_at IS NULL;   -- si non-admin

-- Row Level Security --------------------------------------------------------------
ALTER TABLE app_user       ENABLE ROW LEVEL SECURITY;
ALTER TABLE project        ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity       ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entry     ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON app_user FOR SELECT
  USING (current_is_admin() OR id = current_app_user_id());
CREATE POLICY app_user_insert ON app_user FOR INSERT
  WITH CHECK (current_is_admin() OR id = current_app_user_id());
CREATE POLICY app_user_update ON app_user FOR UPDATE
  USING (current_is_admin() OR id = current_app_user_id())
  WITH CHECK (current_is_admin() OR id = current_app_user_id());
CREATE POLICY app_user_delete ON app_user FOR DELETE
  USING (current_is_admin() AND id <> current_app_user_id());

CREATE POLICY project_select ON project FOR SELECT
  USING (current_is_admin() OR is_project_member(id) OR is_author_on_project(id));
CREATE POLICY project_insert ON project FOR INSERT WITH CHECK (current_is_admin());
CREATE POLICY project_delete ON project FOR DELETE USING (current_is_admin());
-- Pas de politique UPDATE : personne ne renomme un Projet (comme la source).

CREATE POLICY project_member_select ON project_member FOR SELECT
  USING (current_is_admin() OR user_id = current_app_user_id());
CREATE POLICY project_member_insert ON project_member FOR INSERT WITH CHECK (current_is_admin());
CREATE POLICY project_member_delete ON project_member FOR DELETE USING (current_is_admin());

CREATE POLICY activity_select ON activity FOR SELECT
  USING (current_is_admin() OR is_project_member(project_id) OR is_author_on_activity(id));
CREATE POLICY activity_insert ON activity FOR INSERT              -- admin, ou démarrage de chronomètre
  WITH CHECK (current_is_admin() OR is_project_member(project_id));
CREATE POLICY activity_update ON activity FOR UPDATE              -- renommage
  USING (current_is_admin() OR is_project_member(project_id))
  WITH CHECK (current_is_admin() OR is_project_member(project_id));
CREATE POLICY activity_delete ON activity FOR DELETE USING (current_is_admin());

CREATE POLICY time_entry_select ON time_entry FOR SELECT
  USING (current_is_admin() OR user_id = current_app_user_id());
CREATE POLICY time_entry_insert ON time_entry FOR INSERT
  WITH CHECK (user_id = current_app_user_id()
              AND (current_is_admin() OR is_project_member(project_id)));
CREATE POLICY time_entry_update ON time_entry FOR UPDATE
  USING (current_is_admin() OR user_id = current_app_user_id())
  WITH CHECK (current_is_admin() OR user_id = current_app_user_id());
CREATE POLICY time_entry_delete ON time_entry FOR DELETE
  USING (current_is_admin() OR user_id = current_app_user_id());

-- Publication PowerSync (0002) : supprimée, le profil mobile est hors périmètre.
