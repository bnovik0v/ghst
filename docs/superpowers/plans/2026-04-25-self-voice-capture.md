# Self-voice capture (dual-speaker transcript) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the user's microphone in parallel with the existing sink-monitor stream, producing a chronologically-merged, speaker-tagged transcript that is saved to disk, fed to the copilot, and shown in the overlay (subtle running line for self).

**Architecture:** A second, simpler audio pipeline runs in the same hidden worker renderer. It uses `getUserMedia({ echoCancellation: true })` and a second `MicVAD` instance that consumes the resulting `MediaStream` directly (no AudioWorklet shim — that exists only because the "them" path receives PCM via IPC). Speech segments are transcribed with a single Whisper call on `onSpeechEnd` (no live tick / no `LocalAgreement` for self — keeps complexity low). Each transcript line carries a `speaker: "self" | "them"` tag that flows through types, the writer, the overlay, and the copilot context.

**Tech Stack:** TypeScript, Electron (main + two renderers), `@ricky0123/vad-web` (Silero VAD), Web Audio `getUserMedia`, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-25-self-voice-capture-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/core/types.ts` | modify | Add `Speaker` type and `speaker` field on `TranscriptLine` |
| `src/core/transcript.ts` | modify | `TranscriptManager.add(text, speaker)`; record speaker on lines |
| `src/core/transcriptFormat.ts` | modify | Render `[HH:MM:SS] You: …` / `[HH:MM:SS] Them: …` |
| `src/main/transcriptWriter.ts` | modify | Thread speaker through to `SessionLine` |
| `src/core/copilot.ts` | modify | One-sentence addition to `COPILOT_SYSTEM_PROMPT` |
| `src/renderer/worker/main.ts` | modify | Tag existing emits with `speaker: "them"`; add self-pipeline; speaker-labeled copilot context |
| `src/renderer/overlay/index.html` | modify | Add `<div id="selfLine" class="self-line" hidden></div>` |
| `src/renderer/overlay/style.css` | modify | `.self-line` style (dimmed, single line, smaller font) |
| `src/renderer/overlay/main.ts` | modify | Route `transcript` events by speaker; render self on `.self-line` |
| `tests/transcript.test.ts` | modify | Tests for speaker tag round-trip |
| `tests/transcriptFormat.test.ts` | modify | Tests for `You:`/`Them:` formatting |
| `tests/transcriptWriter.test.ts` | modify | Test that speaker propagates to file |
| `tests/copilot.test.ts` | modify | Test for system prompt sentence |

---

## Task 1: Add `Speaker` type and `speaker` field on `TranscriptLine`

**Files:**
- Modify: `src/core/types.ts`

- [ ] **Step 1: Update types**

Replace the contents of `src/core/types.ts` with:

```ts
export type Speaker = "self" | "them";

export type TranscriptLine = {
  id: string;
  text: string;
  receivedAt: number;
  speaker: Speaker;
};

export type WorkerStatus = "idle" | "listening" | "error";

export type IPCFromWorker =
  | { kind: "transcript"; line: TranscriptLine }
  | { kind: "status"; status: WorkerStatus; error?: string }
  | { kind: "live"; committed: string; tentative: string }
  | { kind: "card:start"; id: string; ts: number }
  | { kind: "card:delta"; id: string; delta: string }
  | { kind: "card:done"; id: string }
  | { kind: "card:error"; id: string; msg: string };

export type IPCToWorker =
  | { kind: "start" }
  | { kind: "stop" }
  | { kind: "card:dismiss"; id: string }
  | { kind: "copilot:trigger" }
  | { kind: "clear-context" };
```

Note: `live` is intentionally NOT given a `speaker` field — only the "them" pipeline produces live captions; self uses single-shot finalize only.

- [ ] **Step 2: Run typecheck — expect failures**

Run: `npm run typecheck`
Expected: errors in `src/core/transcript.ts` (TranscriptManager.add doesn't set `speaker`), `src/main/transcriptWriter.ts` (consumes line), `src/renderer/worker/main.ts` (constructs lines indirectly). These are fixed in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(types): add Speaker tag to TranscriptLine"
```

---

## Task 2: Thread speaker through `TranscriptManager`

**Files:**
- Modify: `src/core/transcript.ts`
- Test: `tests/transcript.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/transcript.test.ts` inside the `describe("TranscriptManager", …)` block (or add a new describe at the bottom of the file):

```ts
describe("TranscriptManager speaker tagging", () => {
  it("records the speaker on added lines", () => {
    const tm = new TranscriptManager();
    const a = tm.add("hello there", "them");
    const b = tm.add("hi back", "self");
    expect(a?.speaker).toBe("them");
    expect(b?.speaker).toBe("self");
  });

  it("preserves speaker through recent()", () => {
    const tm = new TranscriptManager();
    tm.add("a", "them");
    tm.add("b", "self");
    const recent = tm.recent(2);
    expect(recent.map((l) => l.speaker)).toEqual(["them", "self"]);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

Run: `npx vitest run tests/transcript.test.ts -t "speaker tagging"`
Expected: TS error / runtime failure — `add` doesn't accept speaker.

- [ ] **Step 3: Update `TranscriptManager.add`**

In `src/core/transcript.ts`, change the `add` signature and body:

```ts
import type { Speaker, TranscriptLine } from "./types.js";

// …

add(text: string, speaker: Speaker): TranscriptLine | null {
  if (isLikelyHallucination(text)) return null;
  const line: TranscriptLine = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: text.trim(),
    receivedAt: Date.now(),
    speaker,
  };
  this.lines.push(line);
  if (this.lines.length > this.maxLines) this.lines.shift();
  return line;
}
```

Also update the existing tests in `tests/transcript.test.ts` that currently call `tm.add("…")` without a speaker — pass `"them"` as the second argument so existing behaviour is preserved.

- [ ] **Step 4: Run all transcript tests**

Run: `npx vitest run tests/transcript.test.ts`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/core/transcript.ts tests/transcript.test.ts
git commit -m "feat(transcript): add speaker arg to TranscriptManager.add"
```

---

## Task 3: Speaker-labeled disk transcript format

**Files:**
- Modify: `src/core/transcriptFormat.ts`
- Test: `tests/transcriptFormat.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/transcriptFormat.test.ts`:

```ts
import { formatTranscriptBody } from "../src/core/transcriptFormat.js";

describe("formatTranscriptBody with speakers", () => {
  it("prefixes each line with You:/Them: based on speaker", () => {
    const start = new Date(2026, 3, 25, 14, 7, 0).getTime();
    const lines = [
      { ts: new Date(2026, 3, 25, 14, 7, 1).getTime(), text: "hello", speaker: "them" as const },
      { ts: new Date(2026, 3, 25, 14, 7, 2).getTime(), text: "hi", speaker: "self" as const },
    ];
    const body = formatTranscriptBody(start, lines);
    expect(body).toContain("[14:07:01] Them: hello");
    expect(body).toContain("[14:07:02] You: hi");
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npx vitest run tests/transcriptFormat.test.ts -t "with speakers"`
Expected: TS error — `SessionLine` lacks `speaker`.

- [ ] **Step 3: Update `transcriptFormat.ts`**

In `src/core/transcriptFormat.ts`:

```ts
import type { Speaker } from "./types.js";

export type SessionLine = { ts: number; text: string; speaker: Speaker };

// keep formatClock / formatFilenameStamp / transcriptFilename / formatHeader unchanged

export function formatTranscriptBody(startedAt: number, lines: SessionLine[]): string {
  return (
    `${formatHeader(startedAt)}\n\n` +
    lines
      .map((l) => `[${formatClock(l.ts)}] ${l.speaker === "self" ? "You" : "Them"}: ${l.text}`)
      .join("\n") +
    "\n"
  );
}
```

- [ ] **Step 4: Run all format tests**

Run: `npx vitest run tests/transcriptFormat.test.ts`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/core/transcriptFormat.ts tests/transcriptFormat.test.ts
git commit -m "feat(transcript-format): label disk lines as You/Them"
```

---

## Task 4: Thread speaker through `transcriptWriter`

**Files:**
- Modify: `src/main/transcriptWriter.ts`
- Test: `tests/transcriptWriter.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/transcriptWriter.test.ts` inside the existing top-level `describe`:

```ts
it("preserves speaker labels in the written file", () => {
  const dir = makeTmpDir();
  settingsRef.enabled = true;
  settingsRef.dir = dir;
  resetSession(Date.now());
  recordLine({
    id: "1", text: "hello", receivedAt: Date.now(), speaker: "them",
  });
  recordLine({
    id: "2", text: "hi", receivedAt: Date.now(), speaker: "self",
  });
  const file = flushSession();
  expect(file).not.toBeNull();
  const body = readFileSync(file as string, "utf8");
  expect(body).toMatch(/Them: hello/);
  expect(body).toMatch(/You: hi/);
});
```

(If existing tests in the file construct `TranscriptLine` literals without `speaker`, add `speaker: "them"` to them so they typecheck.)

- [ ] **Step 2: Run test — expect failure**

Run: `npx vitest run tests/transcriptWriter.test.ts`
Expected: failure on the new test — written file lacks `Them:`/`You:`.

- [ ] **Step 3: Update `transcriptWriter.ts`**

Change `recordLine` to copy the speaker into the session entry:

```ts
export function recordLine(line: TranscriptLine, now: number = Date.now()): void {
  if (!sessionStartedAt) sessionStartedAt = now;
  session.push({ ts: line.receivedAt, text: line.text, speaker: line.speaker });
}
```

- [ ] **Step 4: Run writer tests**

Run: `npx vitest run tests/transcriptWriter.test.ts`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/main/transcriptWriter.ts tests/transcriptWriter.test.ts
git commit -m "feat(transcript-writer): persist speaker labels"
```

---

## Task 5: Update copilot system prompt to acknowledge `You:`/`Them:` labels

**Files:**
- Modify: `src/core/copilot.ts`
- Test: `tests/copilot.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/copilot.test.ts`:

```ts
describe("COPILOT_SYSTEM_PROMPT", () => {
  it("explains the You:/Them: convention", () => {
    expect(COPILOT_SYSTEM_PROMPT).toMatch(/You:/);
    expect(COPILOT_SYSTEM_PROMPT).toMatch(/Them:/);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npx vitest run tests/copilot.test.ts -t "You:"`
Expected: failure.

- [ ] **Step 3: Update the system prompt**

In `src/core/copilot.ts`, append a new paragraph at the end of `COPILOT_SYSTEM_PROMPT` (before the closing backtick), matching the existing prose style:

```
TRANSCRIPT FORMAT: lines are tagged "Them:" (the other side, what you primarily
react to) and "You:" (what the user has already said this turn — do not repeat
those points back to them; build on them or move forward).
```

- [ ] **Step 4: Run all copilot tests**

Run: `npx vitest run tests/copilot.test.ts`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/core/copilot.ts tests/copilot.test.ts
git commit -m "feat(copilot): document You/Them transcript format in system prompt"
```

---

## Task 6: Tag existing "them" emits in worker

**Files:**
- Modify: `src/renderer/worker/main.ts`

This is a mechanical pass: every place the worker calls `transcripts.add(text)` or constructs a `TranscriptLine`, pass `"them"`. After this, the existing pipeline still works exactly as before, just with the speaker tag set.

- [ ] **Step 1: Update `transcripts.add` call sites**

In `src/renderer/worker/main.ts`:

- In `maybeSoftCommit()`:
  ```ts
  const line = transcripts.add(t, "them");
  ```
- In `finalize()`:
  ```ts
  const line = transcripts.add(final, "them");
  ```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes (worker no longer has missing-arg errors for these calls).

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/worker/main.ts
git commit -m "refactor(worker): tag existing pipeline as them-speaker"
```

---

## Task 7: Add the self-capture pipeline in the worker

**Files:**
- Modify: `src/renderer/worker/main.ts`

This adds a second VAD running on `getUserMedia` with AEC. It is intentionally simpler than the them-pipeline: no tick loop, no LocalAgreement, no live captions, no copilot trigger — just VAD → single Whisper call on `onSpeechEnd` → `transcripts.add(text, "self")` → emit.

- [ ] **Step 1: Add module-level state for self-pipeline**

Near the existing `let vad …` declarations in `src/renderer/worker/main.ts`, add:

```ts
let selfVad: Awaited<ReturnType<typeof MicVAD.new>> | null = null;
let selfMediaStream: MediaStream | null = null;
let selfNoticeShown = false;
```

- [ ] **Step 2: Add `startSelfCapture()` and `stopSelfCapture()` helpers**

Below `wirePcm()` and above the `// ─── Groq calls ───` divider, add:

```ts
async function transcribeSelfBuffer(audio: Float32Array): Promise<string> {
  if (audio.length < SR * 0.15) return "";
  const wav = encodeWav(audio, SR);
  const { text } = await transcribe(wav, {
    apiKey: groqKey,
    language: "en",
    // Self pipeline doesn't carry rolling prompt context — keeps it independent
    // and avoids cross-contamination from the them-side stream.
    temperature: 0,
  });
  return text.trim();
}

async function startSelfCapture(): Promise<void> {
  if (selfVad) return;
  try {
    selfMediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    debug("[ghst worker] self capture: getUserMedia denied:", err);
    if (!selfNoticeShown) {
      selfNoticeShown = true;
      bridge.emit({
        kind: "status",
        status: "listening",
        // Soft notice piggy-backs on the existing status channel so we don't
        // need a new IPC kind. The error field renders as a yellow hint;
        // the status itself stays "listening" so the app keeps running.
        error: "Mic unavailable — only the other side will be transcribed.",
      });
    }
    return;
  }

  // Per-utterance buffer: MicVAD already accumulates, but we read its
  // float32 audio in onSpeechEnd via the VAD's own callback signature.
  selfVad = await MicVAD.new({
    model: "v5",
    baseAssetPath: "/vad/",
    onnxWASMBasePath: "/vad/",
    positiveSpeechThreshold: 0.4,
    negativeSpeechThreshold: 0.3,
    minSpeechMs: 200,
    redemptionMs: 500,
    preSpeechPadMs: 200,
    getStream: async () => selfMediaStream!,
    pauseStream: async () => {},
    resumeStream: async (s) => s,
    onSpeechEnd: async (audio: Float32Array) => {
      try {
        const text = await transcribeSelfBuffer(audio);
        if (!text) return;
        if (isBackchannel(text)) {
          debug(`[ghst worker] self skipped backchannel: "${text}"`);
          return;
        }
        const line = transcripts.add(text, "self");
        if (line) bridge.emit({ kind: "transcript", line });
      } catch (err) {
        console.warn("[ghst self] transcribe error:", err);
      }
    },
  });
  selfVad.start();
  debug("[ghst worker] self capture started");
}

async function stopSelfCapture(): Promise<void> {
  selfVad?.destroy();
  selfVad = null;
  if (selfMediaStream) {
    for (const t of selfMediaStream.getTracks()) t.stop();
    selfMediaStream = null;
  }
  debug("[ghst worker] self capture stopped");
}
```

Note: this matches the existing them-pipeline's `getStream` callback shape so we don't depend on a different MicVAD API surface. The Silero ONNX assets are already loaded by the first `MicVAD.new` call; the second instance reuses the cached WASM/model.

- [ ] **Step 3: Wire into `start()` and `stop()`**

In `start()`, after `vad.start()` and before `bridge.emit({ kind: "status", status: "listening" })`, add:

```ts
await startSelfCapture();
```

(`startSelfCapture` swallows its own errors, so `start()` doesn't need a try/catch around it.)

In `stop()`, after `vad?.destroy(); vad = null;` and before `await bridge.stopCapture();`, add:

```ts
await stopSelfCapture();
```

- [ ] **Step 4: Typecheck and run tests**

Run: `npm run typecheck && npm test`
Expected: all green. (Pure-core tests won't exercise this code path; worker is not unit-tested.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/worker/main.ts
git commit -m "feat(worker): add self-capture pipeline via getUserMedia + AEC"
```

---

## Task 8: Speaker-labeled copilot context

**Files:**
- Modify: `src/renderer/worker/main.ts`

Currently `contextForCopilot()` returns a flat space-joined string of recent line texts. With two speakers, render each line as `You: …` / `Them: …` and join with newlines so the model sees clear turn structure. EOT detection should still only fire on `them` turns.

- [ ] **Step 1: Update `contextForCopilot()`**

Replace the current implementation in `src/renderer/worker/main.ts`:

```ts
function contextForCopilot(): string {
  const cutoff = Date.now() - COPILOT_CONTEXT_MS;
  const lines = transcripts
    .recent(50)
    .filter((l) => l.receivedAt >= cutoff)
    .map((l) => `${l.speaker === "self" ? "You" : "Them"}: ${l.text}`);
  // Include the in-progress (not-yet-committed) them-utterance so a manual ask
  // mid-speech has the freshest context available.
  const tail = lockedText.trim();
  if (tail) lines.push(`Them: ${tail}`);
  return lines.join("\n").trim();
}
```

- [ ] **Step 2: Restrict EOT trigger to `them` turns**

In `checkTurnEnd()`, replace:

```ts
const recent = transcripts.recent(1);
if (recent.length === 0) return;
const lastText = recent[0].text;
```

with:

```ts
// Only react to the OTHER side finishing — never auto-fire when the user
// just finished talking.
const recent = transcripts.recent(5).filter((l) => l.speaker === "them");
if (recent.length === 0) return;
const lastText = recent[recent.length - 1].text;
```

Also update `finalize()`'s EOT-arm line at the bottom — the existing code arms `lastSpeechEndAt` whenever the them-pipeline finalizes a real turn, which is correct. **Do NOT arm `lastSpeechEndAt` from the self pipeline.** (The `onSpeechEnd` we added in Task 7 doesn't touch `lastSpeechEndAt`, so this property holds — verify by re-reading the code after the edit.)

- [ ] **Step 3: Typecheck and run tests**

Run: `npm run typecheck && npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/worker/main.ts
git commit -m "feat(copilot): build context with You/Them labels, EOT only on them"
```

---

## Task 9: Overlay HTML/CSS for the self-line

**Files:**
- Modify: `src/renderer/overlay/index.html`
- Modify: `src/renderer/overlay/style.css`

- [ ] **Step 1: Add the DOM element**

In `src/renderer/overlay/index.html`, find the existing `liveBar` element. Immediately AFTER it (so visually it sits between the live caption and the cards / below the captions, depending on layout — adjust if the layout dictates), add:

```html
<div id="selfLine" class="self-line" hidden></div>
```

If you're unsure where it lives best, put it directly above the `cardsEl` wrapper. The exact position is a tweak the user can validate in manual testing.

- [ ] **Step 2: Add CSS**

Append to `src/renderer/overlay/style.css`:

```css
.self-line {
  font-size: 0.85em;
  opacity: 0.6;
  font-style: italic;
  padding: 4px 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* "Running line" — single line only, no wrap, no scroll. */
}

.self-line::before {
  content: "You: ";
  opacity: 0.7;
  font-style: normal;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/overlay/index.html src/renderer/overlay/style.css
git commit -m "feat(overlay): add dimmed self-line element + style"
```

---

## Task 10: Route transcript events by speaker in the overlay

**Files:**
- Modify: `src/renderer/overlay/main.ts`

- [ ] **Step 1: Grab the new element and route events**

Near the top of `src/renderer/overlay/main.ts`, after the existing `cardsEl` declaration, add:

```ts
const selfLine = document.getElementById("selfLine") as HTMLDivElement;

function updateSelfLine(text: string): void {
  if (!text) {
    selfLine.hidden = true;
    selfLine.textContent = "";
    return;
  }
  selfLine.hidden = false;
  selfLine.textContent = text;
}
```

In the `bridge.onEvent(...)` handler, change the `transcript` branch from:

```ts
if (msg.kind === "transcript") {
  appendMessage({ text: msg.line.text, ts: msg.line.receivedAt });
  clearLive();
}
```

to:

```ts
if (msg.kind === "transcript") {
  if (msg.line.speaker === "self") {
    updateSelfLine(msg.line.text);
  } else {
    appendMessage({ text: msg.line.text, ts: msg.line.receivedAt });
    clearLive();
  }
}
```

Also update `clearMessages()` (called by `clearAll`) to also clear the self-line:

```ts
function clearMessages(): void {
  messages.length = 0;
  scroll.querySelectorAll(".message").forEach((el) => el.remove());
  updateSelfLine("");
  updateHint();
}
```

And update the status `"idle"` branch — when listening stops, the self-line should clear so it doesn't show stale text:

```ts
} else if (msg.kind === "status") {
  setState(msg.status, msg.error);
  if (msg.status === "idle") {
    clearCards();
    updateSelfLine("");
  }
}
```

- [ ] **Step 2: Typecheck and run tests**

Run: `npm run typecheck && npm test`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/overlay/main.ts
git commit -m "feat(overlay): render self transcripts on the running line"
```

---

## Task 11: Final verification

- [ ] **Step 1: Full typecheck + test run**

Run: `npm run typecheck && npm test`
Expected: typecheck passes; all tests green (60 baseline + new tests added in tasks 2/3/4/5).

- [ ] **Step 2: Manual smoke checklist**

Document this on the PR but don't gate the plan on it (no automation):

1. Launch with `npm run dev`. Confirm the OS mic indicator appears when listening starts and disappears when stopped.
2. With **headphones**: speak a sentence; confirm a `You:` line appears in the saved transcript file (Settings → transcripts directory) and on the running line in the overlay; confirm Them captions still flow normally when the other side speaks.
3. With **speakers**: confirm the user's voice does NOT cause duplicate `Them:` re-transcriptions thanks to AEC. Some bleed at very high volume is acceptable.
4. With **mic permission denied**: deny mic in Chromium permissions and start listening; confirm the overlay shows the one-time soft notice and the them-pipeline still works.
5. Trigger the copilot (`Ctrl+Shift+Enter`) after a Them turn that follows a You turn; confirm the suggestion does not repeat what You just said.

- [ ] **Step 3: Commit (if any tweaks)**

If manual testing surfaces tweaks, commit them with appropriate `fix:` / `chore:` prefix and re-run typecheck + tests.
