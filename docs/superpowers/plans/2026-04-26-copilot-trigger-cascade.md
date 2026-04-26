# Copilot Trigger Cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single VAD-end-of-speech copilot trigger with a four-layer cascade (backchannel filter → rule-based classifier → fast-LLM gate → generate), with mode-aware defaults, a "thinking…" UX affordance, and a `triggerMode` user setting.

**Architecture:** The prompt-overhaul portion of the parent spec (`docs/superpowers/specs/2026-04-25-copilot-prompt-overhaul-design.md`) is already shipped — `MEETING_SYSTEM_PROMPT` / `INTERVIEW_SYSTEM_PROMPT`, XML-tagged structure, interleaved timeline, mode + interview + transcript-N config are all in `main`. This plan adds the trigger-cascade layer on top. New module: `src/core/turnGate.ts` for the deterministic L1+L2 classifier (returns `{ verdict, turnType }`). Extension to `src/core/copilot.ts`: `runTurnGate` (L3 fast-LLM call) and `turnType` threading into `buildCopilotMessages`. Worker integration replaces the current direct `runCopilot` call in `checkTurnEnd` with a cascade dispatcher. New `triggerMode` config (`"off" | "rules" | "llm"`) with mode-aware defaults: Interview → `rules`, Meeting → `llm`. Overlay gets a Smart-trigger control and a "thinking…" affordance.

**Tech Stack:** TypeScript, Electron (main/preload/renderer split), Vitest for unit tests, Groq OpenAI-compatible chat-completions API (`llama-3.1-8b-instant` for the gate).

---

## File Structure

**New files:**
- `src/core/turnGate.ts` — pure L1+L2 classifier. No I/O. `classifyTurn()` and exported `TurnType`/`TurnVerdict` types.
- `tests/turnGate.test.ts` — unit tests for `classifyTurn`.

**Modified files:**
- `src/core/types.ts` — add `TriggerMode`, re-export `TurnType` from turnGate, add `card:thinking` / `card:suppressed` IPC events.
- `src/core/copilot.ts` — extend `BuildCopilotMessagesInput` with `turnType`, render `<turn_type>` tag, add `runTurnGate()` function and `TURN_GATE_PROMPT` constant.
- `src/main/keyStore.ts` — `getTriggerMode()` / `setTriggerMode()` persisted as `triggerMode?: "off" | "rules" | "llm"`.
- `src/main/index.ts` — IPC channels `cfg:get-trigger-mode` / `cfg:set-trigger-mode`.
- `src/preload/worker.ts` — expose `getTriggerMode()` on the worker bridge.
- `src/preload/overlay.ts` — expose `getTriggerMode()` / `setTriggerMode()` on the overlay bridge.
- `src/preload/types.d.ts` — declarations for the two bridge additions.
- `src/renderer/worker/main.ts` — replace direct `runCopilot` call site with cascade dispatcher; emit `card:thinking` / `card:suppressed` events.
- `src/renderer/overlay/main.ts` — settings panel control for Smart trigger + handler for thinking/suppressed events.
- `src/renderer/overlay/style.css` — pulsing-dot affordance class.
- `tests/copilot.test.ts` — extend with `<turn_type>` rendering cases and a smoke test for `runTurnGate`.

---

## Task 1: TurnType and TurnVerdict types in turnGate.ts (skeleton + L1)

**Files:**
- Create: `src/core/turnGate.ts`
- Create: `tests/turnGate.test.ts`

The first task gets the module skeleton in place with L1 (backchannel + empty filter) and a returns-`drop`-or-`ambiguous` decision for everything else. L2 rules ship in Task 2 to keep diffs small.

- [ ] **Step 1: Write the failing tests for L1 (backchannel + empty)**

```typescript
// tests/turnGate.test.ts
import { describe, it, expect } from "vitest";
import { classifyTurn } from "../src/core/turnGate.js";
import type { TranscriptEntry } from "../src/core/types.js";

const them = (text: string): TranscriptEntry => ({ kind: "them", text });
const you = (text: string): TranscriptEntry => ({ kind: "you", text });

describe("classifyTurn — L1 backchannel filter", () => {
  it("drops short backchannel turns", () => {
    const r = classifyTurn(them("Yeah."), [them("Yeah.")]);
    expect(r.verdict).toBe("drop");
  });

  it("drops empty / whitespace-only turns", () => {
    expect(classifyTurn(them(""), [them("")]).verdict).toBe("drop");
    expect(classifyTurn(them("   "), [them("   ")]).verdict).toBe("drop");
  });

  it("does not drop a short question", () => {
    const r = classifyTurn(them("What?"), [them("What?")]);
    expect(r.verdict).not.toBe("drop");
  });

  it("returns ambiguous for an arbitrary medium statement", () => {
    const r = classifyTurn(
      them("the team was about fifteen engineers at peak"),
      [them("the team was about fifteen engineers at peak")],
    );
    expect(r.verdict).toBe("ambiguous");
  });

  it("only classifies a 'them' entry — 'you' entries return drop", () => {
    const r = classifyTurn(you("anything"), [you("anything")]);
    expect(r.verdict).toBe("drop");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/turnGate.test.ts`
Expected: FAIL — `Cannot find module '../src/core/turnGate.js'`.

- [ ] **Step 3: Create the module skeleton with L1 only**

```typescript
// src/core/turnGate.ts
import type { TranscriptEntry } from "./types.js";
import { isBackchannel } from "./transcript.js";

export type TurnType =
  | "question_behavioural"
  | "question_technical"
  | "question_system_design"
  | "question_clarification"
  | "statement"
  | "banter";

export type TurnVerdict = "fire" | "drop" | "ambiguous";

export type ClassifyTurnResult = {
  verdict: TurnVerdict;
  turnType: TurnType;
};

/**
 * Deterministic L1 + L2 classifier.
 *
 * L1 (this file, this task): drop empty / backchannel / non-`them` entries.
 * L2 (next task): rule-based fire/drop signals + turn-type tagging.
 *
 * Returns `ambiguous` when neither layer can decide; the caller (worker)
 * either fires (in `rules` mode) or escalates to L3 (in `llm` mode).
 */
export function classifyTurn(
  latest: TranscriptEntry,
  _timeline: TranscriptEntry[],
): ClassifyTurnResult {
  if (latest.kind !== "them") {
    return { verdict: "drop", turnType: "banter" };
  }
  const text = latest.text.trim();
  if (!text || isBackchannel(text)) {
    return { verdict: "drop", turnType: "banter" };
  }
  return { verdict: "ambiguous", turnType: "statement" };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/turnGate.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 6: Commit**

```bash
git add src/core/turnGate.ts tests/turnGate.test.ts
git commit -m "feat(copilot): turnGate skeleton with L1 backchannel filter"
```

---

## Task 2: L2 rule-based classifier in turnGate.ts

**Files:**
- Modify: `src/core/turnGate.ts`
- Modify: `tests/turnGate.test.ts`

L2 adds the rule-based fire/drop/ambiguous logic and produces a `turnType`. Most of the engineering effort sits in the regex set — keep them readable, document the why for non-obvious ones.

- [ ] **Step 1: Add failing tests for L2 fire rules**

Append to `tests/turnGate.test.ts`:

```typescript
describe("classifyTurn — L2 fire rules", () => {
  it("fires on trailing question mark", () => {
    const r = classifyTurn(
      them("how would you scale this?"),
      [them("how would you scale this?")],
    );
    expect(r.verdict).toBe("fire");
  });

  it("fires on interrogative starters", () => {
    for (const q of [
      "what do you think about microservices",
      "how would you handle that situation",
      "tell me about a tough deadline you hit",
      "walk me through your last incident",
      "describe your testing philosophy",
      "explain how Raft works at a high level",
      "design a rate limiter for our API",
    ]) {
      const r = classifyTurn(them(q), [them(q)]);
      expect(r.verdict, `expected fire for: ${q}`).toBe("fire");
    }
  });

  it("fires on long complete statements with terminator", () => {
    const long =
      "We have been talking with several candidates this week and " +
      "the bar has been pretty high so this should be a real " +
      "exercise in technical depth.";
    const r = classifyTurn(them(long), [them(long)]);
    expect(r.verdict).toBe("fire");
  });
});

describe("classifyTurn — L2 drop rules", () => {
  it("drops short fragmentary statements with no marker", () => {
    const r = classifyTurn(
      them("the team was small"),
      [them("the team was small")],
    );
    expect(r.verdict).toBe("drop");
  });

  it("drops mid-clause trail-offs ending on a conjunction", () => {
    for (const q of [
      "we built it on Postgres and",
      "the migration was pretty smooth so",
      "I had to step in because",
      "we considered Kafka but",
      "it was kind of like",
    ]) {
      const r = classifyTurn(them(q), [them(q)]);
      expect(r.verdict, `expected drop for: ${q}`).toBe("drop");
    }
  });
});

describe("classifyTurn — turnType mapping", () => {
  it("maps 'tell me about a time' to behavioural", () => {
    const r = classifyTurn(
      them("Tell me about a time you handled a tough deadline."),
      [them("Tell me about a time you handled a tough deadline.")],
    );
    expect(r.turnType).toBe("question_behavioural");
  });

  it("maps 'design a' / 'how would you scale' to system_design", () => {
    expect(
      classifyTurn(them("Design a URL shortener."), [them("Design a URL shortener.")])
        .turnType,
    ).toBe("question_system_design");
    expect(
      classifyTurn(
        them("How would you scale this to a million QPS?"),
        [them("How would you scale this to a million QPS?")],
      ).turnType,
    ).toBe("question_system_design");
  });

  it("maps 'explain' / 'how does X work' to technical", () => {
    expect(
      classifyTurn(them("Explain how Raft works."), [them("Explain how Raft works.")])
        .turnType,
    ).toBe("question_technical");
  });

  it("maps short clarifications to clarification", () => {
    expect(
      classifyTurn(them("Sorry, what did you mean by sharded?"), [
        them("Sorry, what did you mean by sharded?"),
      ]).turnType,
    ).toBe("question_clarification");
  });

  it("backchannels keep banter type alongside drop verdict", () => {
    const r = classifyTurn(them("yeah"), [them("yeah")]);
    expect(r.verdict).toBe("drop");
    expect(r.turnType).toBe("banter");
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npx vitest run tests/turnGate.test.ts`
Expected: FAIL — fire/drop/turnType assertions all fail (current code only handles L1).

- [ ] **Step 3: Implement L2 in turnGate.ts**

Replace the placeholder branch in `src/core/turnGate.ts` with the full classifier:

```typescript
// Replace the function body (everything below the L1 backchannel guard).

const QUESTION_TRAILING = /\?\s*$/;

const INTERROGATIVE_STARTERS =
  /^(what|how|why|when|where|who|which|whose|whom|can\s+you|could\s+you|would\s+you|will\s+you|do\s+you|did\s+you|are\s+you|were\s+you|have\s+you|tell\s+me|walk\s+me\s+through|describe|explain|design|give\s+me|show\s+me|talk\s+me\s+through)\b/i;

// "And/so/but/because/like" at the very end signals trailing thought.
const TRAIL_OFF_END =
  /\b(and|so|but|because|cause|cuz|like|or|then|with|um|uh|you\s+know|i\s+mean)[\s.,!?…]*$/i;

const TERMINATOR = /[.!?…]\s*$/;

// Behavioural cues — situation-task-action stories.
const BEHAVIOURAL =
  /^(tell\s+me\s+about\s+a\s+time|describe\s+a\s+(situation|time)|walk\s+me\s+through\s+a\s+(time|situation|moment)|give\s+me\s+an\s+example)\b/i;

// System-design cues — open-ended scaling / architecture asks.
const SYSTEM_DESIGN =
  /\b(design\s+(a|an|the)|how\s+would\s+you\s+(scale|build|architect|design)|architect\s+(a|an)|build\s+a\s+system|scale\s+(this|it)\s+to)\b/i;

// Clarification cues — short re-asks.
const CLARIFICATION =
  /^(sorry|wait|hold\s+on|what\s+do\s+you\s+mean|could\s+you\s+repeat|what\s+did\s+you\s+mean|come\s+again)\b/i;

// Technical cues — explain/how-does-X-work asks.
const TECHNICAL =
  /^(explain|how\s+does|how\s+do|what\s+is|what\s+are|why\s+is|why\s+does)\b/i;

function classifyType(text: string): TurnType {
  if (CLARIFICATION.test(text)) return "question_clarification";
  if (BEHAVIOURAL.test(text)) return "question_behavioural";
  if (SYSTEM_DESIGN.test(text)) return "question_system_design";
  if (TECHNICAL.test(text)) return "question_technical";
  if (QUESTION_TRAILING.test(text) || INTERROGATIVE_STARTERS.test(text))
    return "question_technical";
  return "statement";
}

function wordCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}
```

Then update the exported function (keep the L1 guard from Task 1):

```typescript
export function classifyTurn(
  latest: TranscriptEntry,
  _timeline: TranscriptEntry[],
): ClassifyTurnResult {
  if (latest.kind !== "them") {
    return { verdict: "drop", turnType: "banter" };
  }
  const text = latest.text.trim();
  if (!text || isBackchannel(text)) {
    return { verdict: "drop", turnType: "banter" };
  }

  const turnType = classifyType(text);

  // L2 fire — trailing ?, interrogative starter, or long terminated statement.
  if (
    QUESTION_TRAILING.test(text) ||
    INTERROGATIVE_STARTERS.test(text) ||
    BEHAVIOURAL.test(text) ||
    SYSTEM_DESIGN.test(text)
  ) {
    return { verdict: "fire", turnType };
  }
  if (wordCount(text) >= 25 && TERMINATOR.test(text) && !TRAIL_OFF_END.test(text)) {
    return { verdict: "fire", turnType };
  }

  // L2 drop — fragmentary or mid-clause.
  if (TRAIL_OFF_END.test(text)) {
    return { verdict: "drop", turnType };
  }
  if (wordCount(text) < 6 && !QUESTION_TRAILING.test(text)) {
    return { verdict: "drop", turnType };
  }

  return { verdict: "ambiguous", turnType };
}
```

- [ ] **Step 4: Run all turnGate tests**

Run: `npx vitest run tests/turnGate.test.ts`
Expected: PASS — all L1 + L2 cases green.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/turnGate.ts tests/turnGate.test.ts
git commit -m "feat(copilot): L2 rule-based turn classifier with type mapping"
```

---

## Task 3: TriggerMode type and IPC event additions

**Files:**
- Modify: `src/core/types.ts`

We add `TriggerMode` and two new `IPCFromWorker` events the worker will emit during cascade evaluation: `card:thinking` (L3 in flight) and `card:suppressed` (L3 said no, with the reason for debug logs).

- [ ] **Step 1: Add the new types to `src/core/types.ts`**

Edit `src/core/types.ts`. Add after the existing `CopilotMode` definition:

```typescript
export type TriggerMode = "off" | "rules" | "llm";

export const TRIGGER_MODE_DEFAULTS: Record<CopilotMode, TriggerMode> = {
  meeting: "llm",
  interview: "rules",
};
```

Re-export the turn types from turnGate so worker/copilot consumers don't have to import from two places:

```typescript
export type { TurnType, TurnVerdict, ClassifyTurnResult } from "./turnGate.js";
```

Add the two new IPC events to `IPCFromWorker`:

```typescript
export type IPCFromWorker =
  | { kind: "transcript"; line: TranscriptLine }
  | { kind: "status"; status: WorkerStatus; error?: string }
  | { kind: "live"; committed: string; tentative: string }
  | { kind: "card:start"; id: string; ts: number }
  | { kind: "card:thinking"; id: string; ts: number }
  | { kind: "card:suppressed"; id: string; reason: string }
  | { kind: "card:delta"; id: string; delta: string }
  | { kind: "card:done"; id: string }
  | { kind: "card:error"; id: string; msg: string };
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS — the new types are additive, no consumer breaks. (If a `switch` on `IPCFromWorker.kind` lives somewhere and doesn't have a default, this will fail and we handle it inline.)

- [ ] **Step 3: Run the full test suite to make sure nothing broke**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(copilot): trigger-mode and cascade IPC event types"
```

---

## Task 4: turnType threading through buildCopilotMessages

**Files:**
- Modify: `src/core/copilot.ts`
- Modify: `tests/copilot.test.ts`

`buildCopilotMessages` already takes the structured input. We add a `turnType` field that, when set to a non-"banter" / non-"statement" value, renders a `<turn_type>` tag immediately before `<conversation>` so the model can weight its style/length. The cache layering still holds — the static system prompt stays untouched, and the user message gets the new tag.

- [ ] **Step 1: Add failing tests for turnType rendering**

Append to `tests/copilot.test.ts`:

```typescript
import type { TurnType } from "../src/core/types.js";

describe("buildCopilotMessages — turn_type rendering", () => {
  it("renders <turn_type> tag for question types", () => {
    const ms = buildCopilotMessages({
      mode: "interview",
      timeline: [{ kind: "them", text: "Tell me about a tough deadline." }],
      turnType: "question_behavioural" satisfies TurnType,
    });
    expect(ms[1].content).toContain("<turn_type>question_behavioural</turn_type>");
    // turn_type comes before conversation
    expect(ms[1].content.indexOf("<turn_type>"))
      .toBeLessThan(ms[1].content.indexOf("<conversation>"));
  });

  it("omits <turn_type> tag for banter and statement", () => {
    for (const t of ["banter", "statement"] as const) {
      const ms = buildCopilotMessages({
        mode: "meeting",
        timeline: [{ kind: "them", text: "anything" }],
        turnType: t,
      });
      expect(ms[1].content).not.toContain("<turn_type>");
    }
  });

  it("omits <turn_type> tag when turnType is undefined", () => {
    const ms = buildCopilotMessages({
      mode: "meeting",
      timeline: [{ kind: "them", text: "anything" }],
    });
    expect(ms[1].content).not.toContain("<turn_type>");
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `npx vitest run tests/copilot.test.ts -t "turn_type"`
Expected: FAIL — `turnType` field not on input type, tag never rendered.

- [ ] **Step 3: Extend `BuildCopilotMessagesInput` and renderer**

Edit `src/core/copilot.ts`. Update the import to include `TurnType`:

```typescript
import type {
  CopilotMode,
  InterviewContext,
  TranscriptEntry,
  TurnType,
} from "./types.js";
```

Update the input type:

```typescript
export type BuildCopilotMessagesInput = {
  mode: CopilotMode;
  timeline: TranscriptEntry[];
  persona?: string;
  sessionContext?: string;
  interview?: InterviewContext;
  manualTrigger?: boolean;
  turnType?: TurnType;
};
```

Update the function body — emit `<turn_type>` before `<conversation>` in the user message, but only for question types:

```typescript
export function buildCopilotMessages(
  input: BuildCopilotMessagesInput,
): ChatMessage[] {
  const { mode, timeline, manualTrigger, turnType } = input;
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

  const userParts: string[] = [];
  if (turnType && turnType !== "banter" && turnType !== "statement") {
    userParts.push(tag("turn_type", turnType));
  }
  userParts.push(tag("conversation", renderTimeline(timeline)));
  const trigger = manualTrigger
    ? "The user is asking for help now — draft what they should say next."
    : "The other side just finished. Reply as me.";
  userParts.push(trigger);

  return [
    { role: "system", content: sysParts.join("\n\n") },
    { role: "user", content: userParts.join("\n\n") },
  ];
}
```

- [ ] **Step 4: Run all copilot tests**

Run: `npx vitest run tests/copilot.test.ts`
Expected: PASS — new tests pass, existing tests still pass (the user-message format change is additive).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/copilot.ts tests/copilot.test.ts
git commit -m "feat(copilot): render <turn_type> tag in user message"
```

---

## Task 5: runTurnGate (L3 fast-LLM gate) in copilot.ts

**Files:**
- Modify: `src/core/copilot.ts`
- Modify: `tests/copilot.test.ts`

L3 is a single non-streaming Groq call: `llama-3.1-8b-instant`, `temperature: 0`, `max_tokens: 80`, single user message containing static instructions + few-shot + the recent timeline slice. Output is parsed for `Verdict: yes|no` plus a free-form `Reason:` line.

- [ ] **Step 1: Add a failing smoke test for runTurnGate**

Append to `tests/copilot.test.ts`:

```typescript
import { runTurnGate } from "../src/core/copilot.js";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("runTurnGate", () => {
  it("parses Verdict: yes from the model's reply", async () => {
    const fetchImpl = async () =>
      makeJsonResponse({
        choices: [
          {
            message: {
              content:
                "Reason: Direct question to the user.\nVerdict: yes",
            },
          },
        ],
      });
    const r = await runTurnGate({
      apiKey: "k",
      timeline: [{ kind: "them", text: "what's your favourite tradeoff in distributed systems?" }],
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(r.shouldRespond).toBe(true);
    expect(r.reason).toContain("Direct question");
  });

  it("parses Verdict: no", async () => {
    const fetchImpl = async () =>
      makeJsonResponse({
        choices: [
          {
            message: {
              content:
                "Reason: Trails off mid-clause.\nVerdict: no",
            },
          },
        ],
      });
    const r = await runTurnGate({
      apiKey: "k",
      timeline: [{ kind: "them", text: "we built it on Postgres and" }],
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(r.shouldRespond).toBe(false);
  });

  it("fails open (yes) when output is unparseable", async () => {
    const fetchImpl = async () =>
      makeJsonResponse({
        choices: [{ message: { content: "I cannot determine that." } }],
      });
    const r = await runTurnGate({
      apiKey: "k",
      timeline: [{ kind: "them", text: "anything" }],
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(r.shouldRespond).toBe(true);
  });

  it("surfaces non-2xx errors", async () => {
    const fetchImpl = async () =>
      new Response("rate limited", { status: 429 });
    await expect(
      runTurnGate({
        apiKey: "k",
        timeline: [{ kind: "them", text: "x" }],
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow(/429/);
  });
});
```

- [ ] **Step 2: Run tests — they fail**

Run: `npx vitest run tests/copilot.test.ts -t "runTurnGate"`
Expected: FAIL — `runTurnGate` not exported.

- [ ] **Step 3: Implement `runTurnGate` in `src/core/copilot.ts`**

Add to `src/core/copilot.ts`, just below `streamCopilot`:

```typescript
const TURN_GATE_MODEL = "llama-3.1-8b-instant";

/**
 * Static prompt body for the L3 fast-LLM turn gate. Few-shot examples target
 * the cases the L2 rule layer can't already decide (trail-offs, narration,
 * self-correction). Kept as a constant so Groq's prefix cache reuses it
 * across calls.
 */
export const TURN_GATE_PROMPT = `You are a turn-taking gate. Decide whether the user should respond to the LATEST turn from the other side, given the recent conversation.

Answer "yes" if the latest turn:
- asks a question (explicit or implied),
- requests an action, opinion, example, or explanation,
- ends a complete thought clearly directed at the user,
- pauses on a topic where silence would be awkward.

Answer "no" if the latest turn:
- is the other side thinking aloud, narrating, or describing context with more clearly still to come,
- trails off mid-clause (ends on "and", "so", "because", "but", "like"),
- is small talk or filler the user can let pass,
- is the other side answering their own question or self-correcting,
- is directed at someone else (multi-party meeting).

When unsure, prefer "yes" — a missed response is worse than an extra one.

Reply in EXACTLY this format, nothing else:

Reason: <one or two short sentences explaining why>
Verdict: yes
or
Verdict: no

---

Recent conversation:
Them: So we've been growing the team pretty fast this year, hired about twelve engineers since January, and

Reason: Trails off on "and" — they're mid-thought and clearly continuing.
Verdict: no

---

Recent conversation:
Them: We're scaling the data platform, lots of moving pieces. What's your take on how to prioritize that kind of work?

Reason: Direct question to the user after setting up context.
Verdict: yes

---

Recent conversation:
Them: Yeah, that makes sense. Cool, cool.

Reason: Acknowledgement only, no question or implicit ask.
Verdict: no

---

Recent conversation:
Them: I was just thinking out loud, ignore that. Where was I — right, so the architecture had three tiers

Reason: Self-narration, mid-clause, explicitly told the user to ignore.
Verdict: no

---

Recent conversation:
Them: And the thing about Kafka is, you know, it's not always the right answer, especially when

Reason: Mid-sentence, ends on "when" — more is coming.
Verdict: no

---

Recent conversation:`;

export type RunTurnGateOptions = {
  apiKey: string;
  timeline: TranscriptEntry[];
  /** How many tail entries from the timeline to include in the gate prompt. */
  tail?: number;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export type TurnGateResult = {
  shouldRespond: boolean;
  reason: string;
};

function renderGateTimeline(timeline: TranscriptEntry[]): string {
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
 * L3 turn-taking gate. Fail-open: any parse miss or "yes" verdict returns
 * `shouldRespond: true`. Network and HTTP errors are surfaced to the caller —
 * the worker should treat them as fail-open too.
 */
export async function runTurnGate(
  opts: RunTurnGateOptions,
): Promise<TurnGateResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const tail = opts.tail ?? 6;
  const slice = opts.timeline.slice(-tail);
  const userContent = `${TURN_GATE_PROMPT}\n${renderGateTimeline(slice)}\n`;

  const res = await fetchImpl(opts.endpoint ?? DEFAULT_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TURN_GATE_MODEL,
      messages: [{ role: "user", content: userContent }],
      temperature: 0,
      max_tokens: 80,
      stream: false,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groq gate ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "";

  const verdictMatch = content.match(/^Verdict:\s*(yes|no)\b/im);
  const reasonMatch = content.match(/^Reason:\s*(.+)$/im);
  const reason = reasonMatch?.[1]?.trim() ?? "";

  if (!verdictMatch) {
    return { shouldRespond: true, reason: reason || "(unparseable gate output)" };
  }
  return {
    shouldRespond: verdictMatch[1].toLowerCase() === "yes",
    reason,
  };
}
```

- [ ] **Step 4: Run all copilot tests**

Run: `npx vitest run tests/copilot.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/copilot.ts tests/copilot.test.ts
git commit -m "feat(copilot): runTurnGate L3 fast-LLM gate with reason capture"
```

---

## Task 6: triggerMode persistence in keyStore

**Files:**
- Modify: `src/main/keyStore.ts`

- [ ] **Step 1: Add triggerMode to the persisted schema and helpers**

Edit `src/main/keyStore.ts`. Update the `Stored` type and import:

```typescript
import type { CopilotMode, InterviewContext, TriggerMode } from "../core/types.js";

type Stored = {
  groqKeyEnc?: string;
  transcripts?: TranscriptSettings;
  persona?: string;
  sessionContext?: string;
  mode?: CopilotMode;
  interview?: InterviewContext;
  transcriptN?: number;
  triggerMode?: TriggerMode;
};
```

Add helpers at the end of the file:

```typescript
export function getTriggerMode(): TriggerMode | undefined {
  const m = readStore().triggerMode;
  if (m === "off" || m === "rules" || m === "llm") return m;
  return undefined;
}

export function setTriggerMode(m: TriggerMode | undefined): void {
  const s = readStore();
  if (m === "off" || m === "rules" || m === "llm") s.triggerMode = m;
  else delete s.triggerMode;
  writeStore(s);
}
```

Note that `getTriggerMode` returns `undefined` (not a default) when unset — the consumer applies the mode-aware default from `TRIGGER_MODE_DEFAULTS` so that, when the user later flips Mode (Meeting↔Interview), the trigger default flips with it unless they have explicitly overridden.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS (existing tests untouched, no new tests required for plain getter/setter pair).

- [ ] **Step 4: Commit**

```bash
git add src/main/keyStore.ts
git commit -m "feat(config): persist triggerMode in user config"
```

---

## Task 7: Main-process IPC channels for triggerMode

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/worker.ts`
- Modify: `src/preload/overlay.ts`
- Modify: `src/preload/types.d.ts`

Mirror the existing `cfg:get-mode` / `cfg:set-mode` plumbing.

- [ ] **Step 1: Find the existing mode IPC handler in `src/main/index.ts`**

Run: `grep -n "cfg:get-mode\|cfg:set-mode\|cfg:get-transcript-n" src/main/index.ts`
Expected: 4–6 matching lines around the `ipcMain.handle` calls.

- [ ] **Step 2: Add the trigger-mode handlers next to them**

In `src/main/index.ts`, locate the block where `cfg:get-mode` and `cfg:set-mode` are registered. Add these handlers immediately after, importing `getTriggerMode` / `setTriggerMode` from `./keyStore` (extend the existing import line — do not add a new one):

```typescript
ipcMain.handle("cfg:get-trigger-mode", () => getTriggerMode() ?? null);
ipcMain.handle("cfg:set-trigger-mode", (_e, m: "off" | "rules" | "llm" | null) => {
  setTriggerMode(m ?? undefined);
});
```

The `null` pass-through represents "no override — use the mode default" (so users can clear their override).

- [ ] **Step 3: Expose getTriggerMode on the worker preload bridge**

Edit `src/preload/worker.ts`. Find the existing `getMode` / `getTranscriptN` entries (from the grep result earlier they live around lines 12-19) and add a parallel entry:

```typescript
getTriggerMode: (): Promise<"off" | "rules" | "llm" | null> =>
  ipcRenderer.invoke("cfg:get-trigger-mode"),
```

- [ ] **Step 4: Expose get/setTriggerMode on the overlay preload bridge**

Edit `src/preload/overlay.ts`. Add next to the existing `getMode` / `setMode` pair:

```typescript
getTriggerMode: (): Promise<"off" | "rules" | "llm" | null> =>
  ipcRenderer.invoke("cfg:get-trigger-mode"),
setTriggerMode: (m: "off" | "rules" | "llm" | null): Promise<void> =>
  ipcRenderer.invoke("cfg:set-trigger-mode", m),
```

- [ ] **Step 5: Update preload type declarations**

Edit `src/preload/types.d.ts`. Add to **both** the worker bridge interface and the overlay bridge interface (the file declares both); for the worker bridge add only the getter, for the overlay bridge add both:

Worker bridge addition (next to the existing `getMode`):

```typescript
getTriggerMode: () => Promise<"off" | "rules" | "llm" | null>;
```

Overlay bridge addition (next to the existing `getMode` / `setMode`):

```typescript
getTriggerMode: () => Promise<"off" | "rules" | "llm" | null>;
setTriggerMode: (m: "off" | "rules" | "llm" | null) => Promise<void>;
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts src/preload/worker.ts src/preload/overlay.ts src/preload/types.d.ts
git commit -m "feat(ipc): triggerMode get/set channels and bridge methods"
```

---

## Task 8: Worker cascade integration

**Files:**
- Modify: `src/renderer/worker/main.ts`

Replace the direct `runCopilot({ manualTrigger: false })` call inside `checkTurnEnd` with a cascade dispatcher. Manual asks (Ctrl+Shift+Enter) bypass the cascade entirely — that path is already correct in `manualAsk()`.

The cascade evaluates only on a freshly committed `Them:` entry. When `triggerMode === "off"` we preserve today's behavior (fire on every EOT); when `"rules"`, `ambiguous` falls through to fire; when `"llm"`, `ambiguous` escalates to `runTurnGate`.

- [ ] **Step 1: Update imports**

In `src/renderer/worker/main.ts`, extend the existing imports:

```typescript
import { buildCopilotMessages, runTurnGate, streamCopilot } from "../../core/copilot.js";
import { TranscriptManager, isBackchannel } from "../../core/transcript.js";
import { classifyTurn } from "../../core/turnGate.js";
import { TRIGGER_MODE_DEFAULTS } from "../../core/types.js";
import type { IPCToWorker, TriggerMode } from "../../core/types.js";
```

- [ ] **Step 2: Add the cascade dispatcher**

Insert this function in the "end-of-turn detection + copilot runner" section, just above `runCopilot`:

```typescript
async function runCascade(): Promise<void> {
  // Pull the latest 'them' entry from the rolling window. If there isn't one,
  // there's nothing to evaluate.
  const lines = transcripts.recent(50);
  const lastThem = [...lines].reverse().find((l) => l.speaker === "them");
  if (!lastThem) return;

  const timeline = transcripts.getTimeline();
  // Append the in-flight (uncommitted) text as a tail entry so the cascade sees
  // the freshest state — same rule runCopilot applies.
  const tail = lockedText.trim();
  if (tail) timeline.push({ kind: "them", text: tail });

  const latest = { kind: "them" as const, text: tail || lastThem.text };

  const [triggerOverride, mode] = await Promise.all([
    bridge.getTriggerMode().catch(() => null as TriggerMode | null),
    bridge.getMode().catch(() => "meeting" as const),
  ]);
  const triggerMode: TriggerMode =
    triggerOverride ?? TRIGGER_MODE_DEFAULTS[mode];

  // triggerMode === "off" keeps today's behavior: fire on every EOT.
  if (triggerMode === "off") {
    void runCopilot({ manualTrigger: false });
    return;
  }

  const { verdict, turnType } = classifyTurn(latest, timeline);
  if (verdict === "drop") {
    debug(`[ghst cascade] drop (${turnType})`);
    return;
  }
  if (verdict === "fire") {
    debug(`[ghst cascade] fire (${turnType})`);
    void runCopilot({ manualTrigger: false, turnType });
    return;
  }

  // verdict === "ambiguous"
  if (triggerMode === "rules") {
    debug(`[ghst cascade] ambiguous → fire (rules-only)`);
    void runCopilot({ manualTrigger: false, turnType });
    return;
  }

  // triggerMode === "llm" — escalate to L3.
  await runGateAndMaybeFire(timeline, turnType);
}

async function runGateAndMaybeFire(
  timeline: TranscriptEntry[],
  turnType: TurnType,
): Promise<void> {
  // Reuse the activeCopilot slot pattern so a new entry mid-gate aborts cleanly.
  if (activeCopilot) {
    activeCopilot.controller.abort();
    activeCopilot = null;
  }
  const id = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  const slot: { id: string; controller: AbortController; text: string } = {
    id,
    controller,
    text: "",
  };
  activeCopilot = slot;
  bridge.emit({ kind: "card:thinking", id, ts: Date.now() });

  try {
    const r = await runTurnGate({
      apiKey: groqKey,
      timeline,
      signal: controller.signal,
    });
    // If a newer cascade run preempted us mid-gate, bail.
    if (activeCopilot?.id !== id) return;

    if (!r.shouldRespond) {
      debug(`[ghst cascade] gate=no — ${r.reason}`);
      bridge.emit({ kind: "card:suppressed", id, reason: r.reason });
      activeCopilot = null;
      return;
    }
    debug(`[ghst cascade] gate=yes — ${r.reason}`);
    activeCopilot = null;
    void runCopilot({ manualTrigger: false, turnType });
  } catch (err) {
    if (controller.signal.aborted) return;
    // Fail open: gate failure shouldn't block a legitimate suggestion.
    const msg = err instanceof Error ? err.message : String(err);
    debug(`[ghst cascade] gate error — ${msg}, firing anyway`);
    if (activeCopilot?.id === id) activeCopilot = null;
    void runCopilot({ manualTrigger: false, turnType });
  }
}
```

You will also need a top-level `import type { TranscriptEntry, TurnType }` — extend the existing `core/types` import on the same line you updated in Step 1.

- [ ] **Step 3: Update `runCopilot` to accept and forward `turnType`**

In `src/renderer/worker/main.ts`, find the `runCopilot` signature and the `buildCopilotMessages` call inside it (around line 461 / 497 in the current file):

Old:
```typescript
async function runCopilot(opts: { manualTrigger: boolean }): Promise<void> {
```

New:
```typescript
async function runCopilot(opts: { manualTrigger: boolean; turnType?: TurnType }): Promise<void> {
```

Inside the body, update the `buildCopilotMessages` call to pass `turnType`:

```typescript
const messages = buildCopilotMessages({
  mode,
  timeline,
  persona,
  sessionContext,
  interview,
  manualTrigger: opts.manualTrigger,
  turnType: opts.turnType,
});
```

- [ ] **Step 4: Replace the trigger call site in `checkTurnEnd`**

In `checkTurnEnd`, find the existing line (around line 458):

```typescript
debug(`[ghst eot] fired after ${silence}ms silence`);
void runCopilot({ manualTrigger: false });
```

Replace the `runCopilot` call with the cascade entrypoint:

```typescript
debug(`[ghst eot] fired after ${silence}ms silence`);
void runCascade();
```

The `manualAsk()` function stays unchanged — manual asks always bypass the cascade.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: PASS — no test currently exercises the worker entrypoint directly, so nothing should regress.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/worker/main.ts
git commit -m "feat(copilot): wire trigger cascade into worker EOT path"
```

---

## Task 9: Overlay settings UI for triggerMode and thinking affordance

**Files:**
- Modify: `src/renderer/overlay/main.ts`
- Modify: `src/renderer/overlay/style.css`

Two pieces of UI:

1. A Smart-trigger segmented control in the existing Advanced settings section, with three options matching `TriggerMode`. Default behavior: when unset, show the value derived from the current mode (`TRIGGER_MODE_DEFAULTS[mode]`) but flagged as "default"; when set, persist the user's choice via `setTriggerMode`. A small "Reset to mode default" link clears the override.
2. A pulsing-dot affordance on the active suggestion card while `card:thinking` is in flight, fading out on `card:start` (real generation begins) or `card:suppressed` / `card:error`.

- [ ] **Step 1: Add the CSS for the affordance**

Append to `src/renderer/overlay/style.css`:

```css
.copilot-thinking {
  display: inline-flex;
  gap: 4px;
  padding: 6px 10px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.04em;
}
.copilot-thinking .dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.45);
  animation: copilot-thinking-pulse 1.1s ease-in-out infinite;
}
.copilot-thinking .dot:nth-child(2) { animation-delay: 0.18s; }
.copilot-thinking .dot:nth-child(3) { animation-delay: 0.36s; }
@keyframes copilot-thinking-pulse {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
  40%           { opacity: 1;    transform: scale(1.1); }
}
```

- [ ] **Step 2: Wire up the IPC events**

Edit `src/renderer/overlay/main.ts`. Locate the existing message handler that switches on `kind` for `card:start` / `card:delta` / `card:done` / `card:error` (search for `case "card:start"` if you can't find it by context). Add cases for the two new events that mirror how `card:start` creates/updates a card row:

```typescript
case "card:thinking": {
  // Render a transient "thinking…" placeholder card. Reuse the same DOM slot
  // a real card would occupy so card:start can replace it without flicker.
  showThinkingCard(msg.id);
  break;
}
case "card:suppressed": {
  hideThinkingCard(msg.id);
  break;
}
```

Implement `showThinkingCard` and `hideThinkingCard` near the existing card-rendering helpers:

```typescript
function showThinkingCard(id: string): void {
  // Reuse the same container the real card mounts into; the existing
  // card:start handler will replace its inner content with the streaming text.
  const root = document.getElementById("copilot-cards");
  if (!root) return;
  let el = document.getElementById(`card-${id}`);
  if (!el) {
    el = document.createElement("div");
    el.id = `card-${id}`;
    el.className = "copilot-card";
    root.prepend(el);
  }
  el.innerHTML =
    '<div class="copilot-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
}

function hideThinkingCard(id: string): void {
  const el = document.getElementById(`card-${id}`);
  if (el) el.remove();
}
```

If the existing card code uses different DOM ids/classes, mirror those names rather than the placeholder ones above — open the file and grep for `copilot-card` / `card-${` to confirm. Adjust accordingly. The point is: thinking and real-card mount into the same slot.

- [ ] **Step 3: Add the Smart-trigger settings control**

In `src/renderer/overlay/main.ts`, find the existing settings panel rendering (where `getMode` / `setMode` and the Transcript-size input are wired up — grep `getMode\\(\\)` and `getTranscriptN`). Add a parallel block that:

- on settings-open: calls `getMode()` + `getTriggerMode()` to compute the current effective value (override if set, otherwise `TRIGGER_MODE_DEFAULTS[mode]`).
- renders three radio buttons / segmented controls labelled `Off`, `Rules only`, `Rules + LLM gate`.
- on change: calls `setTriggerMode(<value>)`.
- shows a small "Reset to mode default" link when an override is set; clicking it calls `setTriggerMode(null)` and re-renders to the inherited default.

Concrete code (place inside whatever function renders the settings panel — match its style):

```typescript
const TRIGGER_LABELS: Record<"off" | "rules" | "llm", string> = {
  off: "Off (fire on every silence)",
  rules: "Rules only",
  llm: "Rules + LLM gate",
};

async function renderTriggerModeControl(container: HTMLElement): Promise<void> {
  container.innerHTML = "";
  const [mode, override] = await Promise.all([
    window.overlayBridge.getMode(),
    window.overlayBridge.getTriggerMode(),
  ]);
  const defaultForMode: "off" | "rules" | "llm" =
    mode === "interview" ? "rules" : "llm";
  const effective = override ?? defaultForMode;

  const heading = document.createElement("div");
  heading.className = "settings-row-label";
  heading.textContent = "Smart trigger";
  container.appendChild(heading);

  const group = document.createElement("div");
  group.className = "settings-segmented";
  for (const v of ["off", "rules", "llm"] as const) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = TRIGGER_LABELS[v];
    btn.className =
      "settings-segmented__btn" + (v === effective ? " is-active" : "");
    btn.addEventListener("click", async () => {
      await window.overlayBridge.setTriggerMode(v);
      await renderTriggerModeControl(container);
    });
    group.appendChild(btn);
  }
  container.appendChild(group);

  if (override) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "settings-link";
    reset.textContent = `Reset to ${mode} default (${TRIGGER_LABELS[defaultForMode]})`;
    reset.addEventListener("click", async () => {
      await window.overlayBridge.setTriggerMode(null);
      await renderTriggerModeControl(container);
    });
    container.appendChild(reset);
  }
}
```

Then call `renderTriggerModeControl(<container element>)` from the settings-panel-open handler, alongside the existing mode/transcriptN renderers. Use whichever container element fits the existing settings layout (a new `<div>` you append to the Advanced section is fine).

If `style.css` is missing `.settings-segmented`, `.settings-segmented__btn`, or `.is-active` styles, reuse whatever the existing Mode toggle uses; the buttons should look the same.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Manual smoke-check**

- Run `npm run dev`.
- Open the settings panel — confirm the Smart-trigger control appears with the mode-appropriate default selected and no "Reset" link visible.
- Click `Off`, then `Rules only`. Confirm the "Reset to … default" link appears and the active button updates.
- Click the reset link. Confirm the override clears and the link disappears.
- Switch Mode (Meeting↔Interview) and confirm the control's "default" indicator follows the mode.
- Start a session, talk for a few seconds with normal sentences and a deliberate trail-off (`"and so basically..."` then stop). Watch the debug logs (`DEBUG=ghst npm run dev` or `localStorage["ghst:debug"]="1"`):
  - Backchannels should log `[ghst cascade] drop (banter)`.
  - Trail-offs should log `[ghst cascade] drop (statement)`.
  - Real questions should fire and produce a card.
  - In `llm` mode, ambiguous turns should briefly show the thinking dots before either generating or being suppressed.

If any UI element looks wrong (DOM ids/classes differ from what this plan assumed) — fix inline. The behavioral logic in Tasks 1–8 is the load-bearing part; Step 3 above is intentionally adapted-from-context.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/overlay/main.ts src/renderer/overlay/style.css
git commit -m "feat(overlay): smart-trigger settings + thinking affordance"
```

---

## Final verification

- [ ] **Run the full test suite once more**

Run: `npm test`
Expected: PASS — every test green.

- [ ] **Run typecheck once more**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Confirm git log shows nine focused commits**

Run: `git log --oneline main..HEAD`
Expected: nine commits in the order Tasks 1 → 9.
