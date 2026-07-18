-- V5: Setlist-first flow — worship leader, chart merge, section maps
-- Run in Supabase SQL editor after v4_chords_phase1.sql

-- ============================================================
-- 1. Worship leader on services + "in chart" flag on songs
-- ============================================================

ALTER TABLE services ADD COLUMN IF NOT EXISTS worship_leader_id uuid REFERENCES profiles ON DELETE SET NULL;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS in_chart boolean NOT NULL DEFAULT true;

-- ============================================================
-- 2. Manual section maps: chart label → chord section label,
--    per LIBRARY song, so a mapping applies every week.
-- ============================================================

CREATE TABLE IF NOT EXISTS chord_section_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library_song_id uuid NOT NULL REFERENCES library_songs ON DELETE CASCADE,
  chart_label_normalized text NOT NULL,   -- e.g. "instrumental solo"
  chord_section_label text NOT NULL,      -- e.g. "Interlude" (the sheet's label)
  created_at timestamptz DEFAULT now(),
  UNIQUE (library_song_id, chart_label_normalized)
);
ALTER TABLE chord_section_maps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view section maps" ON chord_section_maps
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Editors can manage section maps" ON chord_section_maps
  FOR ALL TO authenticated USING (can_edit_content()) WITH CHECK (can_edit_content());

-- ============================================================
-- 3. ingest_chart v2: MERGE instead of replace when the service
--    already has songs (setlist-first flow).
--    - existing songs matched by normalised title keep their id
--      (preserving song_links and enabling note restoration),
--      take the chart's order/scale/sections, in_chart = true
--    - chart songs with no match are inserted fresh
--    - setlist songs missing from the chart are KEPT, flagged
--      in_chart = false, ordered after the chart songs
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
  v_max_order int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_privileged() THEN
    RAISE EXCEPTION 'Only admins can upload charts';
  END IF;

  -- Snapshot private notes of any existing service on this date,
  -- keyed by song title + section label, so a corrected re-upload keeps them.
  CREATE TEMP TABLE _note_snapshot ON COMMIT DROP AS
  SELECT un.user_id,
         un.instrument AS note_instrument,
         un.note_text,
         s.title       AS song_title,
         sec.label     AS section_label,
         sec.order_index AS section_order,
         false         AS restored
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
         lower(regexp_replace(title, '[^a-zA-Z0-9 ]', '', 'g')) AS norm_title,
         false AS claimed
  FROM songs WHERE service_id = v_service_id;

  FOR v_song IN SELECT * FROM jsonb_array_elements(payload->'songs') LOOP
    v_song_id := NULL;

    -- Merge: claim an existing unclaimed song with the same normalised title
    SELECT e.id INTO v_song_id
    FROM _existing e
    WHERE NOT e.claimed
      AND e.norm_title = lower(regexp_replace(v_song->>'title', '[^a-zA-Z0-9 ]', '', 'g'))
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
          AND ns.song_title = v_song->>'title'
          AND ns.section_label = v_section->>'label'
          AND (
            ns.section_order = (v_section->>'order_index')::int
            OR NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(v_song->'sections') s2
              WHERE s2->>'label' = ns.section_label
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

  -- Setlist songs the chart didn't include: keep, flag, push to the end
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
    'kept_not_in_chart', v_kept_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION ingest_chart(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION ingest_chart(jsonb) TO authenticated, service_role;

-- ============================================================
-- 4. Create a setlist draft (service before the chart exists):
--    date + worship leader + ordered songs from the library,
--    linked to their library songs at creation. One transaction.
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
  v_idx int := 0;
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
    VALUES (v_service_id, v_idx, v_song->>'title', nullif(v_song->>'scale',''), NULL, '{}', true)
    RETURNING id INTO v_song_id;

    IF v_song->>'library_song_id' IS NOT NULL THEN
      INSERT INTO song_links (library_song_id, song_id)
      VALUES ((v_song->>'library_song_id')::uuid, v_song_id)
      ON CONFLICT (song_id) DO NOTHING;
    END IF;
    v_idx := v_idx + 1;
  END LOOP;

  INSERT INTO session_state (service_id, current_song_index, current_section_index)
  VALUES (v_service_id, 0, 0)
  ON CONFLICT (service_id) DO NOTHING;

  RETURN jsonb_build_object('service_id', v_service_id, 'songs', v_idx);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION create_setlist(date, text, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION create_setlist(date, text, uuid, jsonb) TO authenticated, service_role;
