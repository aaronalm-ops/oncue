-- V7: Impromptu live share
-- Run in Supabase SQL editor after v6_open_chords.sql
--
-- A spontaneous song from the chord library can be pushed onto everyone's
-- Live Sync screens for today's service. It rides the existing session_state
-- realtime row: setting impromptu_library_song_id overlays the song's chords
-- on every device; clearing it returns everyone to the chart position.
-- Any member can start or end it (same last-write-wins ethos as Live Sync).

ALTER TABLE session_state
  ADD COLUMN IF NOT EXISTS impromptu_library_song_id uuid REFERENCES library_songs ON DELETE SET NULL;
ALTER TABLE session_state
  ADD COLUMN IF NOT EXISTS impromptu_key text;
