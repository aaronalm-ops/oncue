# OnCue Chords Library — Build Spec (v2)

## Purpose

Musicians need the chords for each song alongside the conductor's chart. Chord sheets arrive as PDFs in wildly varying formats (verified against two real samples: a worshipchords.com export and a homemade Word-style sheet). This feature ingests those PDFs once into a canonical library, and shows the right chords — in the right key — next to the conductor's instructions during practice and services.

Six real sample files — one full week's setlist — ground every decision in this spec. They live in `chord-samples/` as permanent parser fixtures. They span four distinct format families:

**Family 1 — worshipchords.com exports** (`great-in-power`, `above-every-other-name`, `thank-you-jesus-for-the-blood`): cleanest case. Title carries key as `(Key of G)`. Monospace layout, chords above lyrics, meaningful alignment. But they still contribute: `Pre-chorus` (hyphenated), `Tag`, `Ending`, `Turnaround` (chords-only section), `Bridge 1`/`Bridge 2`, `Last Chorus` labels; `Repeat Chorus` as a flow line; multi-page files; chords-only intro blocks spanning several lines; background-vocal lyric lines with no chords (indented "Beautiful beautiful beautiful" echoes); stray annotations like `[ to end]`.

**Family 2 — homemade Word-style** (`you_are_good`): title carries key as `(E)`; BPM in parens after artist `(120)`; `Bridge:` with trailing colon; chord typo `F3m7/E` (should be `F#m7/E`); non-standard run `(C2 DDDD)`; inline `(repeat)`; flow shorthand `-Verse`, `-Chorus`, `-Verse 2x`.

**Family 3 — scrambled text layer** (`WHO IS THIS KING CHORDS`): visually fine (chords above lyrics), but the PDF's *extraction order* is garbage — lyrics extract first without their chords, stray chord letters cluster at the end, and the title line lands at the bottom glued to a stray chord glyph (`EWho is this King? - By Lamar Boschman // Scale of C`). Key appears as `// Scale of C` — same "scale" vocabulary as the conductor's charts. This file is why extraction must be coordinate-aware, not reading-order text.

**Family 4 — CCLI SongSelect official** (`Revelation_Song`): key as `Key - D` in the header; dot-leader noise (`. . . .`) interleaved with lyrics; italic section labels; inline flow annotations attached to chord lines (`(To Verse)`, `(Ending)`); a CCLI footer block (song #, copyright, license #) repeated per page — legally meaningful, worth capturing, must not be parsed as lyrics.

Any pipeline that can't survive all six files isn't done.

## Standing principles

1. **Nothing unreviewed reaches the team.** Auto-parsing is a head start, never an authority. A human approves every version before it's visible (RLS already hides unreviewed versions from members).
2. **The live path never blocks on chords.** If a song has no linked chords, no reviewed version, or a section label that can't be matched, the service views behave exactly as today. Chords are additive.
3. **Transposition is deterministic music theory, not guessing.** Transposing C→D is mechanical and safe (unlike the v1 ban on instrument transposition, which involved judgment). Unknown tokens are left untouched and visibly flagged rather than mangled.
4. **The conductor's chart stays the source of truth for structure.** The chords view follows the chart; it never re-orders the service.

## Current state (honest)

Built: v2 tables (`library_songs`, `song_versions`, `chord_sections`, `song_links`, `user_scale_preferences`) with correct RLS; Library list page with search + add-title.
Broken: song rows link to `/library/[id]` which does not exist (404).
Unbuilt: everything else in this document.

---

## Part 1 — Ingestion pipeline

### Flow (admin/worship_leader only)

**Bulk-first.** The primary entry point is on the Library page: "Upload chords" accepts *many PDFs at once* (like the chart uploader's multi-select). Nobody manually creates song entries when a PDF already knows its own title, artist, and key. Per-song "Add chords" still exists on the detail page for adding another version to a specific song, and paste-mode remains the scan fallback.

**The confirm queue.** Each uploaded file is stored, extracted, and parsed server-side, then appears as a card in a confirmation list:

- Detected **title / artist / key / BPM**, each editable inline (defaults from the parser; filename fallback when detection is weak)
- A **match line**: "New song" or "Matches: *Great In Power* (existing)" via normalised-title similarity, with a dropdown to override — this prevents duplicate library entries when re-uploading a song that already exists (a new *version* is attached instead)
- A **status chip**: `Parsed — N sections` / `Scan — needs paste` / `Extraction failed`
- Files process sequentially with progress ("3 / 6"); one bad file never blocks the rest

**Confirm** (per card, or "Confirm all" for the clean ones) creates the library song if new — or attaches to the matched song — and saves the version *unreviewed*. The deep chord review/approve step stays per-song, at each person's pace: the library list already shows "0/1 reviewed" badges, so unreviewed backlog is always visible. Bulk confirm handles identity; it never silently publishes chords.

1. **Upload.** One or many PDFs from the Library page (or one from a song's detail page). Every PDF is stored in the private `chord-pdfs` bucket immediately, so the original is never lost regardless of what happens next.
2. **Extract — coordinate-aware, never reading-order.** Server-side extraction pulls text items *with x/y positions and font size* (pdf.js `getTextContent`), reconstructs lines by y-band, orders words by x within each line, and preserves column offsets so chord→syllable alignment survives. This is non-negotiable: `WHO IS THIS KING` has a text layer whose reading order is scrambled — naive extraction produces lyrics divorced from their chords. Multi-page files concatenate in page order. Repeated per-page header/footer blocks (CCLI copyright block) are detected by repetition and stripped from the body — the CCLI song/license numbers are captured into version metadata instead. If the PDF yields no text layer at all (scan/photo): stop with a clear message — "This PDF is a scan. Paste the chords as text instead." Editor opens in paste mode with the PDF displayed alongside.
3. **Parse to draft.** Heuristic parser (below) converts extracted text to draft ChordPro. Draft is marked with a per-section confidence so the review screen can highlight what it wasn't sure about.
4. **Review.** Split screen: original PDF render on one side, editable ChordPro text on the other, live preview below/beside. The reviewer fixes labels, typos, alignment. Section labels are editable text with suggestions (Verse 1, Verse 2, Chorus, Pre-Chorus, Bridge, Intro, Interlude, Outro, Tag), not a locked dropdown — charts have shown labels like `CHORUS 2 (HE HAS DONE GREAT THINGS)`.
5. **Approve.** Sets `reviewed_at`, derives `chord_sections` rows from the ChordPro in the same transaction. Version becomes visible to the team. Approving again after later edits re-derives sections atomically.

### Parser heuristics (deterministic, no AI)

- **Metadata:** title = the line with the *largest font size* (not "first line" — WHO IS THIS KING extracts its title last, with a stray chord glyph glued on; leading orphan capitals are stripped). Filename is the fallback title. Key captured from any of the four observed forms: `(Key of G)`, trailing `(E)`, `Key - D`, `// Scale of C`. Artist from a `by …` line or the line after the title; BPM from trailing `(NNN)`. URL lines ignored; CCLI numbers captured to metadata.
- **Noise stripping:** dot-leader runs (`. . . .` — CCLI charts) removed before classification; repeated per-page footer blocks removed.
- **Section header:** a short line (≤ 4 words) that starts with a known section word (verse, chorus, bridge, intro, outro, interlude, tag, pre-chorus, instrumental, vamp, ending, turnaround), optional number or qualifier (`Bridge 2`, `Last Chorus`), optional trailing `:`.
- **Chord line:** ≥ 70% of whitespace-separated tokens match the chord grammar `[A-G][#b]?(m|maj|min|dim|aug|sus|add)?[0-9]*(/[A-G][#b]?)?` plus parenthesised runs and `x2`/`(4 times)` annotations. A line that is only chords is a chord line.
- **Pairing:** a chord line followed by a non-chord line = chords over that lyric line; character-column alignment maps each chord to its position → inline ChordPro `[G]Praise Him…`. Alignment from proportional-font PDFs is approximate — that's what review is for. A chord line followed by another chord line or a blank = instrumental line, kept as its own ChordPro line.
- **Flow references:** three observed syntaxes, one behaviour. `-SectionName` / `-SectionName 2x` (homemade), `Repeat Chorus` on its own line (worshipchords), both = flow marker rows (`{flow: Chorus, times: 2}`), rendered as a subtle "→ Chorus ×2" row, tappable to jump. Not expanded into copies — editing a chorus once edits it everywhere. Inline annotations attached to chord lines — `(To Verse)`, `(Ending)`, `(repeat)`, `[ to end]` — are kept verbatim in place as small dimmed text; they carry performance meaning and cost nothing to preserve.
- **Background-vocal / echo lines:** a lyric line with no chord line above it (often indented) is kept as a plain lyric line — no special casing needed, but the pairing logic must not steal the previous chord line from the main lyric above it.
- **Confidence:** any line the parser couldn't classify is kept verbatim and flagged; the review screen scrolls to the first flag.

### Failure ledger (ingestion)

| Failure | Behaviour |
|---|---|
| Scrambled extraction order (WHO IS THIS KING) | Coordinate-aware reconstruction handles it; if line-banding still produces nonsense, reviewer sees it instantly next to the PDF and pastes over it |
| Title misdetected | Largest-font heuristic + filename fallback + editable title field in review |
| No text layer | Clear message, paste-mode editor, PDF preserved as reference |
| Garbled extraction | Reviewer sees it immediately in review; can paste over it |
| Upload interrupted | PDF already stored in step 1; draft autosaves to localStorage every few seconds; reopening review restores the draft |
| Batch abandoned mid-confirm | Confirmed cards are saved; unconfirmed uploads remain as pending drafts the Library page resurfaces ("2 uploads awaiting confirmation") — nothing is lost, nothing half-created |
| Two files in one batch are the same song | Second file matches the first via the match line → attaches as another version, not a duplicate song |
| Wrong match confirmed | Versions can be moved/deleted from the song detail page; the PDF is never destroyed |
| Reviewer navigates away with unsaved edits | beforeunload guard + localStorage draft |
| Approve fails mid-way | Sections derive in the same transaction as `reviewed_at` — no half-approved state |
| Duplicate upload of same song | Versions are additive (`label` distinguishes them, e.g. "Key of G", "Acoustic"); nothing is overwritten |

---

## Part 2 — The chords viewer

One React component (`ChordSheet`) used everywhere: library detail page, review preview, and the service-view pane.

- **Rendering:** chords as small bold badges above the lyric syllable they attach to (from inline ChordPro), monospace-free, wraps naturally on narrow screens. Section headers styled like the existing section labels. Flow markers rendered subtly (`→ Chorus ×2`, tappable to jump).
- **Transposition:** target key selector pinned at top, defaulting to (in priority order): the user's saved preference for this song (`user_scale_preferences`) → the service's scale for the linked song (when opened from a service) → `stored_key`. Transpose is interval-based with enharmonic spelling chosen by target key signature (flat keys spell flats, sharp keys sharps). Slash chords transpose both halves. Unrecognised tokens (`(C2 DDDD)`) pass through untransposed with a dotted underline — visibly "not understood" rather than silently wrong. Changing key saves the per-user preference (one upsert, debounced).
- **Layout toggle:** whole song (single scroll) vs part-by-part (one section at a time with prev/next) — same pattern and same toggle iconography as My Part's existing song/scroll toggle. Choice persisted in localStorage.
- **Stage contrast:** reuses the existing `oncue-stage` preference — chords honour it automatically.
- **Lyric direction:** `dir="auto"` on lyric lines so non-Latin-script lyrics render correctly.

---

## Part 3 — Linking chart songs to library songs

- Chart songs and library songs are matched via `song_links` (already in schema), always human-confirmed.
- **Suggestion:** on a service page, songs without a link show a quiet "Link chords" affordance (admin/worship_leader only). Tapping it shows library matches ranked by normalised-title similarity (case/punctuation/whitespace-insensitive), with search fallback. One tap confirms.
- **Auto-relink:** when a new chart is uploaded, `ingest_chart` copies links from any previously linked song with the identical normalised title — a human confirmed that title mapping once; repeating it weekly is busywork. (Small SQL addition to the existing function.)
- **Unlink/relink:** always possible from the same affordance. Wrong links are a two-tap fix.
- Members never see linking UI — they just see chords appear when a link exists.

## Part 4 — Integration into service views (the vision)

The conductor's notes and the chords, together:

- **Phones (< 768px):** two panes — *Chart* (exact current view) and *Chords* — in a horizontal scroll-snap container. Swipe left/right to move between them; two small dots + labels indicate position. No layout change for anyone who never swipes. Swiping is scoped to the content area so it doesn't fight the existing bottom-bar controls.
- **Tablets / desktop (≥ 768px):** panes side by side — chart left, chords right, independently scrollable. This finally delivers the v1 spec's tablet tier too.
- **Foldables unfolded:** viewport-segments media queries place the split on the hinge; falls back to the ≥768px layout where unsupported (graceful, per v1 spec).
- **Follow mode (Live Sync):** in part-by-part layout, when the live section changes, the chords pane jumps to the chord section whose label fuzzy-matches the chart section label (normalise → strip parentheticals/numbers → prefix match; `CHORUS 2 (HE HAS DONE…)` → `Chorus`). No match → stay on whole-song view scrolled to top. Matching failures are silent and harmless — principle 2.
- **No linked chords:** the Chords pane shows the song title and, for admins, the link affordance; for members, "No chords linked yet." The swipe/split still works — empty states are designed, not accidental.
- **Performance:** the chords pane renders from data fetched once per service (joined through `song_links`), never re-fetched on section changes; transposition is memoised per (version, key).

## Explicitly out of scope for v2

- OCR of scanned PDFs (paste-mode covers it with less risk)
- AI chord recognition or AI cleanup of sheets
- Capo math and Nashville numbers
- Editing chords from the service views (library is the only editor)
- Any change to the Live Sync verbatim chart pane

## Build order

**Phase 1 — Library core (unblocks everything):** `/library/[id]` detail page (fixes the 404), PDF upload + storage, text extraction, heuristic parser, review editor with autosave, approve → derive sections. *Done when: all six fixtures in `chord-samples/` ingest to approved versions with ≤ 2 min of human fixes each (WHO IS THIS KING may legitimately need paste-mode — that still counts if the flow is smooth).*

**Phase 2 — Viewer:** ChordSheet component, transpose engine (+ unit tests: every key, slash chords, enharmonics, unknown-token passthrough), whole/part toggle, key preference persistence. *Done when: You Are Good renders correctly in all 12 keys with its typo visibly flagged, on a phone screen.*

**Phase 3 — Linking + service integration:** link affordance + suggestions, auto-relink in `ingest_chart`, swipe pane on phones, split view ≥768px, foldable segments, follow mode in Live Sync. *Done when: a musician on a phone swipes to chords mid-service and the section follows the leader.*

**Phase 4 — Hardening:** automated parser tests over `chord-samples/` (like `Charts Log/` for the chart parser) asserting per-file expectations — section counts, detected keys, flow markers, the known typo passthroughs; offline bundle of linked chords with the active service; edge-case sweep from the failure ledger.

Each phase ships independently — the app is never broken between phases.
