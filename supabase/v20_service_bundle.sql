-- V20: Performance — one round trip per service page.
-- Run AFTER v19_song_notes.sql. Safe to re-run (CREATE OR REPLACE).
--
-- WHY: the service hub, Stage View and Live each made 4–5 SEQUENTIAL trips
-- from the Vercel function to Postgres before the first byte reached the
-- phone (auth → service+songs → notes/links/library → versions → prefs/maps).
-- Region-matching Vercel to Supabase shrank each hop, but a hop is still a
-- hop. service_bundle() returns everything those pages need as ONE jsonb, so
-- a page is now: one RPC, render. The TypeScript resolver
-- (src/lib/chords/service-chords.ts) is unchanged — it just gets its rows
-- from the bundle instead of from four queries.
--
-- SECURITY: SECURITY INVOKER (the default) on purpose. Every sub-select runs
-- as the calling user, so RLS still decides what they see: members only get
-- reviewed song_versions, user_notes are their own rows, profiles is their
-- own row. Nothing here widens access — it only batches it.
--
-- p_light = true is the hub: no chord bodies, no prefs, no maps (badges only).

CREATE OR REPLACE FUNCTION service_bundle(p_service_id uuid, p_light boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN sv.id IS NULL THEN NULL ELSE jsonb_build_object(
    'service', jsonb_build_object(
      'id', sv.id,
      'service_date', sv.service_date,
      'day_of_week', sv.day_of_week,
      'instruments', to_jsonb(sv.instruments),
      'worship_leader_id', sv.worship_leader_id,
      'source_filename', sv.source_filename
    ),

    -- The caller's own profile row (RLS: own-row-or-privileged). Riding along
    -- here is what lets Stage View drop its separate profiles query.
    'profile', (
      SELECT jsonb_build_object(
        'role', p.role, 'instrument', p.instrument, 'preferred_key', p.preferred_key
      )
      FROM profiles p WHERE p.id = auth.uid()
    ),

    -- Leader badge + picker options (public directory view — no role column).
    'leader', (
      SELECT jsonb_build_object('display_name', pp.display_name, 'instrument', pp.instrument, 'teams', to_jsonb(pp.teams))
      FROM public_profiles pp WHERE pp.id = sv.worship_leader_id
    ),
    'leader_options', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object('id', pp.id, 'display_name', pp.display_name, 'teams', to_jsonb(pp.teams))
        ORDER BY pp.display_name
      ), '[]'::jsonb)
      FROM public_profiles pp
    ),

    -- ALL songs, chart-dropped ones included (in_chart=false) — the hub still
    -- lists those; Stage View / Live filter them out in TypeScript as before.
    'songs', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'order_index', s.order_index,
        'title', s.title,
        'scale', s.scale,
        'medley_group', s.medley_group,
        'reference_links', to_jsonb(s.reference_links),
        'in_chart', s.in_chart,
        'sections', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', sec.id,
            'order_index', sec.order_index,
            'label', sec.label,
            'comments', sec.comments,
            'key_change', sec.key_change,
            'instructions', (
              SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', i.id, 'instrument', i.instrument, 'text', i.text, 'is_intro', i.is_intro
              )), '[]'::jsonb)
              FROM instructions i WHERE i.section_id = sec.id
            )
          ) ORDER BY sec.order_index), '[]'::jsonb)
          FROM sections sec WHERE sec.song_id = s.id
        )
      ) ORDER BY s.order_index), '[]'::jsonb)
      FROM songs s WHERE s.service_id = p_service_id
    ),

    'session_state', (
      SELECT to_jsonb(ss) FROM session_state ss WHERE ss.service_id = p_service_id LIMIT 1
    ),

    -- Live only: the impromptu song being shared right now (v7), resolved to
    -- its newest reviewed sheet. That song is usually NOT in the setlist, so
    -- it can't ride on the chord resolution below. NULL when nothing is shared.
    'impromptu', CASE WHEN p_light THEN NULL ELSE (
      SELECT jsonb_build_object(
        'library_song_id', ls.id, 'title', ls.title,
        'stored_key', v.stored_key, 'body', v.content_chordpro
      )
      FROM session_state ss
      JOIN library_songs ls ON ls.id = ss.impromptu_library_song_id
      LEFT JOIN LATERAL (
        SELECT sv2.stored_key, sv2.content_chordpro FROM song_versions sv2
        WHERE sv2.library_song_id = ls.id AND sv2.reviewed_at IS NOT NULL
        ORDER BY sv2.reviewed_at DESC LIMIT 1
      ) v ON true
      WHERE ss.service_id = p_service_id
      LIMIT 1
    ) END,

    -- The caller's notes on this service: section-level and (v19) song-level.
    'notes', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', un.id, 'section_id', un.section_id, 'song_id', un.song_id,
        'instrument', un.instrument, 'note_text', un.note_text
      )), '[]'::jsonb)
      FROM user_notes un
      WHERE un.user_id = auth.uid()
        AND (
          un.song_id IN (SELECT s.id FROM songs s WHERE s.service_id = p_service_id)
          OR un.section_id IN (
            SELECT sec.id FROM sections sec JOIN songs s ON s.id = sec.song_id WHERE s.service_id = p_service_id
          )
        )
    ),

    -- Chord resolution inputs — same rows fetchServiceChords used to fetch in
    -- three sequential stages. Library songs: title match (v17 norm_title,
    -- indexed) OR confirmed link (renamed songs). created_at order so a
    -- duplicate title resolves to the same row ingest picks (oldest).
    'links', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('song_id', sl.song_id, 'library_song_id', sl.library_song_id)), '[]'::jsonb)
      FROM song_links sl
      WHERE sl.song_id IN (SELECT s.id FROM songs s WHERE s.service_id = p_service_id)
    ),
    'library_songs', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', ls.id, 'title', ls.title, 'tempo_bpm', ls.tempo_bpm) ORDER BY ls.created_at), '[]'::jsonb)
      FROM library_songs ls
      WHERE ls.norm_title IN (SELECT oncue_norm_title_full(s.title) FROM songs s WHERE s.service_id = p_service_id)
         OR ls.id IN (
           SELECT sl.library_song_id FROM song_links sl
           JOIN songs s ON s.id = sl.song_id WHERE s.service_id = p_service_id
         )
    ),
    'versions', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'library_song_id', v.library_song_id,
        'stored_key', v.stored_key,
        'content_chordpro', CASE WHEN p_light THEN NULL ELSE v.content_chordpro END,
        'reviewed_at', v.reviewed_at
      ) ORDER BY v.reviewed_at DESC), '[]'::jsonb)
      FROM song_versions v
      WHERE v.reviewed_at IS NOT NULL
        AND v.content_chordpro IS NOT NULL
        AND v.library_song_id IN (
          SELECT ls.id FROM library_songs ls
          WHERE ls.norm_title IN (SELECT oncue_norm_title_full(s.title) FROM songs s WHERE s.service_id = p_service_id)
             OR ls.id IN (
               SELECT sl.library_song_id FROM song_links sl
               JOIN songs s ON s.id = sl.song_id WHERE s.service_id = p_service_id
             )
        )
    ),
    'prefs', CASE WHEN p_light THEN '[]'::jsonb ELSE (
      SELECT coalesce(jsonb_agg(jsonb_build_object('library_song_id', usp.library_song_id, 'preferred_key', usp.preferred_key)), '[]'::jsonb)
      FROM user_scale_preferences usp
      WHERE usp.user_id = auth.uid()
        AND usp.library_song_id IN (
          SELECT ls.id FROM library_songs ls
          WHERE ls.norm_title IN (SELECT oncue_norm_title_full(s.title) FROM songs s WHERE s.service_id = p_service_id)
             OR ls.id IN (
               SELECT sl.library_song_id FROM song_links sl
               JOIN songs s ON s.id = sl.song_id WHERE s.service_id = p_service_id
             )
        )
    ) END,
    'maps', CASE WHEN p_light THEN '[]'::jsonb ELSE (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'library_song_id', m.library_song_id,
        'chart_label_normalized', m.chart_label_normalized,
        'chord_section_label', m.chord_section_label
      )), '[]'::jsonb)
      FROM chord_section_maps m
      WHERE m.library_song_id IN (
          SELECT ls.id FROM library_songs ls
          WHERE ls.norm_title IN (SELECT oncue_norm_title_full(s.title) FROM songs s WHERE s.service_id = p_service_id)
             OR ls.id IN (
               SELECT sl.library_song_id FROM song_links sl
               JOIN songs s ON s.id = sl.song_id WHERE s.service_id = p_service_id
             )
        )
    ) END
  ) END
  FROM (SELECT NULL::uuid AS _anchor) a
  LEFT JOIN services sv ON sv.id = p_service_id;
$$;

REVOKE ALL ON FUNCTION service_bundle(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION service_bundle(uuid, boolean) TO authenticated, service_role;
