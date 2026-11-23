-- Demande d'accès (ADR-0028, ticket #31) : la première connexion Google (ou
-- Microsoft) d'une personne inconnue crée une Demande d'accès en attente, et non
-- un Utilisateur. Le compte Keycloak de la personne existe déjà (créé par la
-- première connexion du fournisseur) : il réserve l'Email dans l'Annuaire ; la
-- Demande d'accès le réserve aussi dans l'application.

CREATE TABLE access_request (
  account_id   text PRIMARY KEY,           -- « sub » du jeton Keycloak de la personne
  email        text,                       -- Email transmis par le fournisseur
  display_name text,                       -- Nom transmis par le fournisseur
  provider     text NOT NULL,              -- fournisseur d'identité (alias Keycloak : google, microsoft)
  status       text NOT NULL DEFAULT 'pending' CHECK (status = 'pending'),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX access_request_email_key ON access_request (lower(email));

ALTER TABLE access_request ENABLE ROW LEVEL SECURITY;

-- L'Administrateur voit toutes les demandes ; la personne en attente, la sienne.
CREATE POLICY access_request_select ON access_request FOR SELECT
  USING (current_is_admin() OR account_id = current_app_user_id());
-- Seule la personne crée sa propre demande, en attente, et seulement si elle
-- n'est pas déjà Utilisateur.
CREATE POLICY access_request_insert ON access_request FOR INSERT
  WITH CHECK (account_id = current_app_user_id() AND status = 'pending'
              AND NOT EXISTS (SELECT 1 FROM app_user WHERE id = current_app_user_id()));
-- Seul l'Administrateur supprime une demande. Pas de politique UPDATE : la
-- décision de l'Administrateur viendra avec son propre ticket.
CREATE POLICY access_request_delete ON access_request FOR DELETE USING (current_is_admin());
