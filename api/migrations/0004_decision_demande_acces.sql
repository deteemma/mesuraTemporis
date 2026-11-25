-- Décision de l'Administrateur sur les Demandes d'accès (ADR-0028, ticket #32).
--
-- Refus : la demande reste, à l'état refusé, avec l'Administrateur qui l'a
-- prise et sa date. Acceptation : la demande disparaît et l'Utilisateur naît,
-- portant lui-même l'auteur et la date de l'acceptation ; un refus antérieur
-- n'est pas conservé (validé par la responsable fonctionnelle). L'auteur est gardé
-- par son Nom (à défaut son Login) au moment de la décision : il reste affiché
-- si l'Administrateur est supprimé ensuite (validé par la responsable
-- fonctionnelle).

ALTER TABLE access_request DROP CONSTRAINT access_request_status_check;
ALTER TABLE access_request ADD CONSTRAINT access_request_status_check CHECK (status IN ('pending', 'refused'));
ALTER TABLE access_request
  ADD COLUMN decided_by      text,           -- identifiant de l'Administrateur qui a refusé
  ADD COLUMN decided_by_name text,           -- son Nom, à défaut son Login, au moment du refus
  ADD COLUMN decided_at      timestamptz,
  -- Une demande refusée porte toujours sa décision ; en attente, aucune.
  ADD CONSTRAINT access_request_decision_check CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_by_name IS NULL AND decided_at IS NULL)
    OR (status = 'refused' AND decided_by IS NOT NULL AND decided_by_name IS NOT NULL AND decided_at IS NOT NULL)
  );

ALTER TABLE app_user
  ADD COLUMN accepted_by      text,          -- identifiant de l'Administrateur qui a accepté la Demande d'accès
  ADD COLUMN accepted_by_name text,          -- son Nom, à défaut son Login, au moment de l'acceptation
  ADD COLUMN accepted_at      timestamptz,
  ADD CONSTRAINT app_user_acceptance_check CHECK (
    (accepted_by IS NULL) = (accepted_by_name IS NULL) AND (accepted_by IS NULL) = (accepted_at IS NULL)
  );

-- Seul l'Administrateur refuse une demande. Il ne la remet pas en attente (pas
-- de retour arrière) ; l'acceptation la supprime. USING ne filtre pas l'état :
-- la décision verrouille la demande (SELECT … FOR UPDATE, soumis à cette
-- politique), qu'elle soit en attente ou refusée.
CREATE POLICY access_request_update ON access_request FOR UPDATE
  USING (current_is_admin())
  WITH CHECK (current_is_admin() AND status = 'refused');

-- L'acceptation n'est écrite que par l'Administrateur, à la naissance de
-- l'Utilisateur, puis ne change plus : la RLS d'app_user laisse chacun
-- modifier sa propre ligne, colonnes comprises.
CREATE FUNCTION app_user_acceptance_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.accepted_by IS NOT NULL AND NOT current_is_admin() THEN
    RAISE EXCEPTION 'acceptation réservée à l''Administrateur' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.accepted_by, NEW.accepted_by_name, NEW.accepted_at)
                          IS DISTINCT FROM (OLD.accepted_by, OLD.accepted_by_name, OLD.accepted_at) THEN
    RAISE EXCEPTION 'acceptation non modifiable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER app_user_acceptance_guard BEFORE INSERT OR UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION app_user_acceptance_guard();
