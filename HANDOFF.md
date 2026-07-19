# OnCue — Session Handoff Log
_Last updated: 19 July 2026. Read this first in any new AI session. Companion docs: `WORSHIP_APP_SPEC.md` (v1 chart app), `CHORDS_SPEC.md` (chords system + setlist-first flow)._

## What this is
PWA for the DCC worship team (Dubai, services Thursday + Saturday, timezone **Asia/Dubai** — hardcoded in `page.tsx`, `services/page.tsx`, `library/[id]/page.tsx`). Next.js 16 App Router + Supabase (Postgres/Auth/Realtime/Storage) on Vercel, repo `aaronalm-ops/oncue`. Issac (master role) admins it.

## Current state — all DEPLOYED and WORKING
- **Chart pipeline (v1):** conductor uploads `DAY DD-MM-YYYY CHART.xlsx` → `ingest_chart` RPC (atomic, MERGE semantics). Filename = date. Orange fill `FFFF9900` = intro flag. Parser: `src/lib/parser.ts`, fixtures `Charts Log/`, test `npm run test:parser`.
- **Live Sync** (`services/[id]/live`): shared position via `session_state` realtime, anyone drives, reconnect catch-up refetches on SUBSCRIBED + window online. `updated_by` written on every move.
- **My Part** (`services/[id]/my-part`): per-instrument view, personal notes, "Go Live" song-level driving, arrow-key/pedal nav.
- **Chords system (v2–v6):** bulk PDF upload → **extraction runs in the BROWSER** (`extract-client.ts`; serverless fonts drop text — never parse PDFs server-side) → positioned lines POSTed → pure parser (`src/lib/chords/parse.ts`) → confirm queue (`ChordUploadQueue`) → per-song review editor (`/library/[id]/version/[vid]`) → approve publishes. Internal format: `# Section`, `> Flow x2`, `[G]` inline (`src/lib/chords/format.ts`). Fixtures `chord-samples/` (6 real PDFs; Revelation_Song is a scan → paste-mode), test `npm run test:chords` (includes lossless-render invariant + transpose + reorder + section-map tests).
- **Combined view:** Chart ⟷ Chords panes — swipe w/ wrap-around on phones (pill switcher), side-by-side ≥lg. Live Sync chords follow current section (`ChordsPane`, index-aligned via `mapChartSectionsToChords`). Transpose strip everywhere, per-user key saved in `user_scale_preferences`.
- **Section maps (v5):** manual chart-label → sheet-section overrides, per library song, `chord_section_maps`, set inline in ChordsPane.
- **Setlist-first (v5):** `/services/new` creates a service pre-chart (date + `worship_leader_id` + library songs, links created). Chart upload MERGES by normalized title: song ids/links/notes survive, chart order wins, dropped songs flagged `in_chart=false` (badge on service page, excluded from live views).
- **Open contributions (v6):** ALL members can upload/confirm/edit/approve/rename chords + set maps. Editor-only: chart upload, member admin, service delete, library bulk-delete. Approve = quality gate.
- **Impromptu live share (v7):** library song page → "Share live to today's service" sets `session_state.impromptu_library_song_id`; overlays every Live screen; anyone ends it. Note: uses `.update()` — silent no-op if session_state row missing (QA item #9).
- **PWA:** Samsung Internet blocked by Play Protect (industry-wide) → app detects and routes install to Chrome (`RegisterSW.tsx`).

## Database migrations (`supabase/`, run in order, ALL applied through v7)
`schema.sql` → `add_roles` → `add_worship_leader` → `v2_chords_library` → `v3_security_and_ingest` (role-escalation trigger, content RLS, atomic ingest, storage policies) → `v4_chords_phase1` (chord_uploads queue, approve/confirm RPCs) → `v5_setlist_flow` (worship_leader_id, in_chart, chord_section_maps, merge ingest, create_setlist) → `v6_open_chords` → `v7_impromptu`.
**Rule learned the hard way:** run SQL BEFORE deploying code that needs it; service pages now degrade gracefully if `in_chart` is missing, but keep the habit.

## Env vars (Vercel)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (member deletion + admin emails), `CRON_SECRET` (keepalive cron in `vercel.json`). Buckets: `charts`, `chord-pdfs` (both private).

## Intentional decisions — do NOT "fix"
Viewing another instrument persists as your default (multi-instrumentalists). Anyone drives Live Sync, last-write-wins. Chords fully open to members (v6). Chart tables stay editor-protected. `CHORDS_OPEN_TO_ALL=true` in `src/lib/chords/access.ts`. Chart order always wins on merge. No AI anywhere in the parse/live path — deterministic + human review only.

## QA BACKLOG (full audit 19 Jul 2026, three-agent pass) — NEXT PRIORITY: data-integrity #5–13
### Stage-critical — ✅ ALL FIXED 19 Jul 2026 (client-only, no SQL; `tsc` + both test suites green)
1. ✅ **My Part "Go Live" never broadcast + instrument saves never fired** — lazy Supabase builders now call `.then()` so they actually execute: `goToSong()` session_state upsert (now also writes `updated_at`) + `handleInstrumentChange` in both `MyPartClient` and `LiveSyncClient`. All fire-and-forget writes log errors on failure.
2. ✅ **Unclamped sync indexes after chart shrink** — both clients clamp on receipt (realtime + refetch). `LiveSyncClient` derives `safeSongIdx`/`safeSectionIdx` for strip/flat-list/next math and `nextFlat` now guards `currentFlatIdx >= 0` (killed the "jump to song 0"). `MyPartClient` `activeSong` guarded `?? songs[0]`.
3. ✅ **ChordsPane follow-scroll hijacked horizontal swipe** — replaced `scrollIntoView` with manual `scrollTop` on the nearest `.overflow-y-auto` pane only, so the chart⟷chords snap container no longer gets panned.
4. ✅ **Realtime resubscribe flaws** — both clients: single retry timer (guarded, no channel stacking), superseded-channel callbacks ignored via an `active` flag, `CLOSED` now retries. `MyPartClient` go-live channel gained a `.subscribe(status)` callback + a real `liveStatus` badge (LIVE/SYNC/OFFLINE) instead of a badge that always claimed LIVE.
### Data integrity (next) — START HERE
5. `confirm_chord_upload` double-click races → duplicate songs/versions (no advisory lock; UI disables but route doesn't). Add `pg_advisory_xact_lock(hashtext(p_upload_id::text))` + re-check.
6. Note restoration uses EXACT title match in `_note_snapshot` join — a title corrected by re-upload orphans notes the merge otherwise preserves (merge matches normalized, notes match exact). Normalize the snapshot join too (v8 SQL).
7. Ghost `in_chart=false` songs accumulate on title corrections (old title never re-claimed). Consider: delete unclaimed songs with no user_notes AND no song_links, flag otherwise.
8. **Transpose corrupts non-chord bracket annotations** — `transposeBody` regex hits `[Build]`→`[Cuild]` etc. Fix: inside `transposeBody`, skip tokens failing `isChordToken`.
9. "Share live" is `.update()` on session_state — no-op if row absent (pre-v5 services). Use upsert with indexes defaulted 0.
10. Three chord-resolution paths disagree (service page vs `fetchServiceChords` vs `/services/[id]/chords/[songId]`): linked-but-unreviewed handling + title-match fallback differ → page may advertise chords the pane won't show. Extract ONE shared resolver in `service-chords.ts`, use everywhere.
11. `approve_song_version` trusts client `p_sections` (server derives them in route — but a direct RPC call can inject mismatched sections; `chord_sections` currently write-only/dead). Either derive sections in SQL from `p_content` or drop `chord_sections` entirely (viewer re-parses body anyway).
12. Version picking = latest reviewed by date, arrangement-blind (multi-key/version songs pick wrong one). Later: match version whose `stored_key` = chart scale.
13. Minor: PDF orphaned on single-version delete (bulk delete cleans up; single doesn't); `services/[id]/songs` PUT update not scoped `.eq('service_id')`; keepalive fail-open when `CRON_SECRET` unset (`Bearer undefined`); several buttons stick busy on network reject (no try/finally); `handle_new_user()` lacks pinned search_path; upload route has no file-size cap (chord route caps 15MB).
### Clean (audited, no action)
RLS cumulative state all tables/buckets; IDOR (notes/prefs `WITH CHECK` correct); role escalation blocked by trigger; jsonb RPCs injection-safe; XSS (React escaping); admin routes gated before service-role use.

## ROADMAP (agreed direction, by persona)
1. **Hardening pass** = QA items 1–10. Stage-critical 1–4 DONE (19 Jul, client-only). Remaining: data-integrity 5–10 (client fixes + one v8 SQL migration — items 6 & 9 need SQL).
2. **Sound-team Console view** (Issac's ask): landscape FOH view riding Live Sync — current section huge; per-instrument prominence derived from chart cells (non-SILENT = active, intro flag = lead-in) with silent instruments dimmed; next section preview for pre-fade; key/BPM; worship leader name. Optional precision: per-section "lead" marker settable in Edit Setlist (small col on `sections` or JSON on service). Route suggestion: `/services/[id]/console`.
3. **Projection/lyrics view** (cheap, high value): chord bodies already contain lyrics — strip chords, render huge on black, follow live section. `/services/[id]/lyrics`.
4. **Worship director analytics:** song rotation frequency, key history per leader, planning calendar, CCLI usage report (ccli_number already captured).
5. **Musicians:** true offline bundle of active service (last unmet v1 spec promise — localStorage/IndexedDB snapshot + hydrate on fetch fail); per-user chord annotations; document pedal support (arrow keys already work in My Part live mode).
6. **Platform later:** provenance columns (uploaded_by/approved_by on versions — matters now contributions are open), multi-team tenancy (team_id + invites), audit trail.

## Working conventions for this repo
- Tests: `npm run test:parser` and `npm run test:chords` — run BOTH before any push touching parsing/format/merge. Fixtures are sacred; new bug = new fixture first.
- Every broken real-world file (chart or PDF) gets added to `Charts Log/` or `chord-samples/` with expectations in the test scripts.
- Verify with `npx tsc --noEmit` before handing anything to Issac.
- Deploy = run new SQL in Supabase editor FIRST, then `git add -A && git commit && git push` (Vercel auto-deploys). Issac runs these himself — always give him the exact commands.
- Two stray duplicate PDFs in `chord-samples/` (`-2f2f2258`, `-446248bb` suffixes) are junk; deletable.
- Keep answers concise; Issac prefers direct, step-by-step instructions for anything operational.
