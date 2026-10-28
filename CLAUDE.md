# OnCue — project context for Claude (read this first)

Identity correction, 22 October 2026: Aaron Almeida confirmed ownership and corrected earlier account-based misattribution. Contact/account addresses in these notes were corrected at his request. This documentation change does not establish a live account transfer or a new deployment.

Last updated: 13 Oct 2026. `HANDOFF.md` in this folder is the long-form engineering log (every migration, every QA pass). This file is the short version: who, what, how we work, where things stand, what's next.

## Who / what
- **Owner:** Aaron (GitHub `aaronalm-ops`, email aaron.almj@gmail.com). Role in app: `master`. Windows PC, local folder `C:\Users\a4ron\Projects\OnCue`. Dubai timezone (`Asia/Dubai` is hard-coded for "today").
- **OnCue** is a worship-team PWA: conductor uploads an Excel chart → per-instrument instructions per song section → Stage View (own part + chords), Live (everyone follows the same section), chord library with transposition, impromptu "go live" with any library song, stats, and "Listen" (identify a song by ear + detect its key).
- **Production:** https://oncue-dcc.vercel.app · repo `aaronalm-ops/oncue` (public) · Vercel (region hnd1 Tokyo, Fluid Compute on) · Supabase (ap-northeast-1 Tokyo, **Free tier — Pro declined**, keepalive cron at `/api/keepalive`), asymmetric JWT keys (ECC P-256) already on.
- **Env vars on Vercel:** Supabase URL/anon key, `NVIDIA_API_KEY` (hosted Whisper for Listen; created 18 Sep 2026, expires ~18 Sep 2027 — a scheduled reminder is set for 4 Sep 2027). Optional fallbacks: `GROQ_API_KEY`, `OPENAI_API_KEY`.

## Stack
Next.js 16 App Router (`proxy.ts` = middleware), React, Tailwind, Supabase (Postgres + RLS + SECURITY DEFINER RPCs + Realtime), zustand present. Fully dynamic SSR. `getAuthUser()` in `src/lib/supabase/server.ts` = local JWT check via `getClaims()`.

Key code map:
- `src/lib/service-bundle.ts` — ONE RPC (`service_bundle`, v20) feeds hub / Stage View / Live. Falls back to legacy multi-query path if the RPC is missing.
- `src/lib/chords/format.ts` — chord grammar, transposition, section derivation, key changes (`effectiveSectionKeys`), chart↔chords mapping. `service-chords.ts` — `resolveServiceChords()` pure resolver.
- `src/lib/parser.ts` — Excel chart parser incl. key-change markers (`extractKeyChange`).
- `src/app/identify/*` + `src/app/api/identify/transcribe/route.ts` + `src/lib/riva/asr.ts` (NVIDIA Riva gRPC, vendored protos in `src/lib/riva/proto`) + `src/lib/audio/{wav,key-detect,song-key}.ts` — Listen feature.
- `src/components/BottomNav.tsx` — tab bar (Home · Chords · Listen · Me). `src/app/me` — profile page (replaced the old avatar dropdown).
- `src/lib/live-target.ts` — where "go live" lands: today's service, else next, else last.
- `src/lib/pedal.ts` — Bluetooth page-turner keys (→ ↓ PageDown Space = next; ← ↑ PageUp = prev), wired into Stage View and Live.
- `supabase/` — migrations, run IN ORDER in the Supabase SQL editor. Applied through **v21** as of this note.

## How Aaron wants to work (non-negotiable)
- **Next steps at the end of every piece of work, bulleted, numbered, clear.**
- **Terminal commands one per fenced box** (never chained with `&&`), first box always `cd C:\Users\a4ron\Projects\OnCue`, then `git status`, `git add -A`, `git commit -m "..."` (never bare `git commit`), `git push`. Include a verification step. Attribution trailers on commits: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_019LMUpCAXSKLEAriTGeahn4`.
- Claude cannot push (sandbox proxy refuses credentials) — Claude writes files to his disk, Aaron pushes. He sometimes batches: "we update everything at once".
- Claude cannot run SQL on his Supabase — he pastes migration files into the SQL editor. Always say which `vNN_*.sql` to run and in what order.
- He likes a pitch before a big change, and **rejects scope creep**: "none of what you recommended goes in, except…". Challenge every call, think about cascading effects (UX, screen space, small phones), but build only what he asked.
- Tone: direct, honest, no hedging. He will field-test on his Android (Samsung) and send screenshots — design diagnostics so screenshots are informative.
- Verification pattern before handing over: `npx tsc --noEmit`, `npm run test:chords`, `npm run test:parser`, eslint problem count must not grow (baseline 21 = 20 pre-existing errors + 1 warning), `npm run build` (stub the Geist font import when Google Fonts is blocked, then restore `layout.tsx`).

## Chord-sheet "copy paste" format (he asks for this constantly)
Inline ChordPro the app's parser reads:
```
# Section Name          (e.g. # Verse 1, # Chorus x2, # Bridge, # Intro, # Outro)
[G]Lyric with [D]chords in[Em]line, trailing chords allowed [C]
[G] [D] [Em] [C]        (chord-only lines fine)

Key of G                (last line; minor songs labelled by their home chord, e.g. Key of Em / Key of Dm)
```
No title/artist header. Repeat counts go in the header (`# Chorus x2`). Chords between words that have no syllable stay as bare `[X]`. Transpose on request (he says the target key); otherwise keep the chart's key. Capo charts: keep the shape key and mention the sounding key.

## Decisions already made (don't re-open)
- Stats page: own stats + admin sees all; only extra stat allowed = weeks since last played.
- Notes: **song-level only** (plus the older section-level ones). No "all songs in one scroll" view.
- Stage View/Live bottom edge belongs to Prev/Next + floating controls; **no tab bar there**. Nothing may scroll under floating controls ("visibility can't be compromised").
- Tab bar: four level tabs; the active tab's icon lifts into a purple disc. **No permanently raised Listen button** ("not used often enough to earn a highlight"). Upload stays top-right on Home only.
- Me page replaces the avatar dropdown; Stats/Admin live inside Me, not in the bar.
- Role-in-JWT hook: **not doing** (bundle carries role for free; hook adds 1h stale-role semantics).
- Full prefetch of Stage View: **not doing** (5-min stale notes on re-entry).
- Supabase Pro: declined.
- Go live works on any day: target = today's service, else next upcoming, else last.
- Listen: lyrics (Whisper via NVIDIA) → `identify_song` trigram match on our own sheets → **song-aware key** (fit the identified sheet's chords to the room; generic Krumhansl only as fallback). Shared key beats personal key preference in Live. Subtitle text on the Listen page was cut to nothing — he found explanatory copy embarrassing; keep UI copy minimal.
- Hum-to-identify (Shazam-style): **decided to trial, not build yet.** Shazam can't do humming; only ACRCloud query-by-humming is viable; it only knows commercial recordings. Gate: 14-day free trial, ≥70% hit rate on our top-30 songs, acceptable price for tens of requests/month. Plan doc in the claude.ai Project (`claude/hum-to-identify-plan.md`). Waiting on Aaron to create the ACRCloud account.
- Mid-song key changes already exist (v16): conductor writes `LAST CHORUS (KEY A)` / `KEY OF Bb` / `(UP 2)` on the section row in Excel. Planned follow-ups (Aaron asked for "full planning", approval pending): Phase 1 upload warnings for unresolvable relative markers + per-section capo/transpose hint + share text `Key of G → A`; Phase 2 remember key changes in setlist memory + a "Key →" control in the setlist editor.

## State as of 13 Oct 2026
Pushed and live (per Aaron): perf layer C (v20 bundle), Listen with NVIDIA Whisper, song-aware key detection, nearest-service live target, tab bar + Me page, PWA icon/service-worker fix (`oncue-v9`, identity files network-first; old-logo route handlers deleted), pedal support in Live + Stage View, identify page trimmed. SQL applied through v21. If `git status` shows anything from that list uncommitted, commit it — nothing is half-built.

Known good field results: lyrics + song match "on point"; key now fitted to the song's chords (untested at scale, solo-voice confidence can be "likely" rather than "confident" — that's honest, not a bug).

## Next steps (in priority order)
1. **Field test song-aware key** on Listen: sing "Blessing and Honour" in A, then in G; chip should read "A · fitted to the song's chords". Report the `key(song) …` numbers from the diagnostics line if wrong.
2. **Decide on hum-to-identify:** create ACRCloud account → send keys → Claude builds the branch behind `ACRCLOUD_*` env vars → 14-day trial with 3 people × top-30 songs.
3. **Key-change follow-ups (Phases 1–2 above)** once approved.
4. **iPhone test** of Listen in installed-PWA mode (voice may be unavailable; typed fallback should work) — never verified.
5. Renew `NVIDIA_API_KEY` before 18 Sep 2027 (reminder scheduled).
6. Backlog ideas not approved: offline bundle of the active service; ShareSetlist key journey; chord-progression re-ranking for instrumental intros.

## Gotchas
- Supabase puts extensions in the `extensions` schema — any new SQL function using pg_trgm/fuzzystrmatch needs `SET search_path = public, extensions`.
- `supabase-js .upsert({onConflict})` can't target partial unique indexes — use plain UNIQUE constraints.
- `public_profiles` view has no `role` column (select `teams`, mark worship with `teams.includes('worship')`).
- Android Chrome: never run SpeechRecognition and getUserMedia at once (one starves the other). Listen records raw PCM → 16 kHz WAV clips instead.
- Android home-screen icon only updates after the service worker stops serving cached icons; uninstall/reinstall is the fast path.
- The Riva `.proto` files must be included via `outputFileTracingIncludes` in `next.config.ts` or Vercel won't ship them.
