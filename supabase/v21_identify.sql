-- V21: "Which song is this?" — identify an impromptu song from a few sung
-- words (speech-to-text on the phone → this RPC). Run AFTER v20.
-- Safe to re-run.
--
-- HOW IT MATCHES: pg_trgm word_similarity(needle, haystack) scores how well
-- the needle matches the BEST word-bounded substring of the haystack. So a
-- 10-word transcript with a couple of STT mistakes still scores high against
-- the one song whose lyrics contain that line, and near zero against the
-- rest. Titles are matched the other way round (title inside the transcript)
-- so "let's sing Egypt" works when the leader just announces the song.
--
-- lyrics_norm is a STORED generated column: chords, directives and section
-- headers stripped, lower-cased, punctuation gone — computed once on write,
-- indexed with GIN trigrams, never at query time.
--
-- SECURITY INVOKER: members only match against reviewed versions because
-- that's all RLS lets them read. Nothing new is exposed.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ChordPro → bare lyric text. Order matters: chords, then {directives}, then
-- whole "# Section" / "Key of X" lines, then punctuation, then whitespace.
CREATE OR REPLACE FUNCTION oncue_lyrics_norm(chordpro text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(oncue_norm_title_full(              -- same normaliser as the query side (v17)
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(chordpro, ''), '\[[^\]]*\]', '', 'g'),   -- [G] chords
          '\{[^}]*\}', '', 'g'),                                            -- {title: …}
        '(^|\n)[ \t]*(#[^\n]*|key of [^\n]*)', E'\\1', 'gi'),               -- "# Chorus", "Key of G" lines
      '[\n\r\t]+', ' ', 'g')                                                -- line breaks → spaces
  ), '')
$$;

ALTER TABLE song_versions
  ADD COLUMN IF NOT EXISTS lyrics_norm text
  GENERATED ALWAYS AS (oncue_lyrics_norm(content_chordpro)) STORED;

CREATE INDEX IF NOT EXISTS idx_song_versions_lyrics_trgm
  ON song_versions USING gin (lyrics_norm gin_trgm_ops);

-- p_text: whatever the phone heard (last ~10 words works best; the client
-- keeps the best score it has seen per song across calls).
CREATE OR REPLACE FUNCTION identify_song(p_text text, p_limit int DEFAULT 6)
RETURNS TABLE (
  library_song_id uuid,
  title text,
  artist text,
  stored_key text,
  score real,
  matched_via text
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH q AS (
    SELECT oncue_norm_title_full(p_text) AS text
  ),
  lyric_hits AS (
    SELECT v.library_song_id,
           max(word_similarity(q.text, v.lyrics_norm)) AS s,
           -- key of the best-scoring reviewed sheet, so the confirm step can
           -- default to "the key we have chords in" when nothing was detected
           (array_agg(v.stored_key ORDER BY word_similarity(q.text, v.lyrics_norm) DESC, v.reviewed_at DESC NULLS LAST))[1] AS k
    FROM song_versions v, q
    WHERE q.text <> '' AND v.lyrics_norm IS NOT NULL AND length(v.lyrics_norm) >= 12
    GROUP BY v.library_song_id
  ),
  title_hits AS (
    SELECT ls.id AS library_song_id,
           greatest(
             word_similarity(ls.norm_title, q.text),   -- title said inside the transcript
             similarity(ls.norm_title, q.text)         -- transcript IS (roughly) the title
           ) AS s
    FROM library_songs ls, q
    WHERE q.text <> '' AND ls.norm_title <> ''
  )
  SELECT ls.id, ls.title, ls.artist,
         coalesce(lh.k, (
           SELECT v2.stored_key FROM song_versions v2
           WHERE v2.library_song_id = ls.id AND v2.reviewed_at IS NOT NULL
           ORDER BY v2.reviewed_at DESC LIMIT 1
         )) AS stored_key,
         greatest(coalesce(lh.s, 0), coalesce(th.s, 0))::real AS score,
         CASE WHEN coalesce(lh.s, 0) >= coalesce(th.s, 0) THEN 'lyrics' ELSE 'title' END AS matched_via
  FROM library_songs ls
  LEFT JOIN lyric_hits lh ON lh.library_song_id = ls.id
  LEFT JOIN title_hits th ON th.library_song_id = ls.id
  WHERE greatest(coalesce(lh.s, 0), coalesce(th.s, 0)) >= 0.3
  ORDER BY score DESC, ls.title
  LIMIT greatest(1, least(p_limit, 20));
$$;

REVOKE ALL ON FUNCTION identify_song(text, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION identify_song(text, int) TO authenticated, service_role;
