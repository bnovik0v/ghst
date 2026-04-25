# Session Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editable per-session context field to the overlay that replaces the captions area while idle and is injected into the copilot's system prompt.

**Architecture:** A new `sessionContext` string is persisted in `config.json` alongside `persona`. The overlay shows a textarea in place of `#lines` whenever state ≠ "listening", with debounced save on input. `buildCopilotMessages` is refactored to compose a single system message that merges `COPILOT_SYSTEM_PROMPT` + persona + session context (per the spec, replacing the current two-system-message shape).

**Tech Stack:** TypeScript, Electron (main / preload / renderer), Vitest.

**Spec:** `docs/superpowers/specs/2026-04-25-session-context-design.md`

---

## File Map

- **Modify** `src/core/copilot.ts` — add `sessionContext` arg to `buildCopilotMessages`, collapse persona+system into one message
- **Modify** `tests/copilot.test.ts` — replace persona-as-second-system tests with single-system tests covering both fields
- **Modify** `src/main/keyStore.ts` — add `getSessionContext` / `setSessionContext` / `SESSION_CONTEXT_MAX_CHARS`
- **Create** `tests/keyStore.test.ts` — roundtrip + cap + isolation tests for session context
- **Modify** `src/main/index.ts` — register `cfg:get-session-context` / `cfg:set-session-context` ipcMain handlers
- **Modify** `src/preload/overlay.ts` — expose `getSessionContext` / `setSessionContext` on `overlayBridge`
- **Modify** `src/preload/worker.ts` — expose `getSessionContext` on `workerBridge`
- **Modify** `src/renderer/overlay/index.html` — add `<textarea id="sessionContext">` inside `#lines`
- **Modify** `src/renderer/overlay/style.css` — style the textarea to fill captions area
- **Modify** `src/renderer/overlay/main.ts` — load/save value, debounced input handler, visibility toggle on state
- **Modify** `src/renderer/worker/main.ts` — fetch session context per turn, pass into `buildCopilotMessages`

---

## Task 1: Refactor `buildCopilotMessages` to a single system message

Per the spec, persona + session context fold into one system message rather than separate blocks. This task changes the function signature and the assembly logic, and rewrites the tests.

**Files:**
- Modify: `src/core/copilot.ts`
- Test: `tests/copilot.test.ts`

- [ ] **Step 1: Update existing copilot tests to assert the new single-system-message shape**

Replace the contents of `tests/copilot.test.ts`'s `describe("buildCopilotMessages", ...)` block with the cases below. Leave the `streamCopilot` describe block untouched.

```ts
describe("buildCopilotMessages", () => {
  it("returns one system + one user message when persona and sessionContext are empty", () => {
    const ms = buildCopilotMessages("hello world");
    expect(ms).toHaveLength(2);
    expect(ms[0].role).toBe("system");
    expect(ms[0].content).toBe(COPILOT_SYSTEM_PROMPT);
    expect(ms[1].role).toBe("user");
    expect(ms[1].content).toContain("hello world");
    expect(ms[1].content).toContain("other side just finished");
  });

  it("falls back to a placeholder when context is blank", () => {
    const ms = buildCopilotMessages("   ");
    expect(ms[1].content).toContain("(no prior speech)");
  });

  it("injects prior replies and a build-on instruction when provided", () => {
    const ms = buildCopilotMessages("new turn", [
      "First suggested reply.",
      "Second suggested reply.",
    ]);
    expect(ms[1].content).toContain("Your previous suggested replies");
    expect(ms[1].content).toContain("1. First suggested reply.");
    expect(ms[1].content).toContain("2. Second suggested reply.");
    expect(ms[1].content).toContain("build on them");
  });

  it("omits the prior-replies block when list is empty", () => {
    const ms = buildCopilotMessages("just context");
    expect(ms[1].content).not.toContain("Your previous suggested replies");
    expect(ms[1].content).not.toContain("build on them");
  });

  it("merges persona into the single system message under an 'About you' label", () => {
    const ms = buildCopilotMessages("ctx", [], "I'm Borislav, staff engineer at Polaro.");
    expect(ms).toHaveLength(2);
    expect(ms[0].role).toBe("system");
    expect(ms[0].content).toContain(COPILOT_SYSTEM_PROMPT);
    expect(ms[0].content).toContain("About you");
    expect(ms[0].content).toContain("Borislav");
    expect(ms[1].role).toBe("user");
  });

  it("merges sessionContext into the single system message under a 'This session' label", () => {
    const ms = buildCopilotMessages("ctx", [], "", "Stripe SRE interview, focus on incident response.");
    expect(ms).toHaveLength(2);
    expect(ms[0].role).toBe("system");
    expect(ms[0].content).toContain(COPILOT_SYSTEM_PROMPT);
    expect(ms[0].content).toContain("This session");
    expect(ms[0].content).toContain("Stripe SRE interview");
    expect(ms[0].content).not.toContain("About you");
    expect(ms[1].role).toBe("user");
  });

  it("merges both persona and sessionContext into the system message in order", () => {
    const ms = buildCopilotMessages(
      "ctx",
      [],
      "I'm Borislav.",
      "Stripe interview today.",
    );
    expect(ms).toHaveLength(2);
    const sys = ms[0].content;
    expect(sys).toContain(COPILOT_SYSTEM_PROMPT);
    const aboutIdx = sys.indexOf("About you");
    const sessionIdx = sys.indexOf("This session");
    expect(aboutIdx).toBeGreaterThan(-1);
    expect(sessionIdx).toBeGreaterThan(-1);
    expect(aboutIdx).toBeLessThan(sessionIdx);
  });

  it("treats whitespace-only persona / sessionContext as empty", () => {
    const ms = buildCopilotMessages("ctx", [], "   ", "\n\t  ");
    expect(ms).toHaveLength(2);
    expect(ms[0].content).toBe(COPILOT_SYSTEM_PROMPT);
  });

  it("returns exactly one system message regardless of persona/sessionContext", () => {
    const ms = buildCopilotMessages("ctx", [], "p", "s");
    expect(ms.filter((m) => m.role === "system")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the updated tests and confirm they fail**

Run: `npx vitest run tests/copilot.test.ts -t "buildCopilotMessages"`
Expected: failures (existing implementation still produces a separate persona system message).

- [ ] **Step 3: Refactor `buildCopilotMessages` in `src/core/copilot.ts`**

Replace the existing `buildCopilotMessages` function (lines 139–182) with:

```ts
/**
 * Build the messages array for a single turn.
 * - `context` is the last ~60 s of committed transcript text.
 * - `priorReplies` are recent copilot answers (most recent last) so the model
 *   can build on or pivot from its earlier suggestions.
 * - `persona` is durable info about the user (speaks as them).
 * - `sessionContext` is per-session framing the user types before recording.
 *
 * Persona and sessionContext fold into the single system message so the model
 * sees one coherent frame rather than three separate system blocks.
 */
export function buildCopilotMessages(
  context: string,
  priorReplies: string[] = [],
  persona = "",
  sessionContext = "",
): ChatMessage[] {
  const trimmed = context.trim();
  const ctx = trimmed || "(no prior speech)";
  const priors = priorReplies
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  const priorsBlock = priors.length
    ? "\n\nYour previous suggested replies to this conversation " +
      "(most recent last):\n" +
      priors.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "";
  const priorsInstruction = priors.length
    ? " Don't repeat those previous suggestions verbatim — build on them, " +
      "go deeper, or pivot if the topic moved on."
    : "";

  const personaTrimmed = persona.trim();
  const sessionTrimmed = sessionContext.trim();
  const sysParts: string[] = [COPILOT_SYSTEM_PROMPT];
  if (personaTrimmed) {
    sysParts.push(
      "About you (the user — you are speaking AS this person; use this to " +
        "ground specifics, names, experience, and tone, but never mention " +
        "that you were briefed):\n\n" +
        personaTrimmed,
    );
  }
  if (sessionTrimmed) {
    sysParts.push(
      "This session (the framing the user just typed in before recording — " +
        "use it to anchor what the conversation is about and what matters):" +
        "\n\n" +
        sessionTrimmed,
    );
  }
  const systemContent = sysParts.join("\n\n");

  return [
    { role: "system", content: systemContent },
    {
      role: "user",
      content:
        `Recent conversation (older first, most recent last):\n\n${ctx}` +
        `${priorsBlock}\n\n` +
        `The other side just finished their turn. Reply as me.${priorsInstruction}`,
    },
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/copilot.test.ts`
Expected: all pass (both `buildCopilotMessages` and `streamCopilot` suites).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: pass. Callers of `buildCopilotMessages` that used positional `persona` still work; `sessionContext` is an optional fourth argument.

- [ ] **Step 6: Commit**

```bash
git add src/core/copilot.ts tests/copilot.test.ts
git commit -m "refactor(copilot): merge persona and add sessionContext into single system message"
```

---

## Task 2: Persistence helpers in `keyStore.ts`

**Files:**
- Modify: `src/main/keyStore.ts`
- Create: `tests/keyStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/keyStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Stub Electron before importing keyStore. keyStore reads userData via
// app.getPath at call time, so each test points it at an isolated tmp dir.
let userDataDir = "";
vi.mock("electron", () => ({
  app: { getPath: (_: string) => userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, "utf8"),
    decryptString: (b: Buffer) => b.toString("utf8"),
  },
}));

// Import AFTER the mock so the module picks up the stubbed `app`.
import {
  getSessionContext,
  setSessionContext,
  getPersona,
  setPersona,
  SESSION_CONTEXT_MAX_CHARS,
} from "../src/main/keyStore.js";

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), "ghst-keystore-test-"));
  return () => {
    rmSync(userDataDir, { recursive: true, force: true });
  };
});

describe("session context persistence", () => {
  it("returns empty string when unset", () => {
    expect(getSessionContext()).toBe("");
  });

  it("roundtrips a value through disk", () => {
    setSessionContext("Stripe SRE interview");
    expect(getSessionContext()).toBe("Stripe SRE interview");
    const onDisk = JSON.parse(
      readFileSync(join(userDataDir, "config.json"), "utf8"),
    );
    expect(onDisk.sessionContext).toBe("Stripe SRE interview");
  });

  it("trims surrounding whitespace", () => {
    setSessionContext("   demo for Acme   \n");
    expect(getSessionContext()).toBe("demo for Acme");
  });

  it("truncates beyond SESSION_CONTEXT_MAX_CHARS", () => {
    const long = "x".repeat(SESSION_CONTEXT_MAX_CHARS + 500);
    setSessionContext(long);
    expect(getSessionContext().length).toBe(SESSION_CONTEXT_MAX_CHARS);
  });

  it("removes the key from config.json when set to empty", () => {
    setSessionContext("hello");
    setSessionContext("");
    const onDisk = JSON.parse(
      readFileSync(join(userDataDir, "config.json"), "utf8"),
    );
    expect(onDisk.sessionContext).toBeUndefined();
  });

  it("does not disturb persona when written", () => {
    setPersona("I'm Borislav.");
    setSessionContext("Stripe interview");
    expect(getPersona()).toBe("I'm Borislav.");
    expect(getSessionContext()).toBe("Stripe interview");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/keyStore.test.ts`
Expected: import errors / failures (`getSessionContext`, `setSessionContext`, `SESSION_CONTEXT_MAX_CHARS` are not exported).

- [ ] **Step 3: Add the helpers to `src/main/keyStore.ts`**

In `src/main/keyStore.ts`:

3a. Extend the `Stored` type (currently lines 10–14) to include `sessionContext`:

```ts
type Stored = {
  groqKeyEnc?: string;
  transcripts?: TranscriptSettings;
  persona?: string;
  sessionContext?: string;
};
```

3b. Add a constant near `PERSONA_MAX_CHARS` (currently line 18):

```ts
/** Hard cap on session context length, same rationale as PERSONA_MAX_CHARS. */
export const SESSION_CONTEXT_MAX_CHARS = 4000;
```

3c. Append two new exported functions after `setPersona` (currently around line 100), mirroring the persona helpers exactly:

```ts
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/keyStore.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Run full test + typecheck**

Run: `npm test && npm run typecheck`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/keyStore.ts tests/keyStore.test.ts
git commit -m "feat(keystore): persist session context"
```

---

## Task 3: IPC handlers in main process

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Import the new helpers**

In `src/main/index.ts`, find the existing keyStore import block (around lines 10–18) that imports `getPersona, setPersona`. Add `getSessionContext, setSessionContext` to the same import:

```ts
import {
  // ...existing...
  getPersona,
  setPersona,
  getSessionContext,
  setSessionContext,
} from "./keyStore.js";
```

- [ ] **Step 2: Register ipcMain handlers**

Locate the persona handler block (around lines 218–225). Immediately after it, add:

```ts
ipcMain.handle("cfg:get-session-context", () => getSessionContext());
ipcMain.handle("cfg:set-session-context", (_e, text: string) => {
  try {
    return { ok: true as const, value: setSessionContext(text) };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
});
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): ipc handlers for session context"
```

---

## Task 4: Preload bridges

**Files:**
- Modify: `src/preload/overlay.ts`
- Modify: `src/preload/worker.ts`

- [ ] **Step 1: Expose getSessionContext / setSessionContext on overlayBridge**

In `src/preload/overlay.ts`, append two methods to the `overlayBridge` object, right after the existing `setPersona` entry:

```ts
getSessionContext: (): Promise<string> =>
  ipcRenderer.invoke("cfg:get-session-context"),
setSessionContext: (
  text: string,
): Promise<{ ok: true; value: string } | { ok: false; error: string }> =>
  ipcRenderer.invoke("cfg:set-session-context", text),
```

- [ ] **Step 2: Expose getSessionContext on workerBridge**

In `src/preload/worker.ts`, append after the existing `getPersona` entry:

```ts
getSessionContext: (): Promise<string> =>
  ipcRenderer.invoke("cfg:get-session-context"),
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/preload/overlay.ts src/preload/worker.ts
git commit -m "feat(preload): bridge methods for session context"
```

---

## Task 5: Worker passes session context into copilot prompt

**Files:**
- Modify: `src/renderer/worker/main.ts`

- [ ] **Step 1: Fetch session context per turn alongside persona**

In `src/renderer/worker/main.ts`, find the persona-fetch block (lines 401–404):

```ts
// Pulled fresh each run so persona edits in Settings take effect
// across an in-progress session without restart.
const persona = await bridge.getPersona().catch(() => "");
const messages = buildCopilotMessages(context, priorReplies, persona);
```

Replace with:

```ts
// Pulled fresh each run so persona / session-context edits take effect
// across an in-progress session without restart.
const [persona, sessionContext] = await Promise.all([
  bridge.getPersona().catch(() => ""),
  bridge.getSessionContext().catch(() => ""),
]);
const messages = buildCopilotMessages(context, priorReplies, persona, sessionContext);
```

- [ ] **Step 2: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/worker/main.ts
git commit -m "feat(worker): inject session context into copilot prompt"
```

---

## Task 6: Overlay HTML — add the textarea

**Files:**
- Modify: `src/renderer/overlay/index.html`

- [ ] **Step 1: Add the textarea inside `#lines`**

In `src/renderer/overlay/index.html`, locate the `#lines` element (around lines 129–134):

```html
<div class="chat__scroll" id="lines" role="log" aria-live="polite">
  <div class="stream__hint" id="hint">
    Press <kbd>⌃</kbd><kbd>⇧</kbd><kbd>␣</kbd> to listen &nbsp;·&nbsp;
    whatever your speakers play, <em>ghst</em> hears.
  </div>
</div>
```

Replace with:

```html
<div class="chat__scroll" id="lines" role="log" aria-live="polite">
  <div class="stream__hint" id="hint">
    Press <kbd>⌃</kbd><kbd>⇧</kbd><kbd>␣</kbd> to listen &nbsp;·&nbsp;
    whatever your speakers play, <em>ghst</em> hears.
  </div>
  <textarea
    class="session-context"
    id="sessionContext"
    spellcheck="false"
    maxlength="4000"
    placeholder="What's this session? (e.g., 'Stripe SRE interview, focus on incident response')"
    hidden
  ></textarea>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/overlay/index.html
git commit -m "feat(overlay): session context textarea markup"
```

---

## Task 7: Overlay CSS — style the textarea

**Files:**
- Modify: `src/renderer/overlay/style.css`

- [ ] **Step 1: Inspect existing patterns**

Open `src/renderer/overlay/style.css` and locate the `.chat__scroll` / `.stream__hint` / `.settings__textarea` rules to match typography (font family, size, color, padding) and the overlay's transparent aesthetic.

- [ ] **Step 2: Append session-context styles**

Add at the end of `src/renderer/overlay/style.css`:

```css
.session-context {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 120px;
  box-sizing: border-box;
  padding: 12px 14px;
  background: transparent;
  border: 0;
  outline: none;
  resize: none;
  color: inherit;
  font: inherit;
  line-height: 1.5;
  letter-spacing: inherit;
}

.session-context::placeholder {
  color: currentColor;
  opacity: 0.45;
  font-style: italic;
}

.session-context[hidden] {
  display: none;
}
```

If the existing `.stream__hint` rules use a specific font-family / color that differs from `inherit`, mirror those values explicitly here so the textarea matches the hint's typographic feel.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/overlay/style.css
git commit -m "feat(overlay): style session context textarea"
```

---

## Task 8: Overlay TS — wire load, save, and visibility

**Files:**
- Modify: `src/preload/overlay.ts` (add bridge type if needed — already done in Task 4)
- Modify: `src/renderer/overlay/main.ts`

- [ ] **Step 1: Grab the textarea element near the top-of-file DOM lookups**

In `src/renderer/overlay/main.ts`, locate the existing element lookups (lines 5–16). Add at the end of that block:

```ts
const sessionContextEl = document.getElementById("sessionContext") as HTMLTextAreaElement;
```

- [ ] **Step 2: Add a debounced save helper**

Insert this block immediately above the `// ─── hint ───…` divider (around line 25):

```ts
// ─── session context ────────────────────────────────────────────────────────
let sessionContextSaveTimer: ReturnType<typeof setTimeout> | null = null;
const SESSION_CONTEXT_DEBOUNCE_MS = 400;

function flushSessionContextSave(): void {
  if (sessionContextSaveTimer === null) return;
  clearTimeout(sessionContextSaveTimer);
  sessionContextSaveTimer = null;
  void bridge.setSessionContext(sessionContextEl.value);
}

function scheduleSessionContextSave(): void {
  if (sessionContextSaveTimer !== null) clearTimeout(sessionContextSaveTimer);
  sessionContextSaveTimer = setTimeout(() => {
    sessionContextSaveTimer = null;
    void bridge.setSessionContext(sessionContextEl.value);
  }, SESSION_CONTEXT_DEBOUNCE_MS);
}

function updateSessionContextVisibility(): void {
  // Show the textarea only when not actively listening; during a recording
  // the captions list owns the area.
  const showTextarea = state !== "listening";
  sessionContextEl.hidden = !showTextarea;
  // Hint sits inside the same scroll container; only show it when textarea
  // is hidden AND there are no messages (preserves the original "press X to
  // listen" affordance during a session).
  if (showTextarea) {
    hint.hidden = true;
  } else {
    updateHint();
  }
}

sessionContextEl.addEventListener("input", scheduleSessionContextSave);
sessionContextEl.addEventListener("blur", flushSessionContextSave);

void bridge.getSessionContext().then((v) => {
  sessionContextEl.value = v;
});
```

Note: `state` is declared at line 22 as `let state: "idle" | "listening" | "error" = "idle";`, so referencing it from this block is fine — module scope.

- [ ] **Step 3: Hook `setState` to toggle visibility**

Locate `setState` (around lines 153–160):

```ts
function setState(next: typeof state, error?: string): void {
  state = next;
  lastError = error;
  pod.dataset.state = next;
  statusLabel.textContent =
    next === "listening" ? "rec" : next === "error" ? "err" : "idle";
  updateHint();
}
```

Replace with:

```ts
function setState(next: typeof state, error?: string): void {
  // If we're about to start listening, flush any pending unsaved typing
  // synchronously so it doesn't get lost as we hide the textarea.
  if (next === "listening" && state !== "listening") {
    flushSessionContextSave();
  }
  state = next;
  lastError = error;
  pod.dataset.state = next;
  statusLabel.textContent =
    next === "listening" ? "rec" : next === "error" ? "err" : "idle";
  updateHint();
  updateSessionContextVisibility();
}
```

- [ ] **Step 4: Initial visibility on load**

At the very bottom of the file, immediately after the existing `updateHint();` call (line 432), add:

```ts
updateSessionContextVisibility();
```

- [ ] **Step 5: Make `updateHint` a no-op when textarea is showing**

In `updateHint` (around lines 26–42), at the top of the function add an early bail so we don't fight `updateSessionContextVisibility`:

```ts
function updateHint(): void {
  // When the session-context textarea is shown, the hint stays hidden —
  // the textarea owns the captions area while idle.
  if (sessionContextEl && !sessionContextEl.hidden) {
    hint.hidden = true;
    return;
  }
  if (messages.length > 0) {
    hint.hidden = true;
    return;
  }
  // …rest unchanged…
```

(Keep the rest of the existing function body intact.)

- [ ] **Step 6: Add type signatures to the bridge declarations**

Bridge types live in `src/preload/types.d.ts`. In the `overlayBridge` block (around line 20–44), append before the closing `};`:

```ts
getSessionContext: () => Promise<string>;
setSessionContext: (
  text: string,
) => Promise<{ ok: true; value: string } | { ok: false; error: string }>;
```

In the `workerBridge` block (lines 11–19), append before the closing `};`:

```ts
getSessionContext: () => Promise<string>;
```

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 8: Manual smoke test**

Run: `npm run dev`

Verify:
- Overlay opens with an empty textarea where the hint used to be (hint hidden).
- Type "Stripe SRE interview". Wait ~1s. Reload overlay (Ctrl+R in DevTools, or restart app); textarea should re-populate with the typed text.
- Press Ctrl+Shift+Space to start listening. Textarea hides, captions/hint appear.
- Press Ctrl+Shift+Space again to stop. Textarea reappears with the previous text.
- Trigger a copilot reply (Ctrl+Shift+Enter while listening, or after a turn ends). Confirm in DevTools console / logs that the reply incorporates the session context.

- [ ] **Step 9: Run full test suite**

Run: `npm test && npm run typecheck`
Expected: pass.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/overlay/main.ts src/preload/overlay.ts
git commit -m "feat(overlay): session context input replaces captions when idle"
```

---

## Task 9: Final verification

- [ ] **Step 1: Re-run everything**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green.

- [ ] **Step 2: Manual end-to-end check**

Launch via `npm run dev`. With a real Groq key configured:
1. Type a session context like "Practicing system-design answers, target a senior backend role".
2. Start listening and play a short audio clip with a question (e.g., "Tell me how you'd design a URL shortener").
3. Stop listening. Verify the copilot reply visibly reflects the framing.
4. Clear the textarea. Repeat the audio. Verify the reply no longer carries that framing.

- [ ] **Step 3: Note any deviations from the spec**

If any behavior differs from `docs/superpowers/specs/2026-04-25-session-context-design.md`, either correct the code or amend the spec with a follow-up commit explaining the change.
