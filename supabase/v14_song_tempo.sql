-- V14: Song tempo memory
-- Run in Supabase SQL editor after v13_worship_leader.sql
--
-- Tempo lives on the LIBRARY song (the song's memory): set it once from
-- My Part and it shows for every service the song appears in, for everyone.
-- Editable by any member (v6 open-contribution model; library_songs UPDATE
-- is already open to authenticated users).

ALTER TABLE library_songs
  ADD COLUMN IF NOT EXISTS tempo_bpm int
  CHECK (tempo_bpm IS NULL OR (tempo_bpm BETWEEN 30 AND 300));

-- One-time backfill from the newest reviewed chord version that carried a BPM
UPDATE library_songs ls
SET tempo_bpm = sv.bpm
FROM (
  SELECT DISTINCT ON (library_song_id) library_song_id, bpm
  FROM song_versions
  WHERE reviewed_at IS NOT NULL AND bpm IS NOT NULL
  ORDER BY library_song_id, reviewed_at DESC
) sv
WHERE sv.library_song_id = ls.id
  AND ls.tempo_bpm IS NULL;
