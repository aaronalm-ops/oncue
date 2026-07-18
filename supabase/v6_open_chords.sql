-- V6: Open chord contributions to ALL members
-- Run in Supabase SQL editor after v5_setlist_flow.sql
--
-- Anyone logged in can now upload chord PDFs, edit/correct sheets, approve
-- versions, link songs, and set section maps. The approve step remains the
-- quality gate. Destructive bulk operations (deleting library songs) stay
-- editor-only. The conductor's chart data (services/songs/sections/
-- instructions) keeps its existing protections — this opens CHORDS only.

-- library_songs: contribute open, delete protected
DROP POLICY IF EXISTS "Editors can manage library_songs" ON library_songs;
CREATE POLICY "Authenticated can insert library_songs" ON library_songs
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update library_songs" ON library_songs
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Editors can delete library_songs" ON library_songs
  FOR DELETE TO authenticated USING (can_edit_content());

-- song_versions: fully open (members must see unreviewed versions to review them)
DROP POLICY IF EXISTS "Editors can manage song_versions" ON song_versions;
DROP POLICY IF EXISTS "Authenticated users can view reviewed versions" ON song_versions;
CREATE POLICY "Authenticated can view song_versions" ON song_versions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage song_versions" ON song_versions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Editors can manage chord_sections" ON chord_sections;
CREATE POLICY "Authenticated can manage chord_sections" ON chord_sections
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Editors can manage song_links" ON song_links;
CREATE POLICY "Authenticated can manage song_links" ON song_links
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Editors can manage chord_uploads" ON chord_uploads;
CREATE POLICY "Authenticated can manage chord_uploads" ON chord_uploads
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Editors can manage section maps" ON chord_section_maps;
CREATE POLICY "Authenticated can manage section maps" ON chord_section_maps
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- chord-pdfs storage: contribute open
DROP POLICY IF EXISTS "Editors can upload chord pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Editors can update chord pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Editors can delete chord pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Editors can read chord pdfs" ON storage.objects;
CREATE POLICY "Authenticated can upload chord pdfs" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'chord-pdfs');
CREATE POLICY "Authenticated can update chord pdfs" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'chord-pdfs');
CREATE POLICY "Authenticated can delete chord pdfs" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'chord-pdfs');
CREATE POLICY "Authenticated can read chord pdfs" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'chord-pdfs');

-- RPC gates: confirm_chord_upload requires can_edit_content() — relax to any
-- authenticated user (the function still validates everything else)
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

-- approve_song_version: same relaxation — approving is the conscious quality
-- gate, and any member may take that responsibility
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
