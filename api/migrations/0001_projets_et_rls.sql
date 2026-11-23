-- Modèle de données de mesuraTemporis et sa RLS (ADR-0003, ADR-0006, ADR-0017),
-- d'après l'ébauche validée au ticket #10. Exécuté par le compte propriétaire de
-- la base ; l'API se connecte avec le compte applicatif, soumis à la RLS.
--
-- L'API transmet à chaque transaction l'Utilisateur courant et l'indicateur
-- Administrateur (rôle Keycloak « administrateur ») :
--   SELECT set_config('app.user_id',  '<sub du jeton>', true);
--   SELECT set_config('app.is_admin', 'true' | 'false', true);

-- Rôles d'équipe de l'ADR-0006 : seul 'contributor' (l'Affecté) est attribué.
CREATE TYPE project_role AS ENUM ('reader', 'contributor', 'owner');

CREATE FUNCTION current_app_user_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')
$$;

CREATE FUNCTION current_is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.is_admin', true) = 'true', false)
$$;

-- Utilisateur ------------------------------------------------------------------
-- Copie locale du compte Keycloak, recopiée à chaque jeton (Login, Email, Nom).
-- Créée dès la création du compte par l'écran Utilisateurs, ou à la première
-- connexion d'un compte né de Google.
CREATE TABLE app_user (
  id           text PRIMARY KEY,           -- « sub » du jeton Keycloak
  login        text NOT NULL,              -- username Keycloak
  email        text,
  display_name text,                       -- champ Nom unique, facultatif
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_user_login_key ON app_user (login);
CREATE UNIQUE INDEX app_user_email_key ON app_user (lower(email));

-- Projet -----------------------------------------------------------------------
-- Personne ne renomme un Projet ; il naît avec une équipe vide (pas de
-- « propriétaire » automatique).
CREATE TABLE project (
  id         uuid PRIMARY KEY,
  name       text NOT NULL CHECK (btrim(name) <> ''),
  status     text NOT NULL DEFAULT 'active',  -- badge « actif » (dictionnaire du web), jamais modifié
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Équipe : les Affectés d'un Projet.
CREATE TABLE project_member (
  project_id uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  role       project_role NOT NULL DEFAULT 'contributor' CHECK (role = 'contributor'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_member_user_id_idx ON project_member (user_id);

-- Activité ---------------------------------------------------------------------
-- normalized_name est calculé par shared/ (normalisation identique à la source :
-- NFD, retrait des diacritiques, espaces de bord retirés, minuscules).
CREATE TABLE activity (
  id              uuid PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  normalized_name text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, project_id)                   -- cible de la clé composite de time_entry
);
-- Unicité normalisée des noms d'Activité dans un Projet, garantie par la base.
CREATE UNIQUE INDEX activity_project_name_key ON activity (project_id, normalized_name);

-- Imputation -------------------------------------------------------------------
CREATE TABLE time_entry (
  id          uuid PRIMARY KEY,
  user_id     text NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,   -- l'Auteur
  project_id  uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  activity_id uuid NOT NULL,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz,                                                -- vide = Chronomètre
  -- L'Activité appartient au Projet de l'Imputation.
  FOREIGN KEY (activity_id, project_id) REFERENCES activity (id, project_id) ON DELETE CASCADE,
  CONSTRAINT time_entry_end_after_start CHECK (ended_at IS NULL OR ended_at >= started_at)
);
-- Un seul Chronomètre par Utilisateur.
CREATE UNIQUE INDEX time_entry_one_running_timer ON time_entry (user_id) WHERE ended_at IS NULL;
CREATE INDEX time_entry_user_started_idx ON time_entry (user_id, started_at DESC);
CREATE INDEX time_entry_project_idx ON time_entry (project_id);
CREATE INDEX time_entry_activity_idx ON time_entry (activity_id);

-- Auteur, Projet et Activité d'une Imputation ne changent jamais (Relancer en
-- crée une nouvelle).
CREATE FUNCTION time_entry_freeze_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.activity_id IS DISTINCT FROM OLD.activity_id THEN
    RAISE EXCEPTION 'Auteur, Projet et Activité d''une Imputation ne changent jamais'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER time_entry_freeze_owner
  BEFORE UPDATE ON time_entry FOR EACH ROW EXECUTE FUNCTION time_entry_freeze_owner();

-- Fonctions d'aide. SECURITY DEFINER : elles lisent sans repasser par la RLS
-- de la table interrogée (évite la récursion des politiques).
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

-- Row Level Security (matrice de la spécification #11) ----------------------------
ALTER TABLE app_user       ENABLE ROW LEVEL SECURITY;
ALTER TABLE project        ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity       ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entry     ENABLE ROW LEVEL SECURITY;

-- Utilisateurs : l'Administrateur les voit tous (pas de suppression de soi) ;
-- les autres ne voient que leur propre ligne.
CREATE POLICY app_user_select ON app_user FOR SELECT
  USING (current_is_admin() OR id = current_app_user_id());
CREATE POLICY app_user_insert ON app_user FOR INSERT
  WITH CHECK (current_is_admin() OR id = current_app_user_id());
CREATE POLICY app_user_update ON app_user FOR UPDATE
  USING (current_is_admin() OR id = current_app_user_id())
  WITH CHECK (current_is_admin() OR id = current_app_user_id());
CREATE POLICY app_user_delete ON app_user FOR DELETE
  USING (current_is_admin() AND id <> current_app_user_id());

-- Projet : l'Administrateur voit, crée, supprime ; l'Affecté voit ; un non-affecté
-- ne voit que les Projets où il a des Imputations (pour en afficher le nom).
-- Pas de politique UPDATE : personne ne renomme un Projet.
CREATE POLICY project_select ON project FOR SELECT
  USING (current_is_admin() OR is_project_member(id) OR is_author_on_project(id));
CREATE POLICY project_insert ON project FOR INSERT WITH CHECK (current_is_admin());
CREATE POLICY project_delete ON project FOR DELETE USING (current_is_admin());

-- Équipe : l'Administrateur voit, affecte, retire ; chacun voit ses affectations.
CREATE POLICY project_member_select ON project_member FOR SELECT
  USING (current_is_admin() OR user_id = current_app_user_id());
CREATE POLICY project_member_insert ON project_member FOR INSERT WITH CHECK (current_is_admin());
CREATE POLICY project_member_delete ON project_member FOR DELETE USING (current_is_admin());

-- Activité : l'Administrateur voit, crée, renomme, supprime ; l'Affecté voit, crée
-- (au démarrage d'un Chronomètre), renomme ; un non-affecté ne voit que celles où
-- il a des Imputations.
CREATE POLICY activity_select ON activity FOR SELECT
  USING (current_is_admin() OR is_project_member(project_id) OR is_author_on_activity(id));
CREATE POLICY activity_insert ON activity FOR INSERT
  WITH CHECK (current_is_admin() OR is_project_member(project_id));
CREATE POLICY activity_update ON activity FOR UPDATE
  USING (current_is_admin() OR is_project_member(project_id))
  WITH CHECK (current_is_admin() OR is_project_member(project_id));
CREATE POLICY activity_delete ON activity FOR DELETE USING (current_is_admin());

-- Imputation : l'Administrateur voit, modifie, supprime toutes les Imputations
-- mais ne crée que les siennes ; chacun voit, modifie, supprime les siennes ;
-- seul un Affecté (ou l'Administrateur) en crée.
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
