-- V17: Performance — indexed title lookup + core indexes.
-- Run AFTER v16_key_change.sql. Safe to re-run (everything IF NOT EXISTS).
--
-- 1) library_songs.norm_title: a stored generated column that EXACTLY matches
--    the client normaliser (lowercase, strip punctuation, collapse whitespace,
--    trim) so the chords resolver can filter with .in() instead of scanning
--    the whole library on every page render.
--    NOTE: oncue_norm_title (v8) is left untouched — ingest matching depends
--    on it; this new function exists only for the column + lookups.
--
-- 2) The index set from the perf audit — every hot foreign key + the
--    service-date lookup + newest-reviewed-version ordering.

CREATE OR REPLACE FUNCTION oncue_norm_title_full(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(
    lower(regexp_replace(coalesce(t, ''), '[^a-zA-Z0-9 ]', '', 'g')),
    '\s+', ' ', 'g'
  ))
$$;

ALTER TABLE library_songs
  ADD COLUMN IF NOT EXISTS norm_title text
  GENERATED ALWAYS AS (oncue_norm_title_full(title)) STORED;

CREATE INDEX IF NOT EXISTS idx_library_songs_norm_title ON library_songs (norm_title);

CREATE INDEX IF NOT EXISTS idx_songs_service_id        ON songs (service_id);
CREATE INDEX IF NOT EXISTS idx_sections_song_id        ON sections (song_id);
CREATE INDEX IF NOT EXISTS idx_instructions_section_id ON instructions (section_id);
CREATE INDEX IF NOT EXISTS idx_song_versions_lib_reviewed
  ON song_versions (library_song_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_services_service_date   ON services (service_date);
CREATE INDEX IF NOT EXISTS idx_user_notes_user_section ON user_notes (user_id, section_id);
