-- V16: Mid-song key changes (modulation). Run AFTER v15_fuzzy_merge.sql.
--
-- The conductor can mark a section in the Excel chart with a key change:
--   "LAST CHORUS (KEY A)" / "CHORUS - KEY OF Bb" / "BRIDGE (UP 2)"
-- The parser resolves it to an absolute key and sends it per section;
-- this migration stores it and teaches ingest_chart to write it.
-- The change applies from that section to the end of the song (or until a
-- later marker) — resolution happens client-side (effectiveSectionKeys).
--
-- Only two changes vs v15's ingest_chart:
--   1. sections gains a nullable key_change column
--   2. the section INSERT writes v_section->>'key_change'
-- Everything else is v15 verbatim (graduated fuzzy claim, song-id-keyed
-- note restore, ghost cleanup, session reset).

ALTER TABLE sections ADD COLUMN IF NOT EXISTS key_change text;

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
  v_was_claimed boolean;
  v_inc_norm text;
  v_inc_bracket text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_privileged() THEN
    RAISE EXCEPTION 'Only admins can upload charts';
  END IF;

  -- Snapshot private notes of any existing service on this date. song_id is
  -- the primary restore key (claimed songs keep their id across the merge);
  -- normalised title remains as fallback for unclaimed→new songs.
  CREATE TEMP TABLE _note_snapshot ON COMMIT DROP AS
  SELECT un.user_id,
         un.instrument               AS note_instrument,
         un.note_text,
         s.id                        AS song_id,
         oncue_norm_title(s.title)   AS song_title_norm,
         oncue_norm_label(sec.label) AS section_label_norm,
         sec.order_index             AS section_order,
         false                       AS restored
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
      -- worship_leader_id deliberately untouched
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
         oncue_norm_title(title)     AS norm_title,
         oncue_strip_brackets(title) AS bracket_title,
         false AS claimed
  FROM songs WHERE service_id = v_service_id;

  FOR v_song IN SELECT * FROM jsonb_array_elements(payload->'songs') LOOP
    v_song_id := NULL;
    v_inc_norm := oncue_norm_title(v_song->>'title');
    v_inc_bracket := oncue_strip_brackets(v_song->>'title');

    -- Graduated claim: exact → bracket-stripped → small typo → containment.
    -- Safe in this context: at most a handful of unclaimed candidates.
    SELECT e.id INTO v_song_id
    FROM _existing e
    WHERE NOT e.claimed AND (
      e.norm_title = v_inc_norm
      OR (e.bracket_title <> '' AND e.bracket_title = v_inc_bracket)
      OR (length(e.norm_title) >= 6 AND length(v_inc_norm) >= 6
          AND levenshtein(left(e.norm_title, 120), left(v_inc_norm, 120)) <= 3)
      OR (least(length(e.norm_title), length(v_inc_norm)) >= 6
          AND (position(v_inc_norm IN e.norm_title) > 0 OR position(e.norm_title IN v_inc_norm) > 0)
          AND least(length(e.norm_title), length(v_inc_norm))::float
              / greatest(length(e.norm_title), length(v_inc_norm), 1) >= 0.55)
    )
    ORDER BY
      CASE
        WHEN e.norm_title = v_inc_norm THEN 0
        WHEN e.bracket_title <> '' AND e.bracket_title = v_inc_bracket THEN 1
        WHEN length(e.norm_title) >= 6 AND length(v_inc_norm) >= 6
             AND levenshtein(left(e.norm_title, 120), left(v_inc_norm, 120)) <= 3 THEN 2
        ELSE 3
      END,
      levenshtein(left(e.norm_title, 120), left(v_inc_norm, 120))
    LIMIT 1;

    v_was_claimed := v_song_id IS NOT NULL;

    IF v_was_claimed THEN
      UPDATE _existing SET claimed = true WHERE id = v_song_id;
      -- Chart wins on order/structure/title; song id (links, notes) survives
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
      INSERT INTO sections (song_id, order_index, label, comments, key_change)
      VALUES (
        v_song_id,
        (v_section->>'order_index')::int,
        v_section->>'label',
        coalesce(v_section->>'comments', ''),
        nullif(v_section->>'key_change', '')
      )
      RETURNING id INTO v_section_id;

      INSERT INTO instructions (section_id, instrument, text, is_intro)
      SELECT v_section_id,
             i->>'instrument',
             coalesce(i->>'text', ''),
             coalesce((i->>'is_intro')::boolean, false)
      FROM jsonb_array_elements(v_section->'instructions') i;

      -- Restore notes: by SONG IDENTITY for claimed songs (rename-proof),
      -- by normalised title only for fresh inserts.
      WITH candidates AS (
        SELECT ctid FROM _note_snapshot ns
        WHERE NOT ns.restored
          AND (
            (v_was_claimed AND ns.song_id = v_song_id)
            OR (NOT v_was_claimed AND ns.song_title_norm = oncue_norm_title(v_song->>'title'))
          )
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

  -- Ghost cleanup: unclaimed songs carrying nothing worth keeping are deleted
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
