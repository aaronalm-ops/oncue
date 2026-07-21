-- V13: set_worship_leader — change (or clear) a service's worship leader after
-- creation. Needed because a worship_leader role can't UPDATE services via RLS
-- (that's is_privileged only), and setlists are often created before the
-- intended leader has registered. Run after v12. p_worship_leader NULL = unassign.

CREATE OR REPLACE FUNCTION set_worship_leader(
  p_service_id uuid,
  p_worship_leader uuid
) RETURNS void AS $$
BEGIN
  IF NOT can_edit_content() THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  UPDATE services SET worship_leader_id = p_worship_leader WHERE id = p_service_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION set_worship_leader(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION set_worship_leader(uuid, uuid) TO authenticated, service_role;
