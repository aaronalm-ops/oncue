# Worship Setlist App — Build Spec (v1)

## Purpose

Our church worship team gets a per-service chart as an Excel file, prepared each week by the person who decides which musician plays what and how. Right now that lives as a spreadsheet everyone squints at. This app ingests that same Excel, with zero extra work asked of the person who makes it, and displays it in ways that help each musician play their part better and help everyone follow the flow of the service.

This is an existing, live need for a real team. It is not a general product. Build for this team.

The person who makes the chart keeps doing exactly what they already do. They upload the file. Everything else is the app's job.

---

## Users and auth

- Each person logs in (Supabase Auth, email or magic link is fine for v1).
- On first login, they select their instrument. This is stored on their profile.
- Their instrument is their default view everywhere. They can look at any other instrument at any time, but theirs is what loads by default.
- No role hierarchy needed in v1. Anyone logged in can also drive Live Sync (see Live Sync section).

---

## Data source reality (read this before writing the parser)

The uploaded files are real. Their shape is consistent in logic but variable in columns. Do not hardcode a schema. Detect per file.

**Filename carries the date and day.** Format seen: `DAY_DD-MM-YYYY_CHART.xlsx`, for example `THURSDAY_28-05-2026_CHART.xlsx` and `SATURDAY_02-05-2026_CHART.xlsx`. Parse both the day-of-week and the date from the filename. There is no date cell inside the sheet, so the filename is the source of truth for the service date. If a filename does not match the expected pattern, reject the upload with a clear message rather than guessing.

**Two services per week.** Thursday and Saturday. Each is its own file and its own record.

**Data is always in `Sheet1`.** `Sheet2` and `Sheet3` exist but are empty. Ignore them.

**Row 1 is the header row.** Column layout varies week to week:

- Column A is the structure column. Its header is sometimes `STRUCTURE` and sometimes blank.
- Then come instrument columns. The set changes each week. Instruments seen across samples: `DRUMS`, `KEYBOARD`, `LEAD GUITAR`, `RHYTHM GUITAR`, `VIOLIN`, `BASS GUITAR`, `CELLO`. Do not assume this list is complete or fixed. Read it from the header row.
- A `COMMENTS` column holds the conductor's transition and dynamics notes. This is the most important freeform field. Preserve it verbatim.
- A link column may be present, headed `YOUTUBE LINK` or `LINK TO SONG`. Sometimes there is no dedicated link column and the YouTube URL just sits inline on the song row or a section row instead.

**Instrument column detection rule:** the first column is structure. Any column whose header contains `COMMENTS` is the comments column. Any column whose header contains `LINK` is the link column. Every remaining non-empty header column is an instrument. This survives the week-to-week variation without a hardcoded list.

**Rows:**
- A row where column A equals `SONG` starts a new song. Column B holds the title and scale, in the form `TITLE - SCALE "X"`, for example `YOU ARE GOOD - SCALE "Bb"`.
- A row where column A equals `MEDLEY` groups the songs that follow it into a medley. Capture the grouping. It is display context, not a song itself.
- Any other row with a non-empty column A is a section: `INTRO`, `VERSE`, `CHORUS`, `BRIDGE`, `INSTRUMENTAL SOLO`, `OUTRO`, `PRE-CHORUS`, `FULL SONG`, and so on. The label often carries a lyric cue in parentheses, for example `CHORUS 2 (HE HAS DONE GREAT THINGS)`. Keep the whole label verbatim, cue included.
- Blank column A rows are spacers. Skip them.

**The orange intro highlight is machine-readable and the whole basis of the intro flag.** Verified across all sample files: the exact fill color is ARGB `FFFF9900`, one consistent value, never a range. The conductor paints an instrument's cell orange when that instrument plays the intro or a lead-in. Read the cell fill during parsing. If an instrument cell's fill is `FFFF9900`, mark that instruction as an intro flag. This is the leader's own signal, read literally. There is no interpretation and no AI in this path.

**YouTube links:** on a song's rows, a cell may contain a `youtu.be` or `youtube.com` URL, sometimes in the link column, sometimes inline, sometimes more than one. Detect URLs by pattern anywhere within a song's block and attach them to that song as an array of reference links.

---

## Data model

Normalize on ingest. Because instruments vary weekly, store instructions as child rows keyed by instrument name, not as fixed columns. This is the spine that makes everything else work.

**service**
- id
- service_date (from filename)
- day_of_week (from filename: Thursday or Saturday)
- source_filename
- uploaded_at
- instruments (array of instrument names detected in this file)

**song**
- id, service_id
- order_index (position in the service)
- title
- scale (the key, for example "Bb"; null if the title did not match the pattern, in which case keep the raw title)
- medley_group (nullable label linking songs that share a MEDLEY grouping)
- reference_links (array of URLs)

**section**
- id, song_id
- order_index
- label (verbatim, including any lyric cue in parentheses)
- comments (verbatim text of the COMMENTS cell for this section, may be empty)

**instruction**
- id, section_id
- instrument (name)
- text (verbatim instruction cell for this instrument in this section, may be empty or "SILENT")
- is_intro (boolean, true when the source cell fill was `FFFF9900`)

**session_state** (drives Live Sync)
- service_id (one active state row per service)
- current_song_index
- current_section_index
- updated_at
- updated_by (nullable, the user or instrument who last moved it)

**user_note** (personal private notes)
- id, user_id, section_id, instrument
- note_text
- Private to the user who wrote it. Never shown to anyone else. Never written back to the Excel.

---

## Ingestion and parsing

Parse server-side in the Next.js app using **ExcelJS**, because it reads cell fill colors reliably in Node and keeps the whole stack in TypeScript. Do not parse fills client-side.

Flow:
1. Admin uploads the `.xlsx` through an upload route.
2. Validate the filename against the `DAY_DD-MM-YYYY_CHART` pattern. Reject clearly if it fails.
3. Open `Sheet1`. Read the header row. Classify each column as structure, instrument, comments, or link using the detection rule above.
4. Walk the rows top to bottom, tracking the current song and any active medley group.
   - On a `SONG` row: parse title and scale, start a new song, capture any reference URLs on that row.
   - On a `MEDLEY` row: set the current medley group for the songs that follow, until the next standalone song breaks it. (Judge grouping by proximity; the medley label lists the songs it covers.)
   - On a section row: create a section under the current song, capture the comments cell, then for each instrument column create an instruction with the verbatim cell text and the `is_intro` flag from the cell fill.
   - Collect any inline URLs into the current song's reference_links.
5. Write the normalized records to Supabase.
6. If a service already exists for that date, replacing it should update in place (re-upload of a corrected chart is expected).

Edge cases to handle rather than crash on:
- Missing scale in a title. Keep the raw title, scale null.
- No dedicated link column. URLs found inline still attach.
- Empty instrument cells. Store as empty; the UI shows nothing for that instrument in that section.
- A cell reading `SILENT`. Store verbatim; it is meaningful to the musician.

---

## On login: default to today

- On login, check whether a service exists for today's date.
- If yes, open that service directly in the user's default mode and instrument.
- If no, open the database view: a list of all services, most recent first, each labelled with its day and date. The user picks any date to open it.
- The database view is always reachable, so a user can look at past or upcoming services whenever they want.

---

## Mode 1: Live Sync

Everyone on this mode sees the same position in the service, in real time. When the position moves, every device follows.

- **Anybody can drive.** There is no designated leader and no take-control lock in v1. Any logged-in user can tap next or previous, and it updates `session_state`, which every subscribed device reflects. Last write wins.
- Built on **Supabase Realtime**. Clients subscribe to changes on the service's `session_state` row. Tapping next or previous is an update to that row.
- **Verbatim only.** Live Sync shows the leader's text exactly as written. No enrichment, no AI interpretation, nothing filtered or summarized. The only computed element is the intro glow, and that is read directly from the leader's own orange cell fill, so it is still fully leader-authored.
- **The user's own column is highlighted.** Their instrument's instruction is enlarged and prominent. Other instruments are visible but dimmed, so context is there without competing for attention.
- **Intro glow.** When the current section is the user's intro (their instruction `is_intro` is true), their cell gets a glowing border so they immediately see this is their moment. Highlight only. No animation, nothing that could lag the live view.
- **Next-part note.** A small line shows what the next section is, for example `Next: CHORUS`, so whoever is driving knows what they are about to send everyone to, and every musician can see what is coming.
- **Reliability first.** Cache the full current service locally so a dropped connection does not blank the screen mid-song. A device that loses the network keeps showing the last known state and catches up when it reconnects. Nothing about Live Sync should feel heavy or slow. Highlights and text swaps only.

---

## Mode 2: My Part Only

A single musician's view of their own instrument across the whole service. This is where light enrichment is allowed, because it is not driving anyone else's screen.

- Shows only the user's instrument instructions, section by section, across every song in the service. The other instruments' columns are not shown here.
- **Layout toggle**, user preference:
  - **Song by song:** swipe through one song at a time, section by section. Good for focus and for practising at home.
  - **All on one page:** the user's entire part for the whole service in a single scroll. Same content, laid out continuously for people who prefer to see everything at once.
- **Intro flag** surfaces here too, from the same `FFFF9900` source, shown as a clear badge on the sections where the user plays the intro or lead-in.
- **Scale badge** for each song, pinned so the key is never something they have to hunt for.
- **Reference track button** per song, opening the YouTube link.
- **Personal private notes:** the user can attach their own note to any section, for example a reminder to watch the leader for tempo. Private to them, stored locally to their account, never written back to the Excel and never shown to others.

---

## Shared features (both modes)

- **Scale and key badge**, always visible for the current song. Display only. No auto-transpose, because transposition is instrument-specific and a place the app could be quietly wrong, so it is deliberately left out.
- **Reference track button.** One tap to open the song's YouTube link.
- **Running order strip.** The service's song titles in sequence, along the top, tappable to jump to a song. This is navigation, not interpretation.
- **Stage-contrast mode.** A high-contrast, oversized-type display toggle for reading on a dim platform. This is the most-used comfort feature on a real stage. Make it one tap to enable.
- **Download the Excel as-is.** For anyone who would rather just use the original spreadsheet, a button to download the exact file that was uploaded for that service. Unmodified.

---

## Device tiers

Design phone-first. The phone is the primary surface, one mode full-screen, big type.

- **Phone:** one mode at a time, full-screen, large readable text.
- **Tablet:** split view. A thin running-order strip across the top so the user always sees where they are in the service, with their instrument's detail filling the rest of the screen.
- **Foldable, unfolded:** book layout. One side shows the running order and structure of the service, the other shows the user's live-synced part. Folded, it behaves like a phone. Use responsive layout and viewport-segment media queries where supported, with a graceful fallback to the tablet layout where they are not.

---

## Tech stack

- **Next.js** app, deployed on **Vercel**.
- **Supabase** for Postgres, Auth, and Realtime.
- **ExcelJS** for server-side parsing, chosen specifically because it reads cell fill colors reliably in Node.
- **PWA** with offline-first caching of the active service, so Live Sync survives flaky venue wifi.

---

## Explicitly out of scope for v1 (do not build these)

- No "jump to my next active part" feature.
- No intensity or dynamics arc. Do not attempt to turn the comments prose into an intensity graph or any inferred visualization.
- No AI interpretation of the comments or instruction text anywhere in Live Sync. The only computed signal is the intro flag, read literally from the orange cell fill.
- No auto-transpose.

---

## Standing standards for this build

- The intro flag is read from the leader's literal cell fill. It is never inferred. If a cell is not painted orange, there is no flag.
- Live Sync is verbatim. Never summarize, rephrase, or filter the leader's words in the live path.
- Private notes stay private and never touch the source file.
- If this build is written up or shared anywhere, describe the AI's role in building it honestly.
