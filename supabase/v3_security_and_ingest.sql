-- V3: Security hardening + atomic chart ingestion
-- Run in Supabase SQL editor after v2_chords_library.sql
--
-- Fixes:
--   1. Privilege escalation: members could set their own role via the REST API
--   2. Open RLS on songs/sections/instructions (any member could write directly)
--   3. SECURITY DEFINER functions without pinned search_path
--   4. Storage policies for the charts bucket
--   5. ingest_chart(): atomic upload/replace-in-place that preserves private notes

-- ============================================================
-- 1. Pin search_path on existing helper + add content-editor helper
-- ============================================================

CREATE OR REPLACE FUNCTION is_privileged()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('master', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- worship_leader may edit setlist content but not upload/delete services
CREATE OR REPLACE FUNCTION can_edit_content()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('master', 'admin', 'worship_leader')
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 2. Block role self-escalation
--    RLS lets users update their own profile row (instrument, name),
--    but nothing stopped them from writing role='master'. This trigger does.
--    auth.uid() IS NULL = service role / SQL editor: unrestricted.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_role_rules()
RETURNS trigger AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- self-inserted profiles always start as member
    IF NEW.role IS DISTINCT FROM 'member' AND NOT is_privileged() THEN
      NEW.role := 'member';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT is_privileged() THEN
      RAISE EXCEPTION 'You do not have permission to change roles';
    END IF;
    IF auth.uid() = NEW.id THEN
      RAISE EXCEPTION 'You cannot change your own role';
    END IF;
    -- only master may grant/revoke master or admin
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'master') THEN
      IF OLD.role IN ('master', 'admin') OR NEW.role IN ('master', 'admin') THEN
        RAISE EXCEPTION 'Only the master can manage admin roles';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS enforce_role_rules ON profiles;
CREATE TRIGGER enforce_role_rules
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_role_rules();

-- ============================================================
-- 3. Tighten RLS on setlist content
--    Reads stay open to all authenticated users.
--    Writes require master/admin/worship_leader.
--    session_state stays open: anyone can drive Live Sync (per spec).
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can insert songs" ON songs;
DROP POLICY IF EXISTS "Authenticated users can update songs" ON songs;
DROP POLICY IF EXISTS "Authenticated users can delete songs" ON songs;
CREATE POLICY "Editors can insert songs" ON songs
  FOR INSERT TO authenticated WITH CHECK (can_edit_content());
CREATE POLICY "Editors can update songs" ON songs
  FOR UPDATE TO authenticated USING (can_edit_content());
CREATE POLICY "Editors can delete songs" ON songs
  FOR DELETE TO authenticated USING (can_edit_content());

DROP POLICY IF EXISTS "Authenticated users can insert sections" ON sections;
DROP POLICY IF EXISTS "Authenticated users can update sections" ON sections;
DROP POLICY IF EXISTS "Authenticated users can delete sections" ON sections;
CREATE POLICY "Editors can insert sections" ON sections
  FOR INSERT TO authenticated WITH CHECK (can_edit_content());
CREATE POLICY "Editors can update sections" ON sections
  FOR UPDATE TO authenticated USING (can_edit_content());
CREATE POLICY "Editors can delete sections" ON sections
  FOR DELETE TO authenticated USING (can_edit_content());

DROP POLICY IF EXISTS "Authenticated users can insert instructions" ON instructions;
DROP POLICY IF EXISTS "Authenticated users can update instructions" ON instructions;
DROP POLICY IF EXISTS "Authenticated users can delete instructions" ON instructions;
CREATE POLICY "Editors can insert instructions" ON instructions
  FOR INSERT TO authenticated WITH CHECK (can_edit_content());
CREATE POLICY "Editors can update instructions" ON instructions
  FOR UPDATE TO authenticated USING (can_edit_content());
CREATE POLICY "Editors can delete instructions" ON instructions
  FOR DELETE TO authenticated USING (can_edit_content());

-- ============================================================
-- 4. Storage policies for the charts bucket
--    (create the bucket "charts" as PRIVATE in Storage UI if it doesn't exist)
-- ============================================================

DROP POLICY IF EXISTS "Privileged can upload charts" ON storage.objects;
DROP POLICY IF EXISTS "Privileged can update charts" ON storage.objects;
DROP POLICY IF EXISTS "Privileged can delete charts" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read charts" ON storage.objects;

CREATE POLICY "Privileged can upload charts" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'charts' AND is_privileged());
CREATE POLICY "Privileged can update charts" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'charts' AND is_privileged());
CREATE POLICY "Privileged can delete charts" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'charts' AND is_privileged());
CREATE POLICY "Authenticated can read charts" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'charts');

-- ============================================================
-- 5. Atomic ingestion: create OR replace a service in one transaction.
--    Replacing preserves users' private notes by matching
--    song title + section label (+ position when labels repeat).
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
    DELETE FROM songs WHERE service_id = v_service_id;
    UPDATE services SET
      day_of_week     = payload->>'day_of_week',
      source_filename = payload->>'source_filename',
      uploaded_at     = now(),
      instruments     = ARRAY(SELECT jsonb_array_elements_text(payload->'instruments'))
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

  FOR v_song IN SELECT * FROM jsonb_array_elements(payload->'songs') LOOP
    INSERT INTO songs (service_id, order_index, title, scale, medley_group, reference_links)
    VALUES (
      v_service_id,
      (v_song->>'order_index')::int,
      v_song->>'title',
      v_song->>'scale',
      v_song->>'medley_group',
      ARRAY(SELECT jsonb_array_elements_text(v_song->'reference_links'))
    )
    RETURNING id INTO v_song_id;
    v_song_count := v_song_count + 1;

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

      -- Restore snapshot notes onto the matching new section.
      -- Each snapshot note is restored at most once (prefer exact position match).
      WITH candidates AS (
        SELECT ctid FROM _note_snapshot ns
        WHERE NOT ns.restored
          AND ns.song_title = v_song->>'title'
          AND ns.section_label = v_section->>'label'
          AND (
            -- same position as before, or its old position no longer has a
            -- same-label section in the new chart (section moved) — then
            -- fall back to this one
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

  -- Seed/reset live position
  INSERT INTO session_state (service_id, current_song_index, current_section_index, updated_at)
  VALUES (v_service_id, 0, 0, now())
  ON CONFLICT (service_id) DO UPDATE
    SET current_song_index = 0, current_section_index = 0, updated_at = now();

  RETURN jsonb_build_object(
    'service_id', v_service_id,
    'replaced', v_replaced,
    'songs', v_song_count,
    'notes_restored', v_notes_restored
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION ingest_chart(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION ingest_chart(jsonb) TO authenticated, service_role;
