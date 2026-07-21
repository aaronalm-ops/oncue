-- V11: add_setlist_song — add ONE song to an existing setlist with the same
-- resolve/link/memory behaviour as create_setlist, so pre-fill also happens on
-- Edit Setlist (the "both" decision). Run after v10_setlist_memory.sql.

CREATE OR REPLACE FUNCTION add_setlist_song(
  p_service_id uuid,
  p_title text,
  p_scale text,
  p_library_song_id uuid
) RETURNS jsonb AS $$
DECLARE
  v_wl uuid;
  v_song_id uuid;
  v_lib uuid;
  v_order int;
  v_instr text[];
BEGIN
  IF NOT can_edit_content() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_title IS NULL OR btrim(p_title) = '' THEN RAISE EXCEPTION 'Song title is required'; END IF;

  SELECT worship_leader_id INTO v_wl FROM services WHERE id = p_service_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service not found'; END IF;

  SELECT coalesce(max(order_index), -1) + 1 INTO v_order FROM songs WHERE service_id = p_service_id;

  INSERT INTO songs (service_id, order_index, title, scale, medley_group, reference_links, in_chart)
  VALUES (p_service_id, v_order, btrim(p_title), nullif(p_scale, ''), NULL, '{}', true)
  RETURNING id INTO v_song_id;

  -- explicit id → normalized-title match → create a "needs chords" entry
  v_lib := p_library_song_id;
  IF v_lib IS NULL THEN
    SELECT id INTO v_lib FROM library_songs
    WHERE oncue_norm_title(title) = oncue_norm_title(p_title) ORDER BY created_at LIMIT 1;
  END IF;
  IF v_lib IS NULL THEN
    INSERT INTO library_songs (title) VALUES (btrim(p_title)) RETURNING id INTO v_lib;
  END IF;

  INSERT INTO song_links (library_song_id, song_id) VALUES (v_lib, v_song_id)
  ON CONFLICT (song_id) DO NOTHING;

  -- Pre-fill flow + conductor notes + YouTube from memory (blank song only).
  v_instr := apply_song_memory(v_song_id, v_wl, v_lib);
  IF array_length(v_instr, 1) IS NOT NULL THEN
    UPDATE services SET instruments = ARRAY(SELECT DISTINCT unnest(instruments || v_instr))
    WHERE id = p_service_id;
  END IF;

  RETURN jsonb_build_object('song_id', v_song_id, 'library_song_id', v_lib);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION add_setlist_song(uuid, text, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION add_setlist_song(uuid, text, text, uuid) TO authenticated, service_role;
