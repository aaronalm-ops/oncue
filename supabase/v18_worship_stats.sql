-- V18: worship_stats — one round trip behind /stats.
--
-- Why an RPC rather than a page full of selects:
--   * profiles SELECT is own-row OR is_privileged(), so a worship_leader
--     cannot read another leader's display_name. The stats page needs names.
--   * The page is a weekly-planning screen; eight selects would make it the
--     slowest route in the app (see P1-P7 in HANDOFF).
--
-- Scoping, enforced server-side so the client can't widen it:
--   worship_leader  -> always their own numbers, p_leader is ignored
--   master / admin  -> p_leader = one leader, or NULL for every leader at once
--
-- `rotation` is deliberately NOT scoped to the caller. "When did the church
-- last sing this?" is a question about the repertoire, not about one leader,
-- and services/songs are already SELECT-open to every authenticated user, so
-- scoping it would hide nothing and answer the wrong question.

-- Both are unindexed FKs that every query below joins on.
CREATE INDEX IF NOT EXISTS idx_services_worship_leader ON services (worship_leader_id);
CREATE INDEX IF NOT EXISTS idx_song_links_library_song ON song_links (library_song_id);

CREATE OR REPLACE FUNCTION worship_stats(p_leader uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leader    uuid;
  v_scope_all boolean;
  v_result    jsonb;
BEGIN
  IF NOT can_edit_content() THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  IF is_privileged() THEN
    v_leader := p_leader;        -- NULL = every leader on one page
  ELSE
    v_leader := auth.uid();      -- a worship_leader only ever sees themselves
  END IF;
  v_scope_all := (v_leader IS NULL);

  WITH played AS (
    -- Every song that actually appeared on a chart, resolved to a library
    -- song. song_links is the reliable path; fall back to a normalised-title
    -- match for chart-ingested songs that were never linked (mirrors what
    -- _service_song_snapshots does).
    SELECT
      sv.service_date,
      sv.worship_leader_id                    AS leader_id,
      s.scale,
      COALESCE(sl.library_song_id, lt.id)     AS library_song_id,
      COALESCE(ls.title, lt.title, s.title)   AS title
    FROM songs s
    JOIN services sv           ON sv.id = s.service_id
    LEFT JOIN song_links sl    ON sl.song_id = s.id
    LEFT JOIN library_songs ls ON ls.id = sl.library_song_id
    LEFT JOIN LATERAL (
      SELECT l.id, l.title
      FROM library_songs l
      WHERE sl.library_song_id IS NULL
        AND l.norm_title = oncue_norm_title_full(s.title)
      ORDER BY l.created_at
      LIMIT 1
    ) lt ON true
    WHERE s.in_chart
  ),
  keyed AS (
    -- One stable key per song so the same song under two spellings collapses,
    -- and songs with no library match still aggregate by title.
    SELECT p.*,
           COALESCE(p.library_song_id::text, 'title:' || oncue_norm_title_full(p.title)) AS song_key
    FROM played p
  ),
  scoped AS (
    SELECT * FROM keyed
    WHERE v_scope_all OR leader_id = v_leader
  ),

  -- ---- per-leader -------------------------------------------------------
  leader_services AS (
    -- From services, not songs, so a leader with an empty setlist still shows.
    SELECT sv.worship_leader_id  AS leader_id,
           count(*)::int         AS setlist_count,
           min(sv.service_date)  AS first_service,
           max(sv.service_date)  AS last_service
    FROM services sv
    WHERE v_scope_all OR sv.worship_leader_id = v_leader
    GROUP BY sv.worship_leader_id
  ),
  leader_song_counts AS (
    SELECT leader_id,
           song_key,
           min(library_song_id::text)::uuid AS library_song_id,
           min(title)            AS title,
           count(*)::int         AS times,
           max(service_date)     AS last_played
    FROM scoped
    GROUP BY leader_id, song_key
  ),
  leader_distinct AS (
    SELECT leader_id, count(*)::int AS distinct_songs
    FROM leader_song_counts
    GROUP BY leader_id
  ),
  leader_top AS (
    SELECT leader_id,
           jsonb_agg(jsonb_build_object(
             'library_song_id', library_song_id,
             'title',           title,
             'times',           times,
             'last_played',     last_played,
             'weeks_since',     floor((current_date - last_played) / 7.0)::int
           ) ORDER BY times DESC, last_played DESC) AS top_songs
    FROM (
      SELECT c.*,
             row_number() OVER (PARTITION BY leader_id ORDER BY times DESC, last_played DESC) AS rn
      FROM leader_song_counts c
    ) ranked
    WHERE rn <= 12
    GROUP BY leader_id
  ),
  leader_keys AS (
    SELECT leader_id,
           jsonb_agg(jsonb_build_object('key', scale, 'songs', n)
                     ORDER BY n DESC, scale) AS keys
    FROM (
      SELECT leader_id, btrim(scale) AS scale, count(*)::int AS n
      FROM scoped
      WHERE scale IS NOT NULL AND btrim(scale) <> ''
      GROUP BY leader_id, btrim(scale)
    ) k
    GROUP BY leader_id
  ),

  -- ---- library-wide rotation (unscoped on purpose) ----------------------
  song_all AS (
    SELECT song_key,
           min(library_song_id::text)::uuid AS library_song_id,
           min(title)           AS title,
           count(*)::int        AS times,
           max(service_date)    AS last_played
    FROM keyed
    GROUP BY song_key
  ),
  never_played AS (
    -- Library rows nobody has put on a chart yet, including the stubs
    -- create_setlist auto-creates from a typed title.
    SELECT l.id::text AS song_key,
           l.id       AS library_song_id,
           l.title,
           0          AS times,
           NULL::date AS last_played
    FROM library_songs l
    WHERE NOT EXISTS (
      SELECT 1 FROM song_all a WHERE a.library_song_id = l.id
    )
  ),
  rotation AS (
    SELECT * FROM song_all
    UNION ALL
    SELECT * FROM never_played
  )

  SELECT jsonb_build_object(
    'scope',        CASE WHEN v_scope_all THEN 'all' ELSE 'self' END,
    'generated_at', now(),
    'leaders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'leader_id',      lsv.leader_id,
               'display_name',   p.display_name,
               'setlist_count',  lsv.setlist_count,
               'first_service',  lsv.first_service,
               'last_service',   lsv.last_service,
               'distinct_songs', COALESCE(ld.distinct_songs, 0),
               'top_songs',      COALESCE(lt.top_songs, '[]'::jsonb),
               'keys',           COALESCE(lk.keys, '[]'::jsonb)
             ) ORDER BY lsv.setlist_count DESC, p.display_name NULLS LAST)
      FROM leader_services lsv
      LEFT JOIN profiles        p  ON p.id = lsv.leader_id
      LEFT JOIN leader_top      lt ON lt.leader_id IS NOT DISTINCT FROM lsv.leader_id
      LEFT JOIN leader_keys     lk ON lk.leader_id IS NOT DISTINCT FROM lsv.leader_id
      LEFT JOIN leader_distinct ld ON ld.leader_id IS NOT DISTINCT FROM lsv.leader_id
    ), '[]'::jsonb),
    'rotation', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'library_song_id', library_song_id,
               'title',           title,
               'times',           times,
               'last_played',     last_played,
               'weeks_since',     CASE WHEN last_played IS NULL THEN NULL
                                       ELSE floor((current_date - last_played) / 7.0)::int END
             ) ORDER BY last_played ASC NULLS LAST, title)
      FROM rotation
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION worship_stats(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION worship_stats(uuid) TO authenticated, service_role;
