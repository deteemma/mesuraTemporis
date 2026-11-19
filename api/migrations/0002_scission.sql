-- Scission à l'Édition à la volée (ADR-0013), sur les minuits de la Journée
-- Europe/Zurich (ADR-0012).
--
-- La Scission crée une Imputation que la politique d'insertion refuserait dans
-- deux cas, acceptés à l'identique de la source (validé le 2026-11-19, #17) :
-- l'Auteur retiré du Projet qui édite une ancienne Imputation, et
-- l'Administrateur qui édite l'Imputation d'un autre Utilisateur. La création
-- passe donc par cette fonction, et seulement sous la forme d'une Scission :
-- même Auteur, Projet et Activité que l'original, les deux Imputations se
-- touchant au minuit de la Journée de l'original. La création libre reste
-- soumise à la RLS. Le calcul de la Scission est celui de shared/ (split.ts) ;
-- cette fonction n'en revérifie que la forme, comme seconde barrière (ADR-0006).
-- Les deux écritures se font dans la transaction de l'appelant.

-- Minuit (Europe/Zurich) qui ouvre la Journée d'un instant.
CREATE FUNCTION zurich_day_start(p_at timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $$
  SELECT date_trunc('day', p_at AT TIME ZONE 'Europe/Zurich') AT TIME ZONE 'Europe/Zurich'
$$;

CREATE FUNCTION split_time_entry(
  p_id uuid,
  p_original_start timestamptz,
  p_original_end timestamptz,
  p_new_id uuid,
  p_new_start timestamptz,
  p_new_end timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  original time_entry;
  one_ms CONSTANT interval := interval '1 millisecond';
BEGIN
  -- Seuls l'Auteur et l'Administrateur modifient une Imputation (time_entry_update).
  SELECT * INTO original FROM time_entry
   WHERE id = p_id AND (current_is_admin() OR user_id = current_app_user_id())
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Imputation introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF original.ended_at IS NULL THEN
    RAISE EXCEPTION 'Le Chronomètre n''est jamais scindé' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (
    -- Vers le lendemain : l'original garde son début et s'arrête à 23:59:59.999 ;
    -- la nouvelle Imputation part de minuit et reste dans sa Journée.
    (p_original_start = original.started_at
     AND p_new_start = zurich_day_start(p_new_start)
     AND p_original_end = p_new_start - one_ms
     AND zurich_day_start(p_original_start) = zurich_day_start(p_original_end)
     AND zurich_day_start(p_new_end) = p_new_start)
    OR
    -- Vers la veille : l'original garde sa fin et part de minuit ; la nouvelle
    -- Imputation s'arrête à 23:59:59.999 de la veille et reste dans sa Journée.
    (p_original_end = original.ended_at
     AND p_original_start = zurich_day_start(original.ended_at)
     AND p_new_end = p_original_start - one_ms
     AND zurich_day_start(p_new_start) = zurich_day_start(p_new_end))
  ) THEN
    RAISE EXCEPTION 'Ce n''est pas une Scission à minuit' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE time_entry SET started_at = p_original_start, ended_at = p_original_end WHERE id = p_id;
  INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at, ended_at)
  VALUES (p_new_id, original.user_id, original.project_id, original.activity_id, p_new_start, p_new_end);
END
$$;
