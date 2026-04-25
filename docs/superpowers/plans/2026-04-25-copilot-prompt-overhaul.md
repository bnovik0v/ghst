# Copilot Prompt Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prose copilot prompt with an XML-tagged, mode-aware (meeting/interview), cache-friendly prompt; interleave prior copilot suggestions into the transcript timeline; switch transcript eviction to entry-count with a configurable N; expose mode + interview fields + N in settings.

**Architecture:** Two messages — a layered system message (rules/anti-patterns/output-format → persona → session/interview fields) and a user message containing an interleaved `<conversation>` plus a fixed trigger sentence. `TranscriptManager` stores `Them:` entries with optional `suggestion` strings, evicts by entry count. `buildCopilotMessages` takes a structured timeline + mode + optional interview block.

**Tech Stack:** TypeScript, Electron 3-process, Vitest, Groq SDK over `fetch`, `electron.safeStorage` for secrets, plain JSON config in `userData/config.json`.

**Spec:** `docs/superpowers/specs/2026-04-25-copilot-prompt-overhaul-design.md`

---

## File Structure

**New files:** none. All changes land in existing files.

**Modified files:**

- `src/core/types.ts` — add `CopilotMode`, `TranscriptEntry`, extend `TranscriptLine` with optional `suggestion`. New IPC kinds for config propagation if needed (we keep it simple — worker fetches values lazily like it does today for persona).
- `src/core/transcript.ts` — extend `TranscriptManager` with `attachSuggestion(text)` and `getTimeline(): TranscriptEntry[]`. Eviction stays `maxLines` (already entry-count); plumb a configurable N from main.
- `src/core/copilot.ts` — rewrite `COPILOT_SYSTEM_PROMPT` as two constants `MEETING_SYSTEM_PROMPT` / `INTERVIEW_SYSTEM_PROMPT`, both XML-tagged. Rewrite `buildCopilotMessages` to accept a structured input.
- `src/main/keyStore.ts` — extend `Stored` with `mode`, `interview` (`{ role, company, jobDescription }`), `transcriptN`. Add getter/setter helpers.
- `src/main/index.ts` — register IPC handlers `cfg:get-mode` / `cfg:set-mode`, `cfg:get-interview` / `cfg:set-interview`, `cfg:get-transcript-n` / `cfg:set-transcript-n`.
- `src/preload/overlay.ts`, `src/preload/worker.ts`, `src/preload/types.d.ts` — expose the new IPC channels.
- `src/renderer/worker/main.ts` — replace the `priorReplies: string[]` ring with `transcripts.attachSuggestion(...)`, call new `buildCopilotMessages` with `getTimeline()` + mode + interview + manualTrigger, fetch mode/interview/N lazily like persona.
- `src/renderer/overlay/main.ts`, `src/renderer/overlay/style.css` — settings panel: mode segmented control, interview-only fields, transcript-size number input.
- `tests/copilot.test.ts` — replace old buildCopilotMessages tests with new shape; add cases for both modes, structured fields, interleaved timeline, manual trigger.
- `tests/transcript.test.ts` — add cases for `attachSuggestion`, `getTimeline`, suggestion eviction with parent.
- `tests/keyStore.test.ts` — add cases for new getters/setters.

---

## Task 1: Add new types in `src/core/types.ts`

**Files:**
- Modify: `src/core/types.ts`

- [ ] **Step 1: Edit the types file**

Replace the contents of `src/core/types.ts` with:

```ts
export type Speaker = "self" | "them";

export type CopilotMode = "meeting" | "interview";

export type InterviewContext = {
  role?: string;
  company?: string;
  jobDescription?: string;
};

export type TranscriptLine = {
  id: string;
  text: string;
  receivedAt: number;
  speaker: Speaker;
  /** Copilot reply that was generated in response to this line, if any.
   *  Only meaningful when `speaker === "them"`. */
  suggestion?: string;
};

/** Flattened view of the transcript window for prompt building. Each entry is
 *  one renderable line. `suggested` entries appear immediately after the
 *  `them` entry that produced them. */
export type TranscriptEntry =
  | { kind: "them"; text: string }
  | { kind: "you"; text: string }
  | { kind: "suggested"; text: string };

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

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (some downstream files will break in later tasks; if any break here, the change to `TranscriptLine.suggestion` should be backwards compatible since it's optional).

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(types): add CopilotMode, InterviewContext, TranscriptEntry"
```

---

## Task 2: Extend `TranscriptManager` with suggestion attachment + timeline view

**Files:**
- Modify: `src/core/transcript.ts`
- Test: `tests/transcript.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/transcript.test.ts`:

```ts
import type { TranscriptEntry } from "../src/core/types.js";

describe("TranscriptManager.attachSuggestion + getTimeline", () => {
  it("attaches a suggestion to the most recent them line", () => {
    const tm = new TranscriptManager();
    tm.add("Tell me about yourself.", "them");
    tm.attachSuggestion("I'm a backend engineer with ten years on payments.");
    const tl = tm.getTimeline();
    expect(tl).toEqual<TranscriptEntry[]>([
      { kind: "them", text: "Tell me about yourself." },
      { kind: "suggested", text: "I'm a backend engineer with ten years on payments." },
    ]);
  });

  it("attaches to latest entry of any kind when no them exists yet (manual trigger)", () => {
    const tm = new TranscriptManager();
    tm.add("hi back", "self");
    tm.attachSuggestion("Ask them about the role.");
    const tl = tm.getTimeline();
    expect(tl).toEqual<TranscriptEntry[]>([
      { kind: "you", text: "hi back" },
      { kind: "suggested", text: "Ask them about the role." },
    ]);
  });

  it("is a no-op when there are no lines at all", () => {
    const tm = new TranscriptManager();
    tm.attachSuggestion("orphan");
    expect(tm.getTimeline()).toEqual([]);
  });

  it("overwrites a previous suggestion on the same them line", () => {
    const tm = new TranscriptManager();
    tm.add("Question?", "them");
    tm.attachSuggestion("first answer");
    tm.attachSuggestion("better answer");
    expect(tm.getTimeline()).toEqual<TranscriptEntry[]>([
      { kind: "them", text: "Question?" },
      { kind: "suggested", text: "better answer" },
    ]);
  });

  it("evicts the suggestion when its parent them line ages out", () => {
    const tm = new TranscriptManager(3);
    tm.add("them 1", "them");
    tm.attachSuggestion("sug 1");
    tm.add("you 1", "self");
    tm.add("them 2", "them");
    tm.attachSuggestion("sug 2");
    tm.add("them 3", "them"); // pushes "them 1" + its suggestion out
    const tl = tm.getTimeline();
    expect(tl.find((e) => e.kind === "suggested" && e.text === "sug 1")).toBeUndefined();
    expect(tl.find((e) => e.kind === "suggested" && e.text === "sug 2")).toBeDefined();
  });

  it("interleaves multiple suggestions in chronological order", () => {
    const tm = new TranscriptManager();
    tm.add("them 1", "them");
    tm.attachSuggestion("sug 1");
    tm.add("you 1", "self");
    tm.add("them 2", "them");
    tm.attachSuggestion("sug 2");
    expect(tm.getTimeline()).toEqual<TranscriptEntry[]>([
      { kind: "them", text: "them 1" },
      { kind: "suggested", text: "sug 1" },
      { kind: "you", text: "you 1" },
      { kind: "them", text: "them 2" },
      { kind: "suggested", text: "sug 2" },
    ]);
  });
});
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `npx vitest run tests/transcript.test.ts -t "attachSuggestion"`
Expected: FAIL — methods don't exist.

- [ ] **Step 3: Implement the methods**

In `src/core/transcript.ts`, replace the `TranscriptManager` class body with:

```ts
export class TranscriptManager {
  private lines: TranscriptLine[] = [];
  constructor(private maxLines = 50) {}

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

  /** Replaces the suggestion on the latest `them` line, or — if none exists —
   *  the latest line of any kind (manual-trigger fallback). No-op when empty. */
  attachSuggestion(text: string): void {
    if (this.lines.length === 0) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      if (this.lines[i].speaker === "them") {
        this.lines[i].suggestion = trimmed;
        return;
      }
    }
    this.lines[this.lines.length - 1].suggestion = trimmed;
  }

  /** Flatten the buffer into the prompt-ready timeline. */
  getTimeline(): TranscriptEntry[] {
    const out: TranscriptEntry[] = [];
    for (const l of this.lines) {
      out.push(
        l.speaker === "them"
          ? { kind: "them", text: l.text }
          : { kind: "you", text: l.text },
      );
      if (l.suggestion) out.push({ kind: "suggested", text: l.suggestion });
    }
    return out;
  }

  /** Adjust the rolling window cap. Trims immediately if shrinking. */
  setMaxLines(n: number): void {
    if (!Number.isFinite(n) || n < 1) return;
    this.maxLines = Math.floor(n);
    while (this.lines.length > this.maxLines) this.lines.shift();
  }

  /** Rolling prompt string — last N chars, used as Whisper's `prompt` param. */
  promptContext(maxChars = 200): string {
    let out = "";
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const candidate = this.lines[i].text + (out ? " " + out : "");
      if (candidate.length > maxChars) break;
      out = candidate;
    }
    return out;
  }

  recent(n: number): TranscriptLine[] {
    return this.lines.slice(-n);
  }

  clear(): void {
    this.lines = [];
  }
}
```

(The added bits: `attachSuggestion`, `getTimeline`, `setMaxLines`. Everything else is unchanged.)

Note: ensure the existing import line in `transcript.ts` brings in `TranscriptEntry`:

```ts
import type { Speaker, TranscriptLine, TranscriptEntry } from "./types.js";
```

- [ ] **Step 4: Run the new tests and confirm they pass**

Run: `npx vitest run tests/transcript.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/transcript.ts tests/transcript.test.ts
git commit -m "feat(transcript): attachSuggestion + getTimeline + setMaxLines"
```

---

## Task 3: Rewrite `buildCopilotMessages` with XML-tagged prompt + structured input

**Files:**
- Modify: `src/core/copilot.ts`
- Test: `tests/copilot.test.ts`

- [ ] **Step 1: Replace the prompt + builder + exports in `src/core/copilot.ts`**

Replace the top of `src/core/copilot.ts` (everything *above* the `streamCopilot` function — lines 1 through the closing brace of `buildCopilotMessages`) with:

```ts
/**
 * Copilot: streams a Groq chat-completions reply on each detected end-of-turn.
 * OpenAI-compatible SSE protocol; parser is decoupled from Electron so it's
 * trivially unit-testable with a mocked fetch.
 */
import type {
  CopilotMode,
  InterviewContext,
  TranscriptEntry,
} from "./types.js";

const SHARED_RULES = `<rules>
- Don't echo or paraphrase the other side's words back to them.
- No preamble ("Sure...", "Great question..."), no hedging, no reflexive "I think", no "as an AI" leakage.
- Don't repeat points the user already made (visible in You: lines) — build on them or move past.
- If asked about something not supported by <persona> or prior You: turns, deflect honestly using adjacent experience. Never invent specifics, names, numbers, or employers.
- Plain spoken prose. No markdown, no bullets, no emojis, no parentheticals, no em-dashes.
</rules>`;

const INTERVIEW_RULES = `<rules>
- Don't echo or paraphrase the interviewer's words back.
- No preamble ("Sure...", "Great question..."), no hedging, no reflexive "I think", no "as an AI" leakage.
- Don't repeat points already made in You: lines — build on them or move past.
- If asked about something not in <persona>, prior You: turns, or <job_description>, deflect honestly using adjacent experience. Never invent specifics, names, numbers, or employers.
- Behavioral question → situation, task, action, result. Concrete and quantified.
- Technical question → direct answer first, then reasoning, then one tradeoff.
- System design → key decisions, tradeoffs, what you'd validate next. Don't enumerate every component.
- If <job_description> is present, weight examples and vocabulary toward what it emphasizes.
- Plain spoken prose. No markdown, no bullets, no emojis, no parentheticals, no em-dashes.
</rules>`;

const ANTI_PATTERNS = `<anti_patterns>
Bad: "Great question! So what you're asking about is distributed systems, and yes, I have a lot of experience with that..."
Why: echoes the question, hedges, delays the answer.
Good: "Yes — I rebuilt our order pipeline on Kafka last year, cut p99 latency from 800ms to 90."

Bad: "I think, generally speaking, in most cases, the answer would probably be that it depends on the context."
Why: stacks hedges, says nothing.
Good: "It depends on read-write ratio. For our 95% read workload, I'd put a cache in front of Postgres before sharding."

Bad: "As mentioned earlier, the architecture I described uses microservices..."
Why: refers to prior turn instead of just answering.
Good: "We split it into three services: ingest, scoring, and serving. The split was driven by deploy cadence, not load."
</anti_patterns>`;

const OUTPUT_FORMAT = `<output_format>
- First sentence is a complete, standalone answer the user can deliver if they only get that far.
- Then 2-4 supporting sentences with the substance.
- Length budget by turn type (self-classify):
  - light banter / acknowledgement → 1 sentence
  - clarification / yes-no → 1-2 sentences
  - normal question → 3-6 sentences
  - behavioral / system design → 6-10 sentences
  - "tell me more" → expand the previous answer's weakest point
- Sentence cap ~18 words. End on a landable beat, not a trailing clause.
- Avoid tongue-trippers when read cold: "specifically", "particularly", "fundamentally", "essentially".
- Numbers over 3 digits should be rounded or spelled in plain English.
</output_format>`;

const MEETING_ROLE = `<role>
You are a live copilot helping the user navigate a conversation. You hear only the other side. Draft what the user should say or know next, in first person as the user. The user may be in a sales call, client meeting, sync, negotiation, or casual professional conversation — read the room from <conversation>.
</role>`;

const INTERVIEW_ROLE = `<role>
You are the candidate. The other side is interviewing you. Speak in first person as the user described in <persona>. Every turn is high-stakes; deliver thought-out answers, not reflexes.
</role>`;

export const MEETING_SYSTEM_PROMPT =
  `${MEETING_ROLE}\n\n${SHARED_RULES}\n\n${ANTI_PATTERNS}\n\n${OUTPUT_FORMAT}`;

export const INTERVIEW_SYSTEM_PROMPT =
  `${INTERVIEW_ROLE}\n\n${INTERVIEW_RULES}\n\n${ANTI_PATTERNS}\n\n${OUTPUT_FORMAT}`;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type StreamCopilotOptions = {
  apiKey: string;
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export type BuildCopilotMessagesInput = {
  mode: CopilotMode;
  timeline: TranscriptEntry[];
  persona?: string;
  sessionContext?: string;
  interview?: InterviewContext;
  manualTrigger?: boolean;
};

function tag(name: string, body: string): string {
  return `<${name}>\n${body.trim()}\n</${name}>`;
}

function renderTimeline(timeline: TranscriptEntry[]): string {
  if (timeline.length === 0) return "(no prior speech)";
  return timeline
    .map((e) => {
      if (e.kind === "them") return `Them: ${e.text}`;
      if (e.kind === "you") return `You: ${e.text}`;
      return `[You suggested I say: ${e.text}]`;
    })
    .join("\n");
}

/**
 * Build the messages array for a single turn.
 *
 * System message contains layer 1 (mode-specific role/rules/anti-patterns/
 * output_format), layer 2 (persona, omitted if empty), and layer 3 (interview
 * fields + session_notes, each omitted if empty). Ordered most-static first
 * so Groq's prefix cache reuses across turns and across sessions.
 *
 * User message contains <conversation> with interleaved [You suggested I say:]
 * entries, followed by a fixed trigger sentence (different for manual asks).
 */
export function buildCopilotMessages(
  input: BuildCopilotMessagesInput,
): ChatMessage[] {
  const { mode, timeline, manualTrigger } = input;
  const persona = (input.persona ?? "").trim();
  const sessionContext = (input.sessionContext ?? "").trim();
  const interview = input.interview ?? {};
  const role = (interview.role ?? "").trim();
  const company = (interview.company ?? "").trim();
  const jd = (interview.jobDescription ?? "").trim();

  const sysBase =
    mode === "interview" ? INTERVIEW_SYSTEM_PROMPT : MEETING_SYSTEM_PROMPT;

  const sysParts: string[] = [sysBase];
  if (persona) sysParts.push(tag("persona", persona));
  if (mode === "interview") {
    if (role) sysParts.push(tag("role_target", role));
    if (company) sysParts.push(tag("company", company));
    if (jd) sysParts.push(tag("job_description", jd));
  }
  if (sessionContext) sysParts.push(tag("session_notes", sessionContext));

  const conversation = tag("conversation", renderTimeline(timeline));
  const trigger = manualTrigger
    ? "The user is asking for help now — draft what they should say next."
    : "The other side just finished. Reply as me.";

  return [
    { role: "system", content: sysParts.join("\n\n") },
    { role: "user", content: `${conversation}\n\n${trigger}` },
  ];
}
```

Leave `streamCopilot` (and everything below `buildCopilotMessages`) unchanged.

Also delete the old `COPILOT_SYSTEM_PROMPT` export — callers will switch in later tasks.

- [ ] **Step 2: Replace the buildCopilotMessages tests**

Replace the entire `describe("buildCopilotMessages", ...)` block in `tests/copilot.test.ts` with:

```ts
describe("buildCopilotMessages", () => {
  it("meeting mode with empty timeline produces shell prompt + placeholder", () => {
    const ms = buildCopilotMessages({ mode: "meeting", timeline: [] });
    expect(ms).toHaveLength(2);
    expect(ms[0].role).toBe("system");
    expect(ms[0].content).toBe(MEETING_SYSTEM_PROMPT);
    expect(ms[1].role).toBe("user");
    expect(ms[1].content).toContain("(no prior speech)");
    expect(ms[1].content).toContain("The other side just finished");
  });

  it("renders timeline entries with Them/You/suggested prefixes in order", () => {
    const ms = buildCopilotMessages({
      mode: "meeting",
      timeline: [
        { kind: "them", text: "Tell me about yourself." },
        { kind: "suggested", text: "I'm a backend engineer." },
        { kind: "you", text: "I'm a backend engineer with ten years experience." },
        { kind: "them", text: "What stack?" },
      ],
    });
    const user = ms[1].content;
    const t1 = user.indexOf("Them: Tell me about yourself.");
    const s1 = user.indexOf("[You suggested I say: I'm a backend engineer.]");
    const y1 = user.indexOf("You: I'm a backend engineer with ten years experience.");
    const t2 = user.indexOf("Them: What stack?");
    expect(t1).toBeGreaterThan(-1);
    expect(s1).toBeGreaterThan(t1);
    expect(y1).toBeGreaterThan(s1);
    expect(t2).toBeGreaterThan(y1);
    expect(user).toContain("<conversation>");
    expect(user).toContain("</conversation>");
  });

  it("manualTrigger swaps the trigger sentence", () => {
    const ms = buildCopilotMessages({
      mode: "meeting",
      timeline: [{ kind: "them", text: "ok" }],
      manualTrigger: true,
    });
    expect(ms[1].content).toContain("user is asking for help now");
    expect(ms[1].content).not.toContain("The other side just finished");
  });

  it("interview mode uses the interview system prompt", () => {
    const ms = buildCopilotMessages({ mode: "interview", timeline: [] });
    expect(ms[0].content).toBe(INTERVIEW_SYSTEM_PROMPT);
    expect(ms[0].content).toContain("You are the candidate");
  });

  it("emits persona tag when present, omits when blank", () => {
    const withP = buildCopilotMessages({
      mode: "meeting",
      timeline: [],
      persona: "I'm Borislav, staff engineer at Polaro.",
    });
    expect(withP[0].content).toContain("<persona>");
    expect(withP[0].content).toContain("Borislav");

    const noP = buildCopilotMessages({
      mode: "meeting",
      timeline: [],
      persona: "   ",
    });
    expect(noP[0].content).not.toContain("<persona>");
  });

  it("emits session_notes tag when present in either mode", () => {
    const ms = buildCopilotMessages({
      mode: "meeting",
      timeline: [],
      sessionContext: "Sales call with Acme, intro round.",
    });
    expect(ms[0].content).toContain("<session_notes>");
    expect(ms[0].content).toContain("Acme");
  });

  it("emits role_target / company / job_description only in interview mode and only when set", () => {
    const full = buildCopilotMessages({
      mode: "interview",
      timeline: [],
      interview: {
        role: "Senior backend engineer",
        company: "Stripe — payments infra",
        jobDescription: "Looking for someone with deep distributed systems experience.",
      },
    });
    expect(full[0].content).toContain("<role_target>");
    expect(full[0].content).toContain("Senior backend engineer");
    expect(full[0].content).toContain("<company>");
    expect(full[0].content).toContain("Stripe");
    expect(full[0].content).toContain("<job_description>");
    expect(full[0].content).toContain("distributed systems");

    const partial = buildCopilotMessages({
      mode: "interview",
      timeline: [],
      interview: { role: "Backend eng" },
    });
    expect(partial[0].content).toContain("<role_target>");
    expect(partial[0].content).not.toContain("<company>");
    expect(partial[0].content).not.toContain("<job_description>");

    const meetingWithFields = buildCopilotMessages({
      mode: "meeting",
      timeline: [],
      interview: { role: "ignored", company: "ignored", jobDescription: "ignored" },
    });
    expect(meetingWithFields[0].content).not.toContain("<role_target>");
    expect(meetingWithFields[0].content).not.toContain("<company>");
    expect(meetingWithFields[0].content).not.toContain("<job_description>");
  });

  it("orders system message: base, persona, interview fields, session_notes", () => {
    const ms = buildCopilotMessages({
      mode: "interview",
      timeline: [],
      persona: "P-text",
      sessionContext: "S-text",
      interview: { role: "R-text", company: "C-text", jobDescription: "JD-text" },
    });
    const sys = ms[0].content;
    const idx = (s: string) => sys.indexOf(s);
    expect(idx("P-text")).toBeGreaterThan(idx("</output_format>"));
    expect(idx("R-text")).toBeGreaterThan(idx("P-text"));
    expect(idx("C-text")).toBeGreaterThan(idx("R-text"));
    expect(idx("JD-text")).toBeGreaterThan(idx("C-text"));
    expect(idx("S-text")).toBeGreaterThan(idx("JD-text"));
  });

  it("returns exactly one system message regardless of which fields are populated", () => {
    const ms = buildCopilotMessages({
      mode: "interview",
      timeline: [],
      persona: "p",
      sessionContext: "s",
      interview: { role: "r", company: "c", jobDescription: "j" },
    });
    expect(ms.filter((m) => m.role === "system")).toHaveLength(1);
  });
});
```

Also update the import line at the top of the test file:

```ts
import {
  buildCopilotMessages,
  streamCopilot,
  MEETING_SYSTEM_PROMPT,
  INTERVIEW_SYSTEM_PROMPT,
} from "../src/core/copilot.js";
```

And replace the bottom describe (`describe("COPILOT_SYSTEM_PROMPT", ...)`) with:

```ts
describe("system prompts", () => {
  it("both prompts explain the You:/Them: convention via <conversation> usage", () => {
    expect(MEETING_SYSTEM_PROMPT).toMatch(/conversation/);
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/conversation/);
  });

  it("interview prompt frames the model as the candidate", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toMatch(/candidate/i);
  });

  it("meeting prompt does not assume an interview frame", () => {
    expect(MEETING_SYSTEM_PROMPT).not.toMatch(/candidate/i);
    expect(MEETING_SYSTEM_PROMPT).not.toMatch(/interviewer/i);
  });
});
```

- [ ] **Step 3: Run the copilot tests**

Run: `npx vitest run tests/copilot.test.ts`
Expected: all PASS.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: FAIL — `src/renderer/worker/main.ts` still imports the removed `COPILOT_SYSTEM_PROMPT` and calls `buildCopilotMessages` with the old signature. We fix this in Task 6.

It's OK to commit with a failing typecheck against `worker/main.ts`; the next tasks bring it back. (If the project's pre-commit hook blocks on typecheck, do Task 6 before committing this one.)

- [ ] **Step 5: Commit**

```bash
git add src/core/copilot.ts tests/copilot.test.ts
git commit -m "feat(copilot): XML-tagged mode-aware prompt + structured builder"
```

---

## Task 4: Extend `keyStore` with `mode`, `interview`, `transcriptN`

**Files:**
- Modify: `src/main/keyStore.ts`
- Test: `tests/keyStore.test.ts`

- [ ] **Step 1: Open `tests/keyStore.test.ts` and append new test cases**

```ts
import {
  getMode,
  setMode,
  getInterviewContext,
  setInterviewContext,
  getTranscriptN,
  setTranscriptN,
  TRANSCRIPT_N_MIN,
  TRANSCRIPT_N_MAX,
  TRANSCRIPT_N_DEFAULT,
} from "../src/main/keyStore.js";
// (Adjust the import to extend the existing import from this file rather than
// duplicating it — keep imports merged.)

describe("mode", () => {
  it("defaults to 'meeting'", () => {
    expect(getMode()).toBe("meeting");
  });
  it("round-trips set/get", () => {
    setMode("interview");
    expect(getMode()).toBe("interview");
    setMode("meeting");
    expect(getMode()).toBe("meeting");
  });
});

describe("interview context", () => {
  it("defaults to all-empty", () => {
    setInterviewContext({ role: "", company: "", jobDescription: "" });
    expect(getInterviewContext()).toEqual({});
  });
  it("trims and stores fields, drops empties", () => {
    setInterviewContext({
      role: "  Senior backend  ",
      company: "Stripe",
      jobDescription: "  ",
    });
    expect(getInterviewContext()).toEqual({
      role: "Senior backend",
      company: "Stripe",
    });
  });
});

describe("transcriptN", () => {
  it("defaults to TRANSCRIPT_N_DEFAULT", () => {
    setTranscriptN(0); // reset by passing invalid -> falls back to default
    expect(getTranscriptN()).toBe(TRANSCRIPT_N_DEFAULT);
  });
  it("clamps to [TRANSCRIPT_N_MIN, TRANSCRIPT_N_MAX]", () => {
    setTranscriptN(5);
    expect(getTranscriptN()).toBe(TRANSCRIPT_N_MIN);
    setTranscriptN(9999);
    expect(getTranscriptN()).toBe(TRANSCRIPT_N_MAX);
    setTranscriptN(75);
    expect(getTranscriptN()).toBe(75);
  });
});
```

(If the existing `keyStore.test.ts` mocks `app.getPath` / `safeStorage`, reuse the same setup. Don't duplicate setup blocks; insert the new describes inside the same suite scaffolding.)

- [ ] **Step 2: Run the new tests, confirm they fail**

Run: `npx vitest run tests/keyStore.test.ts`
Expected: FAIL — symbols don't exist.

- [ ] **Step 3: Edit `src/main/keyStore.ts`**

Add to the imports / type at the top:

```ts
import type { CopilotMode, InterviewContext } from "../core/types.js";
```

Extend the `Stored` type:

```ts
type Stored = {
  groqKeyEnc?: string;
  transcripts?: TranscriptSettings;
  persona?: string;
  sessionContext?: string;
  mode?: CopilotMode;
  interview?: InterviewContext;
  transcriptN?: number;
};
```

Add at the bottom of the file:

```ts
export const TRANSCRIPT_N_DEFAULT = 50;
export const TRANSCRIPT_N_MIN = 10;
export const TRANSCRIPT_N_MAX = 200;

const INTERVIEW_FIELD_MAX_CHARS = 4000;

export function getMode(): CopilotMode {
  const m = readStore().mode;
  return m === "interview" ? "interview" : "meeting";
}

export function setMode(mode: CopilotMode): void {
  const s = readStore();
  s.mode = mode === "interview" ? "interview" : "meeting";
  writeStore(s);
}

export function getInterviewContext(): InterviewContext {
  const ic = readStore().interview ?? {};
  const out: InterviewContext = {};
  if (ic.role && ic.role.trim()) out.role = ic.role.trim();
  if (ic.company && ic.company.trim()) out.company = ic.company.trim();
  if (ic.jobDescription && ic.jobDescription.trim())
    out.jobDescription = ic.jobDescription.trim();
  return out;
}

export function setInterviewContext(next: InterviewContext): InterviewContext {
  const s = readStore();
  const trim = (v: string | undefined) =>
    (v ?? "").trim().slice(0, INTERVIEW_FIELD_MAX_CHARS);
  const cleaned: InterviewContext = {};
  const r = trim(next.role);
  const c = trim(next.company);
  const j = trim(next.jobDescription);
  if (r) cleaned.role = r;
  if (c) cleaned.company = c;
  if (j) cleaned.jobDescription = j;
  if (Object.keys(cleaned).length === 0) delete s.interview;
  else s.interview = cleaned;
  writeStore(s);
  return cleaned;
}

export function getTranscriptN(): number {
  const n = readStore().transcriptN;
  if (typeof n !== "number" || !Number.isFinite(n)) return TRANSCRIPT_N_DEFAULT;
  return Math.min(TRANSCRIPT_N_MAX, Math.max(TRANSCRIPT_N_MIN, Math.floor(n)));
}

export function setTranscriptN(n: number): number {
  const s = readStore();
  if (!Number.isFinite(n) || n <= 0) {
    delete s.transcriptN;
    writeStore(s);
    return TRANSCRIPT_N_DEFAULT;
  }
  const clamped = Math.min(
    TRANSCRIPT_N_MAX,
    Math.max(TRANSCRIPT_N_MIN, Math.floor(n)),
  );
  s.transcriptN = clamped;
  writeStore(s);
  return clamped;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/keyStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS for keyStore (worker still failing, fixed in Task 6).

- [ ] **Step 6: Commit**

```bash
git add src/main/keyStore.ts tests/keyStore.test.ts
git commit -m "feat(keyStore): persist mode, interview context, transcriptN"
```

---

## Task 5: Wire IPC handlers + preload bridges for the new config

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/overlay.ts`
- Modify: `src/preload/worker.ts`
- Modify: `src/preload/types.d.ts`

- [ ] **Step 1: Add main IPC handlers**

In `src/main/index.ts`, find the existing `ipcMain.handle("cfg:get-persona", ...)` block (around line 241). Add directly below the existing session-context handlers:

```ts
ipcMain.handle("cfg:get-mode", () => getMode());
ipcMain.handle("cfg:set-mode", (_e, mode: "meeting" | "interview") => {
  setMode(mode);
  return getMode();
});

ipcMain.handle("cfg:get-interview", () => getInterviewContext());
ipcMain.handle("cfg:set-interview", (_e, next: {
  role?: string; company?: string; jobDescription?: string;
}) => setInterviewContext(next ?? {}));

ipcMain.handle("cfg:get-transcript-n", () => getTranscriptN());
ipcMain.handle("cfg:set-transcript-n", (_e, n: number) => setTranscriptN(n));
```

Update the `keyStore` import at the top of `src/main/index.ts` to include the new functions:

```ts
import {
  // existing imports preserved...
  getMode, setMode,
  getInterviewContext, setInterviewContext,
  getTranscriptN, setTranscriptN,
} from "./keyStore.js";
```

- [ ] **Step 2: Expose them on the overlay preload bridge**

In `src/preload/overlay.ts`, add after the existing session-context entries inside the `exposeInMainWorld("overlayBridge", { ... })` object:

```ts
getMode: (): Promise<"meeting" | "interview"> =>
  ipcRenderer.invoke("cfg:get-mode"),
setMode: (mode: "meeting" | "interview"): Promise<"meeting" | "interview"> =>
  ipcRenderer.invoke("cfg:set-mode", mode),
getInterview: (): Promise<{ role?: string; company?: string; jobDescription?: string }> =>
  ipcRenderer.invoke("cfg:get-interview"),
setInterview: (next: { role?: string; company?: string; jobDescription?: string }) =>
  ipcRenderer.invoke("cfg:set-interview", next),
getTranscriptN: (): Promise<number> => ipcRenderer.invoke("cfg:get-transcript-n"),
setTranscriptN: (n: number): Promise<number> =>
  ipcRenderer.invoke("cfg:set-transcript-n", n),
```

- [ ] **Step 3: Expose them on the worker preload bridge**

In `src/preload/worker.ts`, add after the existing `getSessionContext` entry:

```ts
getMode: (): Promise<"meeting" | "interview"> =>
  ipcRenderer.invoke("cfg:get-mode"),
getInterview: (): Promise<{ role?: string; company?: string; jobDescription?: string }> =>
  ipcRenderer.invoke("cfg:get-interview"),
getTranscriptN: (): Promise<number> => ipcRenderer.invoke("cfg:get-transcript-n"),
```

- [ ] **Step 4: Update preload type declarations**

In `src/preload/types.d.ts`, extend the `workerBridge` type to include:

```ts
getMode: () => Promise<"meeting" | "interview">;
getInterview: () => Promise<{ role?: string; company?: string; jobDescription?: string }>;
getTranscriptN: () => Promise<number>;
```

And the `overlayBridge` type to include:

```ts
getMode: () => Promise<"meeting" | "interview">;
setMode: (mode: "meeting" | "interview") => Promise<"meeting" | "interview">;
getInterview: () => Promise<{ role?: string; company?: string; jobDescription?: string }>;
setInterview: (next: { role?: string; company?: string; jobDescription?: string }) => Promise<{ role?: string; company?: string; jobDescription?: string }>;
getTranscriptN: () => Promise<number>;
setTranscriptN: (n: number) => Promise<number>;
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: still failing in `worker/main.ts` (fixed in Task 6); no new errors elsewhere.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/preload/overlay.ts src/preload/worker.ts src/preload/types.d.ts
git commit -m "feat(ipc): expose mode, interview, transcriptN over both bridges"
```

---

## Task 6: Wire the worker to use the new builder + suggestion attachment

**Files:**
- Modify: `src/renderer/worker/main.ts`

- [ ] **Step 1: Remove the old prior-replies ring buffer**

In `src/renderer/worker/main.ts`, delete:

- Line ~56: `const priorReplies: string[] = [];`
- The `MAX_PRIOR_REPLIES` constant if it's defined (search for it; remove if unused).
- Line ~643 in the `clear-context` handler: `priorReplies.length = 0;` — leave a placeholder if you remove the only line in that handler block; the transcript clear via `transcripts.clear()` already drops attached suggestions.

- [ ] **Step 2: Update `runCopilot` to use the new builder + attach suggestions**

Replace the body of `runCopilot` (the function defined around line 486) with:

```ts
async function runCopilot(opts: { manualTrigger: boolean }): Promise<void> {
  // Replace semantics — abort any in-flight stream before starting a new one.
  if (activeCopilot) {
    activeCopilot.controller.abort();
    activeCopilot = null;
  }
  const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  const slot: { id: string; controller: AbortController; text: string } = {
    id,
    controller,
    text: "",
  };
  activeCopilot = slot;
  const startTs = Date.now();
  bridge.emit({ kind: "card:start", id, ts: startTs });

  try {
    // Pulled fresh each run so persona / session-context / mode / interview
    // edits take effect mid-session without restart.
    const [persona, sessionContext, mode, interview, n] = await Promise.all([
      bridge.getPersona().catch(() => ""),
      bridge.getSessionContext().catch(() => ""),
      bridge.getMode().catch(() => "meeting" as const),
      bridge.getInterview().catch(() => ({})),
      bridge.getTranscriptN().catch(() => 50),
    ]);
    transcripts.setMaxLines(n);

    // Include any in-flight (uncommitted) Them: utterance as a tail entry so
    // a manual ask mid-speech sees the freshest context. lockedText only ever
    // holds them-side speech.
    const tail = lockedText.trim();
    const timeline = transcripts.getTimeline();
    if (tail) timeline.push({ kind: "them", text: tail });

    const messages = buildCopilotMessages({
      mode,
      timeline,
      persona,
      sessionContext,
      interview,
      manualTrigger: opts.manualTrigger,
    });

    for await (const delta of streamCopilot({
      apiKey: groqKey,
      messages,
      signal: controller.signal,
    })) {
      if (activeCopilot?.id !== id) return;
      slot.text += delta;
      bridge.emit({ kind: "card:delta", id, delta });
    }
    if (activeCopilot?.id === id) {
      bridge.emit({ kind: "card:done", id });
      const finalText = slot.text.trim();
      if (finalText) transcripts.attachSuggestion(finalText);
    }
  } catch (err) {
    if (controller.signal.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[ghst copilot] error:", msg);
    bridge.emit({ kind: "card:error", id, msg });
  } finally {
    if (activeCopilot?.id === id) activeCopilot = null;
  }
}
```

- [ ] **Step 3: Update both call sites of `runCopilot`**

- In `manualAsk` (around line 438): change the empty-context guard. We no longer need `contextForCopilot()` returning a string — replace `manualAsk` with:

```ts
function manualAsk(): void {
  if (transcripts.recent(1).length === 0 && !lockedText.trim()) {
    debug("[ghst ask] skipped — no context yet");
    return;
  }
  debug(`[ghst ask] manual`);
  lastSpeechEndAt = null;
  void runCopilot({ manualTrigger: true });
}
```

- In `checkTurnEnd` (around line 455): replace the trailing `void runCopilot(ctx);` and the lines that build `ctx` with:

```ts
debug(`[ghst eot] fired after ${silence}ms silence`);
void runCopilot({ manualTrigger: false });
```

You can also delete the now-unused `contextForCopilot` function and `COPILOT_CONTEXT_MS` constant (search and remove). The transcript window cap is now driven by `transcripts.setMaxLines(n)` inside `runCopilot`.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/worker/main.ts
git commit -m "feat(worker): use mode-aware builder, attach suggestions to transcript"
```

---

## Task 7: Settings UI — mode toggle, interview fields, transcript size

**Files:**
- Modify: `src/renderer/overlay/main.ts`
- Modify: `src/renderer/overlay/style.css`

This task only adds UI elements that read/write the IPC channels exposed in Task 5. The behavior (which prompt is used, what fields go to the model) is already correct from Task 6.

- [ ] **Step 1: Find the existing settings panel sections**

Open `src/renderer/overlay/main.ts` and locate the rendering of the existing persona / session-context inputs. (Search for `getPersona` / `getSessionContext` / `setPersona` calls.) Note the pattern the file uses for inputs (event handlers, debounce, where they're added to the DOM). Match it.

- [ ] **Step 2: Add the mode segmented control**

In the settings panel, above the persona section, add:

```html
<section class="settings-section">
  <label>Mode</label>
  <div role="radiogroup" class="mode-toggle">
    <button type="button" data-mode="meeting" class="mode-btn">Meeting</button>
    <button type="button" data-mode="interview" class="mode-btn">Interview</button>
  </div>
</section>
```

Wire up handlers that:

1. On settings open: call `overlayBridge.getMode()`, set the `aria-checked` / `data-active` attribute on the matching button, and toggle visibility of the interview section (Step 3).
2. On click: call `overlayBridge.setMode(mode)`, update the active state, and toggle the interview section.

Implementation pattern (place near the other settings wiring):

```ts
const modeButtons = panel.querySelectorAll<HTMLButtonElement>(".mode-btn");
let currentMode: "meeting" | "interview" = "meeting";

function applyMode(mode: "meeting" | "interview"): void {
  currentMode = mode;
  for (const btn of modeButtons) {
    const active = btn.dataset.mode === mode;
    btn.dataset.active = active ? "1" : "0";
    btn.setAttribute("aria-checked", active ? "true" : "false");
  }
  interviewSection.style.display = mode === "interview" ? "" : "none";
}

for (const btn of modeButtons) {
  btn.addEventListener("click", async () => {
    const m = btn.dataset.mode === "interview" ? "interview" : "meeting";
    await overlayBridge.setMode(m);
    applyMode(m);
  });
}

void overlayBridge.getMode().then(applyMode);
```

- [ ] **Step 3: Add the interview-only fields**

Add after the mode section:

```html
<section class="settings-section interview-only" hidden>
  <label>Role</label>
  <input type="text" class="settings-input" data-field="role" placeholder="e.g. Senior backend engineer" />

  <label>Company</label>
  <input type="text" class="settings-input" data-field="company" placeholder="e.g. Stripe — payments infra" />

  <label>Job description</label>
  <textarea class="settings-textarea" data-field="jobDescription" rows="6" placeholder="Paste the JD"></textarea>
</section>
```

Wire it up using the same debounce/save pattern the existing persona/session-context inputs use. On every change (debounced ~300ms), gather all three values into `{ role, company, jobDescription }` and call `overlayBridge.setInterview(...)`. On settings open, call `getInterview()` and populate the three fields.

`interviewSection` is the `<section class="interview-only">` element. The `applyMode` function from Step 2 toggles its visibility.

- [ ] **Step 4: Add the transcript size control**

Add an "Advanced" section (or extend an existing one):

```html
<section class="settings-section">
  <label>Transcript size (lines kept in context)</label>
  <input type="number" min="10" max="200" step="5" class="settings-input transcript-n" />
</section>
```

Wire it: on open, `overlayBridge.getTranscriptN()` to populate. On change (debounced), `overlayBridge.setTranscriptN(parseInt(value))`. The value the IPC returns is clamped server-side; reflect that back into the input if it differs.

- [ ] **Step 5: Style the new controls**

In `src/renderer/overlay/style.css`, add (matching the existing glass aesthetic — copy classes/colors from existing `.settings-input`/`.settings-section` rules):

```css
.mode-toggle {
  display: inline-flex;
  gap: 4px;
  padding: 2px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
}
.mode-btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.mode-btn[data-active="1"] {
  background: rgba(255, 255, 255, 0.18);
}
.settings-textarea {
  width: 100%;
  resize: vertical;
  font: inherit;
  /* match the existing .settings-input border/background here */
}
```

(If the existing CSS uses a different visual language for buttons / inputs, mirror it instead — these declarations are a starting point.)

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Smoke test in dev**

Run: `npm run dev`

Manually verify:
- Open settings (whatever the existing keybinding is — check the README or `src/renderer/overlay/main.ts`).
- Mode defaults to Meeting; interview section is hidden.
- Switch to Interview; fields appear, persist across app restart (close, `npm run dev` again).
- Type a Role, switch to Meeting and back; the Role value persists.
- Set transcript size to 5 → input should snap to 10 (server-side clamp).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/overlay/main.ts src/renderer/overlay/style.css
git commit -m "feat(overlay): mode toggle + interview fields + transcript-size setting"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Live smoke test**

Run: `npm run dev` and exercise both modes end-to-end:

- Meeting mode (default): start listening, speak from another window, watch a card render. Trigger `Ctrl+Shift+Enter` mid-speech and confirm a card still appears (manualTrigger path).
- Interview mode: switch in settings, fill in Role + a one-line JD, repeat. Confirm answers reflect the JD framing.
- Trigger several copilot replies in a row and read DevTools logs for the worker — confirm no `priorReplies` references remain.

- [ ] **Step 5: Final commit if anything was tweaked**

If steps 1–4 surfaced no fixes, no commit needed.

---

## Spec coverage map

| Spec section | Implemented in |
|---|---|
| Two modes (meeting default, interview) | Tasks 3, 4, 7 |
| Optional structured interview fields | Tasks 4, 7 |
| Persona stays global | Untouched (Task 6 still passes it) |
| Free-form session context in both modes | Untouched (Task 6 still passes it) |
| Layered XML system message (rules → persona → session/interview) | Task 3 |
| User message: `<conversation>` + trigger sentence | Task 3 |
| Interleaved suggestions in timeline | Tasks 2, 6 |
| Manual-trigger sentence variant | Tasks 3, 6 |
| Count-based eviction, default N=50, configurable | Tasks 2, 4, 5, 6, 7 |
| Anti-patterns block | Task 3 |
| Headline+support, length budget, speech rules in `<output_format>` | Task 3 |
| Backward compat (existing configs default cleanly) | Task 4 (defaults in getters) |
| Tests for both modes / structured fields / interleaved timeline | Tasks 2, 3, 4 |
