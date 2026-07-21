-- V10: Worship-leader song memory + library search + auto-linked setlist songs
-- Run in Supabase SQL editor after v9_profiles_teams.sql.
--
-- When a leader builds a setlist, repeating songs pre-fill last time's flow +
-- conductor notes + YouTube link. Two layers:
--   worship_leader_song_memory  — how THIS leader last did the song
--   library_song_arrangement    — the song's last-known arrangement (any leader,
--                                 incl. historical Excel-only services) = the
--                                 fallback AND the seed for your existing months
--                                 of records. Wednesday's Excel still overwrites.
--
-- Contents:
--   1. Tables (both SELECT-only to clients; writes via SECURITY DEFINER)
--   2. _service_song_snapshots()  resolve+snapshot a service's songs (helper)
--   3. apply_song_memory()        restore into a BLANK song (create + edit-add)
--   4. capture_service_memory()   snapshot after ingest (called by upload route)
--   5. create_setlist()           auto-link/create library songs + restore memory
--   6. search_library()           search by title AND de-chorded lyrics
--   7. ONE-TIME backfill of all existing services

-- ============================================================
-- 1. Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS worship_leader_song_memory (
  worship_leader_id uuid NOT NULL REFERENCES profiles ON DELETE CASCADE,
  library_song_id   uuid NOT NULL REFERENCES library_songs ON DELETE CASCADE,
  snapshot          jsonb NOT NULL,               -- { scale, reference_links[], sections[] }
  source_service_date date NOT NULL,               -- guards re-uploading old charts
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (worship_leader_id, library_song_id)
);
ALTER TABLE worship_leader_song_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view song memory" ON worship_leader_song_memory
  FOR SELECT TO authenticated USING (true);

-- The song's most recent arrangement regardless of leader — fallback + history seed.
CREATE TABLE IF NOT EXISTS library_song_arrangement (
  library_song_id   uuid PRIMARY KEY REFERENCES library_songs ON DELETE CASCADE,
  snapshot          jsonb NOT NULL,
  source_service_date date NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE library_song_arrangement ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view arrangements" ON library_song_arrangement
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 2. _service_song_snapshots — resolve each in-chart song to a library song
--    (explicit link → normalized-title match) and build its snapshot. Shared by
--    both upserts in capture so the resolution/snapshot logic lives in one place.
-- ============================================================

CREATE OR REPLACE FUNCTION _service_song_snapshots(p_service_id uuid)
RETURNS TABLE (library_song_id uuid, snapshot jsonb) AS $$
  SELECT DISTINCT ON (lib.library_song_id)
    lib.library_song_id,
    jsonb_build_object(
      'scale', s.scale,
      'reference_links', to_jsonb(s.reference_links),
      'sections', (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'order_index', sec.order_index,
            'label', sec.label,
            'comments', sec.comments,
            'instructions', (
              SELECT coalesce(jsonb_agg(
                jsonb_build_object('instrument', i.instrument, 'text', i.text, 'is_intro', i.is_intro)
                ORDER BY i.instrument
              ), '[]'::jsonb)
              FROM instructions i WHERE i.section_id = sec.id
            )
          ) ORDER BY sec.order_index
        ), '[]'::jsonb)
        FROM sections sec WHERE sec.song_id = s.id
      )
    )
  FROM songs s
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      (SELECT sl.library_song_id FROM song_links sl WHERE sl.song_id = s.id),
      (SELECT ls.id FROM library_songs ls
        WHERE oncue_norm_title(ls.title) = oncue_norm_title(s.title)
        ORDER BY ls.created_at LIMIT 1)
    ) AS library_song_id
  ) lib
  WHERE s.service_id = p_service_id
    AND s.in_chart = true
    AND lib.library_song_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM sections sx WHERE sx.song_id = s.id)  -- never snapshot an empty song
  ORDER BY lib.library_song_id, s.order_index;                       -- one row per library song (reprise-safe)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION _service_song_snapshots(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION _service_song_snapshots(uuid) TO authenticated, service_role;

-- ============================================================
-- 3. apply_song_memory — fill a BLANK song from memory. Returns applied
--    instruments so create_setlist can union them.
-- ============================================================

CREATE OR REPLACE FUNCTION apply_song_memory(
  p_song_id uuid,
  p_worship_leader uuid,
  p_library_song_id uuid
) RETURNS text[] AS $$
DECLARE
  v_snap jsonb;
  v_section jsonb;
  v_section_id uuid;
  v_instruments text[] := '{}';
BEGIN
  -- Editors only (service_role has no auth.uid()). Mirrors create_setlist's gate.
  IF auth.uid() IS NOT NULL AND NOT can_edit_content() THEN RETURN '{}'; END IF;
  IF p_library_song_id IS NULL THEN RETURN '{}'; END IF;
  -- Never overwrite a song that already has sections (e.g. from the chart).
  IF EXISTS (SELECT 1 FROM sections WHERE song_id = p_song_id) THEN RETURN '{}'; END IF;

  -- This leader's own memory first; else the song's last-known arrangement
  -- (any leader, incl. your historical records).
  SELECT snapshot INTO v_snap
  FROM worship_leader_song_memory
  WHERE library_song_id = p_library_song_id AND worship_leader_id = p_worship_leader;

  IF v_snap IS NULL THEN
    SELECT snapshot INTO v_snap
    FROM library_song_arrangement
    WHERE library_song_id = p_library_song_id;
  END IF;

  IF v_snap IS NULL THEN RETURN '{}'; END IF;

  UPDATE songs SET
    reference_links = ARRAY(SELECT jsonb_array_elements_text(coalesce(v_snap->'reference_links', '[]'::jsonb))),
    scale = coalesce(scale, nullif(v_snap->>'scale', ''))
  WHERE id = p_song_id;

  FOR v_section IN SELECT * FROM jsonb_array_elements(coalesce(v_snap->'sections', '[]'::jsonb)) LOOP
    INSERT INTO sections (song_id, order_index, label, comments)
    VALUES (
      p_song_id,
      (v_section->>'order_index')::int,
      v_section->>'label',
      coalesce(v_section->>'comments', '')
    )
    RETURNING id INTO v_section_id;

    INSERT INTO instructions (section_id, instrument, text, is_intro)
    SELECT v_section_id, i->>'instrument', coalesce(i->>'text', ''), coalesce((i->>'is_intro')::boolean, false)
    FROM jsonb_array_elements(coalesce(v_section->'instructions', '[]'::jsonb)) i;

    v_instruments := v_instruments || ARRAY(
      SELECT DISTINCT i->>'instrument'
      FROM jsonb_array_elements(coalesce(v_section->'instructions', '[]'::jsonb)) i
      WHERE i->>'instrument' IS NOT NULL
    );
  END LOOP;

  RETURN ARRAY(SELECT DISTINCT unnest(v_instruments));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION apply_song_memory(uuid, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION apply_song_memory(uuid, uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- 4. capture_service_memory — snapshot after an Excel ingest (and used by the
--    backfill). Always updates the song's last-known arrangement; also updates
--    the per-leader memory when the service has a worship leader. Both guarded
--    so an OLDER chart can never rewind newer data.
-- ============================================================

CREATE OR REPLACE FUNCTION capture_service_memory(p_service_id uuid)
RETURNS void AS $$
DECLARE
  v_wl uuid;
  v_date date;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_privileged() THEN
    RAISE EXCEPTION 'Only admins can capture setlist memory';
  END IF;

  SELECT worship_leader_id, service_date INTO v_wl, v_date
  FROM services WHERE id = p_service_id;
  IF v_date IS NULL THEN RETURN; END IF; -- no such service

  -- Last-known arrangement (any leader) — the fallback + history seed.
  INSERT INTO library_song_arrangement (library_song_id, snapshot, source_service_date, updated_at)
  SELECT library_song_id, snapshot, v_date, now()
  FROM _service_song_snapshots(p_service_id)
  ON CONFLICT (library_song_id) DO UPDATE
    SET snapshot = EXCLUDED.snapshot,
        source_service_date = EXCLUDED.source_service_date,
        updated_at = now()
    WHERE library_song_arrangement.source_service_date <= EXCLUDED.source_service_date;

  -- Per-leader memory, only when we know who led it.
  IF v_wl IS NOT NULL THEN
    INSERT INTO worship_leader_song_memory (worship_leader_id, library_song_id, snapshot, source_service_date, updated_at)
    SELECT v_wl, library_song_id, snapshot, v_date, now()
    FROM _service_song_snapshots(p_service_id)
    ON CONFLICT (worship_leader_id, library_song_id) DO UPDATE
      SET snapshot = EXCLUDED.snapshot,
          source_service_date = EXCLUDED.source_service_date,
          updated_at = now()
      WHERE worship_leader_song_memory.source_service_date <= EXCLUDED.source_service_date;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION capture_service_memory(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION capture_service_memory(uuid) TO authenticated, service_role;

-- ============================================================
-- 5. create_setlist v2 — resolve every song to a library song (auto-create a
--    "needs chords" entry when new), link it, and restore memory into it.
--    p_songs: [{title, scale, library_song_id|null}]
-- ============================================================

CREATE OR REPLACE FUNCTION create_setlist(
  p_service_date date,
  p_day_of_week text,
  p_worship_leader uuid,
  p_songs jsonb
) RETURNS jsonb AS $$
DECLARE
  v_service_id uuid;
  v_song jsonb;
  v_song_id uuid;
  v_lib_id uuid;
  v_idx int := 0;
  v_instruments text[] := '{}';
BEGIN
  IF NOT can_edit_content() THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF EXISTS (SELECT 1 FROM services WHERE service_date = p_service_date) THEN
    RAISE EXCEPTION 'A service already exists for %', p_service_date;
  END IF;
  IF jsonb_array_length(p_songs) = 0 THEN
    RAISE EXCEPTION 'Add at least one song';
  END IF;

  INSERT INTO services (service_date, day_of_week, source_filename, instruments, worship_leader_id)
  VALUES (p_service_date, p_day_of_week, 'setlist-draft', '{}', p_worship_leader)
  RETURNING id INTO v_service_id;

  FOR v_song IN SELECT * FROM jsonb_array_elements(p_songs) LOOP
    INSERT INTO songs (service_id, order_index, title, scale, medley_group, reference_links, in_chart)
    VALUES (v_service_id, v_idx, v_song->>'title', nullif(v_song->>'scale', ''), NULL, '{}', true)
    RETURNING id INTO v_song_id;

    -- explicit id → normalized-title match → create a "needs chords" entry
    v_lib_id := nullif(v_song->>'library_song_id', '')::uuid;
    IF v_lib_id IS NULL THEN
      SELECT id INTO v_lib_id FROM library_songs
      WHERE oncue_norm_title(title) = oncue_norm_title(v_song->>'title')
      ORDER BY created_at LIMIT 1;
    END IF;
    IF v_lib_id IS NULL THEN
      INSERT INTO library_songs (title) VALUES (btrim(v_song->>'title'))
      RETURNING id INTO v_lib_id;
    END IF;

    INSERT INTO song_links (library_song_id, song_id)
    VALUES (v_lib_id, v_song_id)
    ON CONFLICT (song_id) DO NOTHING;

    v_instruments := v_instruments || apply_song_memory(v_song_id, p_worship_leader, v_lib_id);
    v_idx := v_idx + 1;
  END LOOP;

  IF array_length(v_instruments, 1) IS NOT NULL THEN
    UPDATE services
    SET instruments = ARRAY(SELECT DISTINCT unnest(v_instruments))
    WHERE id = v_service_id;
  END IF;

  INSERT INTO session_state (service_id, current_song_index, current_section_index)
  VALUES (v_service_id, 0, 0)
  ON CONFLICT (service_id) DO NOTHING;

  RETURN jsonb_build_object('service_id', v_service_id, 'songs', v_idx);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION create_setlist(date, text, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION create_setlist(date, text, uuid, jsonb) TO authenticated, service_role;

-- ============================================================
-- 6. search_library — match by title AND de-chorded lyrics.
-- ============================================================

CREATE OR REPLACE FUNCTION search_library(p_query text)
RETURNS TABLE (id uuid, title text, artist text, has_chords boolean, snippet text) AS $$
  WITH q AS (SELECT btrim(lower(coalesce(p_query, ''))) AS term)
  SELECT
    ls.id,
    ls.title,
    ls.artist,
    EXISTS (
      SELECT 1 FROM song_versions v
      WHERE v.library_song_id = ls.id AND v.reviewed_at IS NOT NULL
    ) AS has_chords,
    (
      SELECT left(btrim(regexp_replace(
               regexp_replace(coalesce(v.content_chordpro, ''), '\[[^\]]*\]', '', 'g'),
               '\s+', ' ', 'g')), 160)
      FROM song_versions v
      WHERE v.library_song_id = ls.id AND v.reviewed_at IS NOT NULL
      ORDER BY v.reviewed_at DESC LIMIT 1
    ) AS snippet
  FROM library_songs ls, q
  WHERE q.term = ''
     OR lower(ls.title) LIKE '%' || q.term || '%'
     OR EXISTS (
       SELECT 1 FROM song_versions v
       WHERE v.library_song_id = ls.id AND v.reviewed_at IS NOT NULL
         AND lower(regexp_replace(coalesce(v.content_chordpro, ''), '\[[^\]]*\]', '', 'g')) LIKE '%' || q.term || '%'
     )
  ORDER BY (lower(ls.title) LIKE '%' || q.term || '%') DESC, ls.title
  LIMIT 25;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION search_library(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION search_library(text) TO authenticated, service_role;

-- ============================================================
-- 7. ONE-TIME backfill — seed memory from every existing service, oldest first
--    so the date guard keeps the most recent. Safe to re-run (idempotent).
-- ============================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM services ORDER BY service_date ASC, uploaded_at ASC LOOP
    PERFORM capture_service_memory(r.id);
  END LOOP;
END $$;
