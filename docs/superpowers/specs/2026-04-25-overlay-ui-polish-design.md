# Overlay UI polish — design

Status: approved
Date: 2026-04-25
Scope: `src/renderer/overlay/` only — no main / worker / core changes.

## Problem

Two friction points in the current overlay:

1. **Suggestion cards get cut.** Long copilot replies (e.g. "explain X") overflow the fixed-height card and require scrolling inside it. While reading, the user loses sight of the live transcript. There is no markdown rendering, so code/lists render as a wall of text.
2. **Settings modal feels grafted on.** Square chrome and generic input styles don't match the pod's glass aesthetic. The modal scrolls. "Remove key" sits at the bottom of the modal, far from the API key input it acts on, and reads as a primary footer action.

## Goals

- Long suggestions get the room they need without obscuring the live transcript.
- Markdown / code blocks render readably inside cards.
- Previous suggestion stays visible and readable, just narrower.
- Settings modal looks like part of the same product as the pod.
- "Remove key" is reachable directly from the API key field.
- No inner scrollbars at default window/modal sizes for the common case.

## Non-goals

- No changes to the pod itself, the VAD ring, or any keyboard shortcuts.
- No changes to `src/main/`, `src/renderer/worker/`, or `src/core/` IPC contracts.
- No new settings beyond what already exists. (Shortcuts list in the settings panel is read-only reference, not configurable.)
- Not redesigning the empty-state hint or the session-context textarea behavior.

## Main UI layout

Vertical stack inside `#root`:

```
┌─────────────────────────────────────────────────────────┐
│  pod  (unchanged)                                       │
├─────────────────────────────────────────────────────────┤
│  transcript ribbon  (Them)                              │
│  …prior committed text. current committed text          │
│  *tentative tail words…*                                │
├─────────────────────────────────────────────────────────┤
│  self running line  (You)                               │
│  You: latest committed self utterance · single line     │
├──────────────────────────────────┬──────────────────────┤
│  current card (≈ 2fr)            │  previous card (1fr) │
│  - meta row                      │  - meta row          │
│  - markdown body (lists, code,   │  - markdown body     │
│    paragraphs)                   │  - same height row   │
│  - grows with content            │                      │
└──────────────────────────────────┴──────────────────────┘
```

The existing self-voice line (`#selfLine`) moves to sit directly under the transcript ribbon (currently it sits between the chat/live-bar and the cards). It keeps its current behaviour: single line, "You:" prefix, latest committed self utterance only, ellipsis on overflow, no scroll, no history.

### Transcript ribbon

- Replaces the bottom-pinned `.chat__live` bar. Lives directly under the pod.
- Renders the last 2–3 lines of transcript: prior committed lines dimmed, current committed line at full ink, tentative words italic and ghost-colored (re-uses the existing `committed`/`tentative` semantics from `LocalAgreement` in `src/core/stream.ts`).
- Wraps; never scrolls. Soft `max-height` of ~3 lines; older lines fall out of view (they remain available — see "History" below).
- Subtle accent-rose tint background, matching the `data-state="listening"` accent already in use.

### History

The current `.chat__scroll` bottom-anchored history (older committed transcript lines) is removed from the **visible** flow only. Older lines are not rendered in the overlay — the ribbon shows the recent context, and the cards carry the conversational signal.

Underlying storage and behavior are unchanged:

- `TranscriptManager` (`src/core/transcript.ts`) continues to receive and retain every committed line in its ring buffer.
- IPC events from worker → main → overlay (`committed`, `tentative`, etc.) still flow as today.
- The "Save transcripts to disk" feature continues to write the complete transcript on stop.

If we later need an in-overlay way to read history, it can come back as an explicit collapsible panel; we just don't render it inline anymore.

### Self running line

- The element `#selfLine` and its event wiring already exist (added in the self-voice-capture work). This spec only repositions and restyles it.
- Position: directly below the transcript ribbon, above the cards row. No longer floats between the chat block and cards.
- Visual: subdued italic single line, dim ink. Tone down the current warm/amber card-style chrome — aim for a no-chrome line that reads as a counterpart to the Them ribbon (lighter background, softer border or no border, same horizontal padding so the two lines align).
- Width matches the transcript ribbon and cards row.
- Hidden when there is no committed self utterance (current behaviour).

### Cards row

- Grid: `grid-template-columns: 2fr 1fr; gap: 10px;` (replaces today's `1fr 1fr`).
- Both `.card__slot` cells share the same row height (CSS grid auto-rows already does this).
- Card max-width and overall overlay max-width bump from `820px` to a wider value to give code blocks room. Concrete number to be set in implementation; aim for ~1040–1100px.
- Card height: `min-height` retained (current ~96px), but cards now **grow with content** up to a soft cap of `min(70vh, 560px)`. Above that, internal scroll engages on `.card__text` (already supported, just gated on the soft cap).
- Previous-card opacity and hover treatments stay as today (`.card--prev` 0.55 default, 1.0 on hover). It remains a readable card — title + body — never a tab/strip.

### Markdown rendering inside cards

- Replace the current `white-space: pre-wrap` text dump with rendered markdown.
- Renderer: a small markdown lib that supports paragraphs, headings (h3+ at most), bullet/ordered lists, inline code, fenced code blocks, bold/italic, links. Recommend `marked` (small, fast, zero deps) plus DOMPurify for sanitization. Streaming-friendly: re-render on each chunk update.
- Code blocks: monospace, `--font-mono`, dark inset background (re-use the existing `code { background: #0a0b0e }` look from the brainstorm), horizontal scroll inside the block when a line overflows; no syntax highlighting in this pass.
- Links open externally via main-process shell handler (already wired for the `Get one at console.groq.com/keys` link).

### Card text scroll behavior

- While the card is below the soft cap, `.card__text` has `overflow: visible` and the card grows.
- At/above the cap, `.card__text` falls back to the existing `overflow-y: auto`.
- The streaming "current" card auto-scrolls its body to the bottom as new tokens arrive (mirroring the current chat auto-scroll), but only when the user has not manually scrolled up inside it.

## Settings panel redesign

### Chrome

- Same modal mount point (`#settings`); the `dialog` semantics and ESC/click-outside dismiss behavior in `main.ts` stay.
- Panel: `border-radius: 20px`, `backdrop-filter: blur(22px) saturate(140%)`, `background: rgba(8,9,12,0.72)`, inset top highlight + drop shadow — matches the pod.
- Header row: italic Fraunces "settings" title on the left, small mono-uppercase "ghst" wordmark on the right, hairline divider below.
- Footer row: hairline divider, then right-aligned **Close** (ghost) + **Save** (primary accent-rose). Nothing else in the footer.
- No inner scrollbar at `1280×800` and above. Sized to fit content via grid.

### Layout

- Two columns, fixed inner width ~720px (so it remains usable on small windows; below ~720px effective width, gracefully collapse to single column via a `@media` rule).
- Left column: **identity**.
  - Groq API key (label + field).
  - About you (label + textarea).
- Right column: **capture & reference**.
  - Transcript capture toggle + folder field.
  - Shortcuts reference list (read-only).

### Field component

A reusable visual: a rounded "field" container that holds an input, optional status indicator, and optional inline action button. The action sits flush right inside the field, separated by a hairline border.

```
┌───────────────────────────────────────────────────┐
│ gsk_••••••••••••••••••••••••••••••     ●  remove │
└───────────────────────────────────────────────────┘
```

- API key field: type=password, status dot (green when a key is set, dim when not), inline **remove** action.
- Transcript folder field: text input, inline **browse…** action.
- Persona textarea: same chrome, no inline action; min-height ~120px in the two-column layout.

### Section labels

Mono uppercase, tracked, dim ink — matches the card meta style (`--font-mono`, ~10px, letter-spacing .16em). Right side of the label row carries a small contextual hint (e.g. "stored in OS keyring", or the persona character count "128 / 4000").

### Capture toggle

- Custom switch (track + thumb) replacing the native checkbox, accent-rose when on. Label: "Save `.txt` on stop".
- When off, the folder field, "Open folder" link, and "Reset to default" link dim and become non-interactive (visually grouped under the toggle).

### Shortcuts reference

Right column, below capture. Read-only list of the four global shortcuts with `<kbd>` chips:

- Toggle overlay — `⌃⇧L`
- Toggle listen — `⌃⇧␣`
- Clear — `⌃⇧C`
- Trigger copilot — `⌃⇧⏎`

These are sourced from the same constants used by main's `globalShortcut` registration. If the constants live only in main today, expose them via the existing preload bridge (read-only) so the overlay renders the canonical values rather than hardcoded strings.

### Action row removal

The current bottom row containing **Remove key / Close / Save** is removed. **Remove key** moves into the API key field as the inline action. **Close + Save** move to the new footer.

## Files affected

- `src/renderer/overlay/index.html` — markup changes for transcript ribbon, cards grid, settings panel structure.
- `src/renderer/overlay/style.css` — new ribbon, updated cards grid (2fr 1fr, soft cap, markdown styles), settings panel rebuild.
- `src/renderer/overlay/main.ts` — wire the ribbon to the existing `committed`/`tentative` events (replace the live-bar code path); render markdown in card bodies; settings panel event wiring (inline remove button, switch toggle, dim-when-off behavior, shortcuts list rendering).
- `package.json` — add `marked` and `dompurify` (or chosen equivalents).
- Possibly `src/preload/*` if shortcut constants need to be exposed read-only.

No changes to: `src/main/*`, `src/renderer/worker/*`, `src/core/*`, IPC types.

## Risks

- Markdown rendering on every streamed chunk may flicker; mitigate by rendering into a detached node and swapping innerHTML, or by debouncing to animation frames.
- `marked` + DOMPurify add ~30 KB gzipped to the overlay bundle. Acceptable for an Electron renderer.
- The soft cap at 70vh interacts with the wider window — verify on small displays (1366×768 laptops). The `@media` collapse to single-column for the settings panel covers small widths; the main UI relies on the existing window-resize behavior in main.

## Acceptance criteria

- Long copilot reply (≥ 1500 chars with code blocks) renders with formatted markdown, fits within ~70vh without inner scroll, and shows a quiet inner scroll only when content exceeds the cap.
- While a long answer is on screen, the live transcript remains visible with the latest committed line and any tentative words.
- Previous card stays at full row height, readable, opacity 0.55 default and 1.0 on hover.
- Settings modal opens at default screen sizes without showing a scrollbar.
- Clicking **remove** inside the API key field clears the key (same effect as the old "Remove key" button) and the status dot updates.
- Capture toggle visually switches state without a page reload; folder controls dim when off.
- All existing tests still pass; no main/worker/core code changes.
