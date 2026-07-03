-- V2: Chords Library
-- Run in Supabase SQL editor after add_worship_leader.sql

-- Canonical song entries (title + artist, not tied to any service)
CREATE TABLE library_songs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  artist text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE library_songs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view library_songs" ON library_songs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Privileged users can manage library_songs" ON library_songs
  FOR ALL TO authenticated USING (is_privileged()) WITH CHECK (is_privileged());

-- Song versions: one per arrangement/key (holds the ChordPro content)
CREATE TABLE song_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library_song_id uuid NOT NULL REFERENCES library_songs ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Default',
  stored_key text,            -- e.g. "C", "G#", "Am"
  bpm int,
  content_chordpro text,      -- raw ChordPro source
  source_pdf_path text,       -- Supabase Storage path to original PDF
  reviewed_at timestamptz,    -- null = unreviewed, set when admin approves
  created_at timestamptz DEFAULT now()
);
ALTER TABLE song_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view reviewed versions" ON song_versions
  FOR SELECT TO authenticated USING (reviewed_at IS NOT NULL OR is_privileged());
CREATE POLICY "Privileged users can manage song_versions" ON song_versions
  FOR ALL TO authenticated USING (is_privileged()) WITH CHECK (is_privileged());

-- Parsed chord sections derived from ChordPro (rebuilt on each parse/edit)
CREATE TABLE chord_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_version_id uuid NOT NULL REFERENCES song_versions ON DELETE CASCADE,
  order_index int NOT NULL,
  label text NOT NULL,        -- "Verse 1", "Chorus", etc.
  content_chordpro text NOT NULL
);
ALTER TABLE chord_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view chord_sections" ON chord_sections
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Privileged users can manage chord_sections" ON chord_sections
  FOR ALL TO authenticated USING (is_privileged()) WITH CHECK (is_privileged());

-- Maps a service song to a library song (one-to-one per service song)
CREATE TABLE song_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library_song_id uuid NOT NULL REFERENCES library_songs ON DELETE CASCADE,
  song_id uuid NOT NULL REFERENCES songs ON DELETE CASCADE,
  confirmed_at timestamptz DEFAULT now(),
  UNIQUE (song_id)            -- each service song links to at most one library song
);
ALTER TABLE song_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view song_links" ON song_links
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Privileged users can manage song_links" ON song_links
  FOR ALL TO authenticated USING (is_privileged()) WITH CHECK (is_privileged());

-- Per-user key transposition preference (overrides the setlist key)
CREATE TABLE user_scale_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  library_song_id uuid NOT NULL REFERENCES library_songs ON DELETE CASCADE,
  preferred_key text NOT NULL,
  UNIQUE (user_id, library_song_id)
);
ALTER TABLE user_scale_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own scale preferences" ON user_scale_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Storage bucket for chord PDFs (create this in Supabase Storage UI if not exists)
-- Bucket name: chord-pdfs  (private, authenticated access only)
