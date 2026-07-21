-- V12: search_library — normalize whitespace on BOTH the query and the lyric
-- text so a multi-word phrase matches even when the words span a line break or
-- sit either side of a chord (e.g. "blessing and honour"). Supersedes the v10
-- definition. CREATE OR REPLACE — safe to run on its own, after v10.

CREATE OR REPLACE FUNCTION search_library(p_query text)
RETURNS TABLE (id uuid, title text, artist text, has_chords boolean, snippet text) AS $$
  WITH q AS (
    -- collapse all whitespace runs to single spaces so the query matches the
    -- normalized lyric text below
    SELECT regexp_replace(btrim(lower(coalesce(p_query, ''))), '\s+', ' ', 'g') AS term
  )
  SELECT
    ls.id,
    ls.title,
    ls.artist,
    EXISTS (
      SELECT 1 FROM song_versions v
      WHERE v.library_song_id = ls.id AND v.reviewed_at IS NOT NULL
    ) AS has_chords,
    (
      SELECT left(btrim(regexp_replace(
               regexp_replace(coalesce(v.content_chordpro, ''), '\[[^\]]*\]', '', 'g'),
               '\s+', ' ', 'g')), 160)
      FROM song_versions v
      WHERE v.library_song_id = ls.id AND v.reviewed_at IS NOT NULL
      ORDER BY v.reviewed_at DESC LIMIT 1
    ) AS snippet
  FROM library_songs ls, q
  WHERE q.term = ''
     OR regexp_replace(lower(ls.title), '\s+', ' ', 'g') LIKE '%' || q.term || '%'
     OR EXISTS (
       SELECT 1 FROM song_versions v
       WHERE v.library_song_id = ls.id AND v.reviewed_at IS NOT NULL
         AND regexp_replace(
               lower(regexp_replace(coalesce(v.content_chordpro, ''), '\[[^\]]*\]', '', 'g')),
               '\s+', ' ', 'g'
             ) LIKE '%' || q.term || '%'
     )
  ORDER BY (regexp_replace(lower(ls.title), '\s+', ' ', 'g') LIKE '%' || q.term || '%') DESC, ls.title
  LIMIT 25;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION search_library(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION search_library(text) TO authenticated, service_role;
