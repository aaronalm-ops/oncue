-- V8: Hardening pass — QA backlog items 5, 6, 7, 9, 11, 13(search_path)
-- Run in Supabase SQL editor after v7_impromptu.sql, BEFORE deploying the
-- matching client changes.
--
-- Contents:
--   1. Normalisation helpers (shared by merge + note restore)
--   2. #6/#7  ingest_chart: normalise note-restore join; drop ghost songs
--   3. #5     confirm_chord_upload: advisory lock against double-confirm
--   4. #11    approve_song_version: stop writing dead chord_sections; drop table
--   5. #13    handle_new_user: pin search_path
--   6. #9     set_impromptu: atomic share-live that never resets live position

-- ============================================================
-- 1. Normalisation helpers
--    oncue_norm_title matches the existing merge expression exactly, so a
--    song claimed by the merge is the same song the note-restore looks up.
-- ============================================================

CREATE OR REPLACE FUNCTION oncue_norm_title(t text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
    SELECT lower(regexp_replace(coalesce(t, ''), '[^a-zA-Z0-9 ]', '', 'g'))
  $$;

CREATE OR REPLACE FUNCTION oncue_norm_label(t text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
    SELECT btrim(lower(regexp_replace(
             regexp_replace(coalesce(t, ''), '\([^)]*\)', '', 'g'),
             '[^a-zA-Z0-9]+', ' ', 'g')))
  $$;

-- ============================================================
-- 2. ingest_chart (#6 + #7)
--    #6: the note snapshot stored raw title/label and the restore matched them
--        EXACTLY, but the song merge matches on a NORMALISED title — so a
--        re-upload that only corrects case/punctuation kept the song yet
--        orphaned its notes. Snapshot + restore now normalise both sides.
--    #7: setlist songs the chart dropped were all flagged in_chart=false and
--        piled up. Now: unclaimed songs with no notes AND no link are DELETED;
--        only ones carrying something worth keeping are flagged.
-- ============================================================

CREATE OR REPLACE FUNCTION ingest_chart(payload jsonb)
RETURNS jsonb AS $$
DECLARE
  v_service_id uuid;
  v_replaced boolean := false;
  v_notes_restored int := 0;
  v_restored int;
  v_song jsonb;
  v_section jsonb;
  v_song_id uuid;
  v_section_id uuid;
  v_song_count int := 0;
  v_kept_count int := 0;
  v_ghosts_deleted int := 0;
  v_max_order int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_privileged() THEN
    RAISE EXCEPTION 'Only admins can upload charts';
  END IF;

  -- Snapshot private notes of any existing service on this date, keyed by
  -- NORMALISED song title + section label so a corrected re-upload keeps them.
  CREATE TEMP TABLE _note_snapshot ON COMMIT DROP AS
  SELECT un.user_id,
         un.instrument           AS note_instrument,
         un.note_text,
         oncue_norm_title(s.title)   AS song_title_norm,
         oncue_norm_label(sec.label) AS section_label_norm,
         sec.order_index         AS section_order,
         false                   AS restored
  FROM user_notes un
  JOIN sections sec ON sec.id = un.section_id
  JOIN songs s      ON s.id = sec.song_id
  JOIN services sv  ON sv.id = s.service_id
  WHERE sv.service_date = (payload->>'service_date')::date;

  SELECT id INTO v_service_id
  FROM services WHERE service_date = (payload->>'service_date')::date;

  IF v_service_id IS NOT NULL THEN
    v_replaced := true;
    UPDATE services SET
      day_of_week     = payload->>'day_of_week',
      source_filename = payload->>'source_filename',
      uploaded_at     = now(),
      instruments     = ARRAY(SELECT jsonb_array_elements_text(payload->'instruments'))
      -- worship_leader_id deliberately untouched: the chart merge never
      -- erases setlist attribution
    WHERE id = v_service_id;
  ELSE
    INSERT INTO services (service_date, day_of_week, source_filename, instruments)
    VALUES (
      (payload->>'service_date')::date,
      payload->>'day_of_week',
      payload->>'source_filename',
      ARRAY(SELECT jsonb_array_elements_text(payload->'instruments'))
    )
    RETURNING id INTO v_service_id;
  END IF;

  -- Track which existing songs get claimed by the incoming chart
  CREATE TEMP TABLE _existing ON COMMIT DROP AS
  SELECT id,
         oncue_norm_title(title) AS norm_title,
         false AS claimed
  FROM songs WHERE service_id = v_service_id;

  FOR v_song IN SELECT * FROM jsonb_array_elements(payload->'songs') LOOP
    v_song_id := NULL;

    -- Merge: claim an existing unclaimed song with the same normalised title
    SELECT e.id INTO v_song_id
    FROM _existing e
    WHERE NOT e.claimed
      AND e.norm_title = oncue_norm_title(v_song->>'title')
    LIMIT 1;

    IF v_song_id IS NOT NULL THEN
      UPDATE _existing SET claimed = true WHERE id = v_song_id;
      -- Chart wins on order/structure; song id (and song_links) survive
      DELETE FROM sections WHERE song_id = v_song_id;
      UPDATE songs SET
        order_index     = (v_song->>'order_index')::int,
        title           = v_song->>'title',
        scale           = v_song->>'scale',
        medley_group    = v_song->>'medley_group',
        reference_links = ARRAY(SELECT jsonb_array_elements_text(v_song->'reference_links')),
        in_chart        = true
      WHERE id = v_song_id;
    ELSE
      INSERT INTO songs (service_id, order_index, title, scale, medley_group, reference_links, in_chart)
      VALUES (
        v_service_id,
        (v_song->>'order_index')::int,
        v_song->>'title',
        v_song->>'scale',
        v_song->>'medley_group',
        ARRAY(SELECT jsonb_array_elements_text(v_song->'reference_links')),
        true
      )
      RETURNING id INTO v_song_id;
    END IF;

    v_song_count := v_song_count + 1;
    v_max_order := greatest(v_max_order, (v_song->>'order_index')::int);

    FOR v_section IN SELECT * FROM jsonb_array_elements(v_song->'sections') LOOP
      INSERT INTO sections (song_id, order_index, label, comments)
      VALUES (
        v_song_id,
        (v_section->>'order_index')::int,
        v_section->>'label',
        coalesce(v_section->>'comments', '')
      )
      RETURNING id INTO v_section_id;

      INSERT INTO instructions (section_id, instrument, text, is_intro)
      SELECT v_section_id,
             i->>'instrument',
             coalesce(i->>'text', ''),
             coalesce((i->>'is_intro')::boolean, false)
      FROM jsonb_array_elements(v_section->'instructions') i;

      WITH candidates AS (
        SELECT ctid FROM _note_snapshot ns
        WHERE NOT ns.restored
          AND ns.song_title_norm = oncue_norm_title(v_song->>'title')
          AND ns.section_label_norm = oncue_norm_label(v_section->>'label')
          AND (
            ns.section_order = (v_section->>'order_index')::int
            OR NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(v_song->'sections') s2
              WHERE oncue_norm_label(s2->>'label') = ns.section_label_norm
                AND (s2->>'order_index')::int = ns.section_order
            )
          )
      ),
      claimed AS (
        UPDATE _note_snapshot ns SET restored = true
        WHERE ns.ctid IN (SELECT ctid FROM candidates)
        RETURNING ns.user_id, ns.note_instrument, ns.note_text
      )
      INSERT INTO user_notes (user_id, section_id, instrument, note_text)
      SELECT DISTINCT ON (user_id, note_instrument) user_id, v_section_id, note_instrument, note_text
      FROM claimed
      ON CONFLICT (user_id, section_id, instrument) DO NOTHING;

      GET DIAGNOSTICS v_restored = ROW_COUNT;
      v_notes_restored := v_notes_restored + v_restored;
    END LOOP;
  END LOOP;

  -- #7: drop ghost setlist songs the chart dropped that carry nothing worth
  -- keeping (no private notes, no library link). Their sections/instructions
  -- cascade. Songs with notes or a link are kept and flagged below.
  DELETE FROM songs s
  USING _existing e
  WHERE s.id = e.id
    AND NOT e.claimed
    AND NOT EXISTS (SELECT 1 FROM song_links sl WHERE sl.song_id = s.id)
    AND NOT EXISTS (
      SELECT 1 FROM user_notes un
      JOIN sections sec ON sec.id = un.section_id
      WHERE sec.song_id = s.id
    );
  GET DIAGNOSTICS v_ghosts_deleted = ROW_COUNT;

  -- Remaining unclaimed songs: keep, flag, push to the end
  UPDATE songs s SET
    in_chart = false,
    order_index = v_max_order + 1 + sub.rn
  FROM (
    SELECT e.id, row_number() OVER (ORDER BY s2.order_index) AS rn
    FROM _existing e JOIN songs s2 ON s2.id = e.id
    WHERE NOT e.claimed
  ) sub
  WHERE s.id = sub.id;
  GET DIAGNOSTICS v_kept_count = ROW_COUNT;

  INSERT INTO session_state (service_id, current_song_index, current_section_index, updated_at)
  VALUES (v_service_id, 0, 0, now())
  ON CONFLICT (service_id) DO UPDATE
    SET current_song_index = 0, current_section_index = 0, updated_at = now();

  RETURN jsonb_build_object(
    'service_id', v_service_id,
    'replaced', v_replaced,
    'songs', v_song_count,
    'notes_restored', v_notes_restored,
    'kept_not_in_chart', v_kept_count,
    'ghosts_deleted', v_ghosts_deleted
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION ingest_chart(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION ingest_chart(jsonb) TO authenticated, service_role;

-- ============================================================
-- 3. confirm_chord_upload (#5)
--    A transaction-scoped advisory lock keyed to the upload serialises
--    concurrent double-confirms; the second waits, then finds the upload
--    already deleted and raises cleanly instead of duplicating the song/version.
-- ============================================================

CREATE OR REPLACE FUNCTION confirm_chord_upload(
  p_upload_id uuid,
  p_title text,
  p_artist text,
  p_key text,
  p_bpm int,
  p_library_song_id uuid
) RETURNS jsonb AS $$
DECLARE
  v_upload chord_uploads%ROWTYPE;
  v_song_id uuid := p_library_song_id;
  v_version_id uuid;
  v_label text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  -- Serialise concurrent confirms of the same upload (UI disables, route did not)
  PERFORM pg_advisory_xact_lock(hashtext('confirm_chord_upload:' || p_upload_id::text));

  SELECT * INTO v_upload FROM chord_uploads WHERE id = p_upload_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Upload not found (already confirmed or discarded?)';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'Title is required';
  END IF;

  IF v_song_id IS NULL THEN
    INSERT INTO library_songs (title, artist)
    VALUES (btrim(p_title), nullif(btrim(coalesce(p_artist, '')), ''))
    RETURNING id INTO v_song_id;
  ELSE
    PERFORM 1 FROM library_songs WHERE id = v_song_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selected library song no longer exists'; END IF;
  END IF;

  v_label := CASE WHEN p_key IS NOT NULL AND btrim(p_key) <> ''
                  THEN 'Key of ' || btrim(p_key) ELSE 'Original' END;

  INSERT INTO song_versions
    (library_song_id, label, stored_key, bpm, content_chordpro, source_pdf_path, ccli_number)
  VALUES
    (v_song_id, v_label,
     nullif(btrim(coalesce(p_key, '')), ''),
     p_bpm,
     coalesce(v_upload.draft_body, ''),
     v_upload.pdf_path,
     v_upload.draft_ccli)
  RETURNING id INTO v_version_id;

  DELETE FROM chord_uploads WHERE id = p_upload_id;

  RETURN jsonb_build_object('library_song_id', v_song_id, 'version_id', v_version_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 4. approve_song_version (#11)
--    chord_sections was write-only/dead (the viewer re-parses
--    content_chordpro), yet the RPC trusted client-supplied p_sections and
--    stored them verbatim — an injection surface. Stop writing them, then
--    drop the table. p_sections stays in the signature so the existing route
--    keeps compiling; it is now ignored.
-- ============================================================

CREATE OR REPLACE FUNCTION approve_song_version(
  p_version_id uuid,
  p_content text,
  p_stored_key text,
  p_bpm int,
  p_sections jsonb
) RETURNS jsonb AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  UPDATE song_versions SET
    content_chordpro = p_content,
    stored_key = nullif(btrim(coalesce(p_stored_key, '')), ''),
    bpm = p_bpm,
    reviewed_at = now()
  WHERE id = p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version not found'; END IF;

  RETURN jsonb_build_object(
    'version_id', p_version_id,
    'sections', coalesce(jsonb_array_length(p_sections), 0)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TABLE IF EXISTS chord_sections;

-- ============================================================
-- 5. handle_new_user (#13) — pin search_path on the SECURITY DEFINER trigger
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (new.id);
  RETURN new;
END;
$$;

-- ============================================================
-- 6. set_impromptu (#9)
--    "Share live" / "End impromptu" were plain UPDATEs on session_state, a
--    silent no-op when the row was absent (pre-v5 services). Upserting the
--    whole row from the client would reset the live position to 0, so this
--    RPC inserts a fresh row (position 0) only when missing and otherwise
--    touches ONLY the impromptu columns.
-- ============================================================

CREATE OR REPLACE FUNCTION set_impromptu(
  p_service_id uuid,
  p_library_song_id uuid,
  p_key text
) RETURNS void AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  INSERT INTO session_state
    (service_id, current_song_index, current_section_index,
     impromptu_library_song_id, impromptu_key, updated_at, updated_by)
  VALUES
    (p_service_id, 0, 0, p_library_song_id, p_key, now(), auth.uid()::text)
  ON CONFLICT (service_id) DO UPDATE SET
    impromptu_library_song_id = EXCLUDED.impromptu_library_song_id,
    impromptu_key             = EXCLUDED.impromptu_key,
    updated_at                = now(),
    updated_by                = EXCLUDED.updated_by;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION set_impromptu(uuid, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION set_impromptu(uuid, uuid, text) TO authenticated, service_role;
