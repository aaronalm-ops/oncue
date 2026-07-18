-- V4: Chords Library Phase 1 — bulk upload queue, approve flow, RLS fixes
-- Run in Supabase SQL editor after v3_security_and_ingest.sql
--
-- Also required (Storage UI): create a PRIVATE bucket named  chord-pdfs

-- ============================================================
-- 1. Fix v2 inconsistency: library management was is_privileged()
--    but the API routes allow worship_leader. Editors = master/admin/worship_leader.
-- ============================================================

DROP POLICY IF EXISTS "Privileged users can manage library_songs" ON library_songs;
CREATE POLICY "Editors can manage library_songs" ON library_songs
  FOR ALL TO authenticated USING (can_edit_content()) WITH CHECK (can_edit_content());

DROP POLICY IF EXISTS "Privileged users can manage song_versions" ON song_versions;
CREATE POLICY "Editors can manage song_versions" ON song_versions
  FOR ALL TO authenticated USING (can_edit_content()) WITH CHECK (can_edit_content());

-- unreviewed versions stay visible to editors only (policy from v2 kept):
DROP POLICY IF EXISTS "Authenticated users can view reviewed versions" ON song_versions;
CREATE POLICY "Authenticated users can view reviewed versions" ON song_versions
  FOR SELECT TO authenticated USING (reviewed_at IS NOT NULL OR can_edit_content());

DROP POLICY IF EXISTS "Privileged users can manage chord_sections" ON chord_sections;
CREATE POLICY "Editors can manage chord_sections" ON chord_sections
  FOR ALL TO authenticated USING (can_edit_content()) WITH CHECK (can_edit_content());

DROP POLICY IF EXISTS "Privileged users can manage song_links" ON song_links;
CREATE POLICY "Editors can manage song_links" ON song_links
  FOR ALL TO authenticated USING (can_edit_content()) WITH CHECK (can_edit_content());

-- ============================================================
-- 2. Version metadata additions
-- ============================================================

ALTER TABLE song_versions ADD COLUMN IF NOT EXISTS ccli_number text;

-- ============================================================
-- 3. Bulk-upload confirm queue
--    One row per uploaded PDF awaiting identity confirmation.
--    Confirming creates/attaches the song_version and deletes the row.
-- ============================================================

CREATE TABLE IF NOT EXISTS chord_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  pdf_path text NOT NULL,               -- path in chord-pdfs bucket
  original_filename text NOT NULL,
  status text NOT NULL DEFAULT 'parsed' CHECK (status IN ('parsed', 'scan', 'failed')),
  draft_title text,
  draft_artist text,
  draft_key text,
  draft_bpm int,
  draft_ccli text,
  draft_body text,                      -- parsed chord text (internal format)
  section_count int NOT NULL DEFAULT 0,
  warnings jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE chord_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Editors can manage chord_uploads" ON chord_uploads
  FOR ALL TO authenticated USING (can_edit_content()) WITH CHECK (can_edit_content());

-- ============================================================
-- 4. Storage policies for chord-pdfs bucket
--    (create the bucket "chord-pdfs" as PRIVATE in Storage UI first)
-- ============================================================

DROP POLICY IF EXISTS "Editors can upload chord pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Editors can update chord pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Editors can delete chord pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Editors can read chord pdfs" ON storage.objects;

CREATE POLICY "Editors can upload chord pdfs" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'chord-pdfs' AND can_edit_content());
CREATE POLICY "Editors can update chord pdfs" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'chord-pdfs' AND can_edit_content());
CREATE POLICY "Editors can delete chord pdfs" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'chord-pdfs' AND can_edit_content());
CREATE POLICY "Editors can read chord pdfs" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'chord-pdfs' AND can_edit_content());

-- ============================================================
-- 5. Confirm an upload: create-or-attach the song, create the version,
--    remove the queue row — one transaction.
-- ============================================================

CREATE OR REPLACE FUNCTION confirm_chord_upload(
  p_upload_id uuid,
  p_title text,
  p_artist text,
  p_key text,
  p_bpm int,
  p_library_song_id uuid  -- null = create a new library song
) RETURNS jsonb AS $$
DECLARE
  v_upload chord_uploads%ROWTYPE;
  v_song_id uuid := p_library_song_id;
  v_version_id uuid;
  v_label text;
BEGIN
  IF NOT can_edit_content() THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

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
    -- attaching to an existing song must not fail silently on a bad id
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

REVOKE ALL ON FUNCTION confirm_chord_upload(uuid, text, text, text, int, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION confirm_chord_upload(uuid, text, text, text, int, uuid) TO authenticated, service_role;

-- ============================================================
-- 6. Approve a version: save content, derive sections, mark reviewed —
--    one transaction, no half-approved state.
--    p_sections: [{order_index, label, content}]
-- ============================================================

CREATE OR REPLACE FUNCTION approve_song_version(
  p_version_id uuid,
  p_content text,
  p_stored_key text,
  p_bpm int,
  p_sections jsonb
) RETURNS jsonb AS $$
DECLARE
  v_sec jsonb;
  v_count int := 0;
BEGIN
  IF NOT can_edit_content() THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  UPDATE song_versions SET
    content_chordpro = p_content,
    stored_key = nullif(btrim(coalesce(p_stored_key, '')), ''),
    bpm = p_bpm,
    reviewed_at = now()
  WHERE id = p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version not found'; END IF;

  DELETE FROM chord_sections WHERE song_version_id = p_version_id;

  FOR v_sec IN SELECT * FROM jsonb_array_elements(p_sections) LOOP
    INSERT INTO chord_sections (song_version_id, order_index, label, content_chordpro)
    VALUES (
      p_version_id,
      (v_sec->>'order_index')::int,
      v_sec->>'label',
      coalesce(v_sec->>'content', '')
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('version_id', p_version_id, 'sections', v_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION approve_song_version(uuid, text, text, int, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION approve_song_version(uuid, text, text, int, jsonb) TO authenticated, service_role;
