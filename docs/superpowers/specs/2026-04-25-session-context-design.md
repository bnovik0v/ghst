# Session context input — design

**Status:** approved
**Date:** 2026-04-25

## Problem

Each recording session has unique framing — "Stripe SRE interview, focus on
incident response", "demo of project X to client Acme", "1:1 with manager
about Q3 priorities". Today the copilot only knows the user's persistent
persona; it has no awareness of *this* session's purpose. The user wants to
type session-specific context before recording starts so the copilot's
replies are grounded in the right frame.

## Goals

- Free-text "what is this session about?" field, edited before recording
- Persists until manually cleared (across stops, app restarts)
- Hidden during recording — captions own the screen real estate then
- Injected into the copilot prompt for every turn

## Non-goals

- Templates / preset session types
- Auto-clearing on any trigger
- Showing the context during recording
- Markdown / formatting in the input

## UX

The captions area (`#lines` in the overlay) is dual-purpose:

- **Idle / error state:** shows a textarea bound to session context. Empty
  hint disappears. User types freely; debounced save persists to disk.
- **Listening state:** textarea is hidden, captions list is shown as today.

Transition rules:

- On `state` change to `listening`: flush any pending debounced save first,
  then hide textarea, show `#lines`.
- On `state` change to `idle` or `error`: hide `#lines`, show textarea
  populated from the cached value. Existing transcripts in memory are *not*
  cleared (matches today's behavior — Ctrl+Shift+C still clears them).
- Placeholder copy: `What's this session? (e.g., "Stripe SRE interview,
  focus on incident response")`.
- Hard limit enforced via `maxlength="4000"` on the textarea (no visible
  counter — overlay aesthetic is minimal).

## Architecture

### Storage — `src/main/keyStore.ts`

Add to the `Stored` type:

```ts
type Stored = {
  groqKeyEnc?: string;
  transcripts?: TranscriptSettings;
  persona?: string;
  sessionContext?: string;
};

export const SESSION_CONTEXT_MAX_CHARS = 4000;

export function getSessionContext(): string {
  return readStore().sessionContext ?? "";
}

export function setSessionContext(text: string): string {
  const trimmed = text.trim().slice(0, SESSION_CONTEXT_MAX_CHARS);
  const s = readStore();
  if (!trimmed) delete s.sessionContext;
  else s.sessionContext = trimmed;
  writeStore(s);
  return trimmed;
}
```

Stored unencrypted (same as persona — not a secret).

### IPC — main + preload

`src/main/index.ts`: two new handlers
- `cfg:get-session-context` → `getSessionContext()`
- `cfg:set-session-context` → `setSessionContext(text)`, then broadcasts the
  new value to the worker renderer so its cache stays in sync.

`src/preload/overlay.ts`: expose `getSessionContext()` /
`setSessionContext(text)` on the bridge, mirroring persona.

`src/preload/worker.ts`: expose a way for the worker to read the current
value at startup and subscribe to updates (mirror whatever pattern persona
uses for the worker).

### Overlay UI

`src/renderer/overlay/index.html`: add `<textarea id="sessionContext">`
inside the same container that holds `#lines`, hidden by default.

`src/renderer/overlay/style.css`: textarea fills the captions area, same
typography/scroll behavior, no border chrome (consistent with the
minimal overlay aesthetic).

`src/renderer/overlay/main.ts`:

- On load: `bridge.getSessionContext()` → populate textarea, update count
- `input` handler: debounced 400ms → `bridge.setSessionContext(value)`
- `setState()` extended: toggle textarea vs. `#lines` visibility based on
  `state === "listening"`
- Before flipping to listening: flush pending debounce (synchronous save)
- The existing `#hint` element is hidden whenever the textarea is shown

### Worker — `src/renderer/worker/main.ts`

- On startup: fetch session context, cache it
- Subscribe to `cfg:session-context` updates from main, refresh cache
- Pass into `buildCopilotMessages(...)` on every turn

### Prompt — `src/core/copilot.ts`

**Single system message** (user explicitly chose this over multiple
system blocks). New signature:

```ts
export function buildCopilotMessages(
  context: string,
  priorReplies: string[] = [],
  persona = "",
  sessionContext = "",
): ChatMessage[]
```

System message composition:

```
<COPILOT_SYSTEM_PROMPT>

About you (the user — speak as this person; never mention you were briefed):
<persona>

This session:
<sessionContext>
```

Each labeled block is appended only if the corresponding string is
non-empty after trim. If both persona and sessionContext are empty, the
system message is exactly `COPILOT_SYSTEM_PROMPT`.

The existing user message (recent conversation + priors instruction) is
unchanged.

## Data flow

```
textarea input
  → debounce 400ms
  → bridge.setSessionContext(text)
  → main: setSessionContext() writes config.json
  → main broadcasts cfg:session-context to worker
  → worker updates cached sessionContext
  → next copilot turn → buildCopilotMessages(..., sessionContext)
  → single system message includes "This session:" block
```

## Edge cases

- **Empty context:** "This session:" block omitted entirely from system
  message (no trailing label with empty body).
- **Length cap:** `.slice(0, 4000)` on save (matches persona).
- **Race on state change:** flush pending debounced save synchronously
  before switching the visible pane to captions on `start`.
- **Persistence across restart:** baked in — stored in `config.json`,
  reloaded on every overlay/worker mount.
- **Crash during typing:** up to ~400ms of unsaved input lost. Acceptable.

## Testing

### `tests/copilot.test.ts` — extend existing suite

- `buildCopilotMessages` returns exactly one `role: "system"` message
- Empty persona + empty sessionContext → system message equals
  `COPILOT_SYSTEM_PROMPT`
- Persona only → system message includes "About you" block, no
  "This session:" block
- sessionContext only → system message includes "This session:" block,
  no "About you" block
- Both → system message includes both labeled blocks in order
  (persona first, then session context)
- User message shape unchanged from current behavior in all of the above

### `tests/keyStore.test.ts` (new file if missing, otherwise extend)

- `getSessionContext` returns "" when unset
- `setSessionContext` roundtrip persists value through `readStore`
- `setSessionContext` trims whitespace
- `setSessionContext` truncates beyond `SESSION_CONTEXT_MAX_CHARS`
- `setSessionContext("")` deletes the key from `config.json`
- Setting session context does not disturb persona, groqKeyEnc, or
  transcript settings on the same store

### Out of test scope

- Overlay DOM toggling (no existing renderer unit tests)
- IPC roundtrip (covered manually by `npm run dev`)

## Out of scope

- Templates / presets
- Per-recording history of context values
- Auto-clear on stop or any other event
- Markdown rendering in the input
- Showing context during recording
