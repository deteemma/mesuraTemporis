-- Activation des Fournisseurs de connexion par un Administrateur (ADR-0029,
-- ticket #35). Une ligne par fournisseur dont un Administrateur a fait le
-- choix ; sans ligne, le fournisseur suit `.env` (activé si ses identifiants
-- sont présents). Seule la dernière modification est gardée, sans historique.
-- L'auteur est gardé par son Nom (à défaut son Login) au moment du choix,
-- comme pour les Demandes d'accès.

CREATE TABLE identity_provider_setting (
  alias           text PRIMARY KEY CHECK (alias IN ('google', 'microsoft')),  -- alias Keycloak
  enabled         boolean NOT NULL,
  updated_by      text NOT NULL,             -- identifiant de l'Administrateur
  updated_by_name text NOT NULL,             -- son Nom, à défaut son Login, au moment du choix
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE identity_provider_setting ENABLE ROW LEVEL SECURITY;

-- Seul l'Administrateur lit et change le réglage, en son propre nom. Personne
-- ne le supprime : on revient à un état en le changeant.
CREATE POLICY identity_provider_setting_select ON identity_provider_setting FOR SELECT
  USING (current_is_admin());
CREATE POLICY identity_provider_setting_insert ON identity_provider_setting FOR INSERT
  WITH CHECK (current_is_admin() AND updated_by = current_app_user_id());
CREATE POLICY identity_provider_setting_update ON identity_provider_setting FOR UPDATE
  USING (current_is_admin())
  WITH CHECK (current_is_admin() AND updated_by = current_app_user_id());

-- Choix à réappliquer à Keycloak au démarrage de l'API, hors de toute requête
-- d'un Utilisateur. Ne livre que l'état de chaque fournisseur, déjà visible sur
-- la page de connexion, jamais l'auteur.
CREATE FUNCTION identity_provider_choices() RETURNS TABLE (alias text, enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT alias, enabled FROM identity_provider_setting
$$;
