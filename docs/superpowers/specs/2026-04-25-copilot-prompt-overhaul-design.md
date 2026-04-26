# Copilot Prompt Overhaul — Design

**Date:** 2026-04-25
**Status:** Draft, awaiting user review
**Touches:** `src/core/copilot.ts`, `src/core/transcript.ts`, `src/core/turnGate.ts` *(new)*, `src/core/types.ts`, `src/main/keyStore.ts`, `src/main/index.ts`, `src/renderer/worker/main.ts`, `src/renderer/overlay/main.ts`, `src/renderer/overlay/style.css`

## Goal

Replace the current single-prose copilot system prompt with an XML-tagged, mode-aware, cache-friendly prompt, and restructure the inputs (transcript + prior suggestions) into a single interleaved timeline. Add an optional Interview mode with structured fields (role / company / job description) on top of the default Meeting mode.

The win comes from three converging changes:

1. **Prompt quality** — XML structure, anti-patterns block, headline+support output, dynamic length budget, speech-readability rules. Aligns with what shipped products in this space (Cluely, Final Round, LockedIn, Pickle's Glass) all do.
2. **Timeline correctness** — interleave prior copilot suggestions with the actual transcript at the position each suggestion was issued, so the model can see what the user actually said in response (followed the suggestion, pivoted, or ignored).
3. **Cache layering** — order the prompt in concentric static rings so Groq's prefix cache reuses as much as possible across turns and across sessions.

## Modes

A single `mode` setting with two values, persisted in the user config alongside the Groq key:

- **`meeting`** *(default)* — generic "what should I say next" copilot. No required fields. Free-form `sessionContext` is the only structured input. The user may be in a sales call, client meeting, sync, negotiation, or casual professional conversation; the model reads the room from the transcript.
- **`interview`** — sharp, candidate-pitching tone. Speaks as the user, optimized for high-stakes Q&A. Adds three optional fields (`role`, `company`, `jobDescription`).

Both modes also use:

- **`persona`** *(global, mode-agnostic)* — durable "about you" the user has already set today.
- **`sessionContext`** *(both modes, free-form)* — typed before recording. In Interview mode it sits *alongside* the structured fields for things like "second round, EM is leading."
- **Prior copilot replies** — interleaved into the transcript timeline (see below).

If Interview mode is selected with all three structured fields blank, the prompt degrades cleanly: the Interview `<role>`/`<rules>` framing is used; the empty tags are simply omitted (not rendered as empty).

## Prompt structure

Two messages — one system, one user. Within the system message, content is ordered by cache lifetime so the longest-lived prefix sits first.

### System message (static, layers 1–3)

```
<role>...mode-specific framing...</role>
<rules>...mode-specific do/don't...</rules>
<anti_patterns>...concrete bad/good examples...</anti_patterns>
<output_format>...headline+support, length budget, speech rules...</output_format>

<persona>...</persona>                          (omit tag if empty)

<role_target>...</role_target>                  (interview only, omit if empty)
<company>...</company>                          (interview only, omit if empty)
<job_description>...</job_description>          (interview only, omit if empty)
<session_notes>...</session_notes>              (omit if empty)
```

**Cache layering:**

| Layer | Lifetime | Tags |
|---|---|---|
| 1 | Identical across all sessions/users on this build | `<role>`, `<rules>`, `<anti_patterns>`, `<output_format>` |
| 2 | Per-user, changes only on persona edit | `<persona>` |
| 3 | Per-session, changes between sessions | `<role_target>`, `<company>`, `<job_description>`, `<session_notes>` |

Empty fields produce *no tag at all*. For a given user within a session, persona is either always present or always absent — so omission does not fragment that user's cache.

### User message (dynamic, layer 4)

```
<conversation>
Them: ...
[You suggested I say: ...]
You: ...
Them: ...
[You suggested I say: ...]
You: ...
Them: ...
</conversation>

The other side just finished. Reply as me.
```

Conversation goes last; the trigger sentence is short and static. The very last variable bytes are the most recent `Them:` lines — where attention should land.

When the user manually triggers the copilot mid-turn (`Ctrl+Shift+Enter` with no fresh `Them:` turn), the trigger sentence becomes:

```
The user is asking for help now — draft what they should say next.
```

The conversation tag still ends on whatever the latest line was.

## Prompt content

### `<role>` per mode

- **Interview**: "You are the candidate. The other side is interviewing you. Speak in first person as the user described in `<persona>`. Every turn is high-stakes; deliver thought-out answers, not reflexes."
- **Meeting**: "You are a live copilot helping the user navigate a conversation. You hear only the other side. Draft what the user should say or know next, in first person as the user. The user may be in a sales call, client meeting, sync, negotiation, or casual professional conversation — read the room from `<conversation>`."

### `<rules>` shared by both modes

- Don't echo or paraphrase the other side's words back.
- Don't preamble ("Sure…", "Great question…"), don't hedge, don't say "I think" reflexively, no "as an AI" leakage.
- Don't repeat points the user already made (visible in `You:` lines) — build on or move past them.
- If asked about something not supported by `<persona>` or prior `You:` turns, deflect honestly using adjacent experience. Never invent specifics, names, numbers, or employers.
- Plain spoken prose. No markdown, no bullets, no emojis, no parentheticals, no em-dashes.

### `<rules>` interview-only additions

- Behavioral → situation-task-action-result, concrete and quantified.
- Technical → direct answer first, then reasoning, then one tradeoff.
- System design → key decisions, tradeoffs, what you'd validate next; don't enumerate every component.
- If `<job_description>` is present, weight examples and vocabulary toward what it emphasizes.

### `<anti_patterns>`

Two or three concrete bad/good pairs with a one-line "why." Example:

> Bad: "Great question! So what you're asking about is distributed systems, and yes, I have a lot of experience with that…"
> Why: echoes the question, hedges, delays the answer.
> Good: "Yes — I rebuilt our order pipeline on Kafka last year, cut p99 latency from 800ms to 90."

### `<output_format>`

- First sentence is a complete, standalone answer the user can deliver if they only get that far.
- Then 2–4 supporting sentences with the substance.
- Length budget by turn type (model self-classifies):
  - light banter / acknowledgement → 1 sentence
  - clarification / yes-no → 1–2 sentences
  - normal question → 3–6 sentences
  - behavioral / system design → 6–10 sentences
  - "tell me more" → expand the previous answer's weakest point
- Sentence cap ~18 words. End on a landable beat, not a trailing clause.
- Avoid tongue-trippers when read cold: "specifically", "particularly", "fundamentally", "essentially".
- Numbers >3 digits spelled out or rounded.

## Transcript timeline

### Counting and eviction

- Counting unit: **transcript entries** (each `Them:` or `You:` line is one entry). Suggestions ride along with their parent `Them:` and do not count against N.
- Default `N = 50`, configurable via an advanced setting alongside mode.
- Eviction: when adding a new entry, if `entries.length > N`, drop from the front until back at N. Suggestions attached to a dropped `Them:` go with it.

### Audio-buffer trim is unchanged

`TranscriptManager`'s entry-count eviction is for the visible transcript window only. The audio-buffer trim using LocalAgreement word end-times stays as-is — separate concern.

### Suggestion anchoring

Each completed copilot reply is anchored to the `Them:` turn that triggered it. Implementation: when main fires the copilot call, capture the index of the most recent `Them:` entry; when streaming finishes, store the final reply text on that entry as `suggestion: string | undefined`.

If the user manually triggers the copilot before any `Them:` turn exists, the suggestion is anchored to the latest entry of any kind. If there are no entries at all, the suggestion is dropped (no useful place to put it).

## Trigger cascade

Today the copilot fires on every VAD-detected end-of-speech (plus the `Ctrl+Shift+Enter` manual hotkey). That over-fires on filler pauses, mid-sentence breaths, and turns that aren't directed at the user, and it fires *every* time even when the new transcript content is just an acknowledgement. We replace the single trigger with a four-layer cascade evaluated in order. The first layer that decides wins; only ambiguous cases reach the LLM gate.

The manual hotkey **bypasses the cascade entirely** — explicit user intent always fires.

### Layers

**L1 — Backchannel / micro-utterance filter.** *Free, deterministic.*

Already implemented as `isBackchannel` in `transcript.ts` (≤3 words, non-question, common-acknowledgement starter) but not currently wired into the trigger path. Reuse it. Also drop turns whose committed text is empty after hallucination filtering. Verdict: **drop**.

**L2 — Cheap rule-based "obviously a turn for me" classifier.** *Free, deterministic, ~ms.*

A new pure function in `src/core/turnGate.ts`. Returns `"fire" | "drop" | "ambiguous"` from the latest `Them:` text plus the rolling timeline. Rules (any of these → `fire`):

- Trailing `?` (after stripping trailing punctuation noise).
- Interrogative starter: `what / how / why / when / where / who / which / can you / could you / would you / do you / are you / have you / tell me / walk me through / describe / explain / design / give me`.
- Imperative ask verbs in clause-initial position (`design`, `explain`, `walk`, `describe`, `tell`, `give`).
- Length ≥ 25 words AND ends in a sentence terminator AND no trailing conjunction (likely a complete prompt even without `?`).

`drop` rules:

- Length < ~6 words AND no question marker AND no named entity (likely a sentence fragment from a paused turn — wait for the next chunk).
- Ends mid-clause on a conjunction / discourse marker (`and`, `so`, `but`, `because`, `like`, `um`, `uh`, `you know`).

Everything else → `ambiguous`.

This layer also produces a `turn_type` tag (`question_behavioural | question_technical | question_system_design | question_clarification | statement | banter`) derived from the same regex/keyword hits, which is **always** passed forward to the prompt builder regardless of which layer ultimately decides — including when L1 drops (the field is just unused in that case). The classifier is the same code path that produces the trigger verdict; we get the type signal for free.

**L3 — Fast-LLM gate.** *Paid, only on `ambiguous`.*

A small Groq call (`llama-3.1-8b-instant`) with a tightly-scoped prompt: a few in/out examples, asks for a single `yes` / `no` token. Inputs: last ~6 entries of the timeline + the candidate `Them:` turn. Output: respond yes/no. This is a separate Groq client call from the main copilot stream — it cannot share the cached system prompt because the task is different. Token budget: ~300 prompt tokens, 1 completion token, target latency 150–300 ms.

The L3 prompt sits next to the system prompts in `copilot.ts` as `TURN_GATE_PROMPT`, with the same care for cache stability (static across sessions).

**L4 — Generate.** Existing `streamCopilot` path, now receiving a `turnType` field in the prompt context.

### Mode-aware defaults

The cascade is parametrised, not one-size-fits-all:

| Mode | L1 | L2 | L3 (LLM gate) |
|---|---|---|---|
| **Interview** | on | on | **off by default** — base rate of "yes" is ~95%, gate is mostly latency burn. User can opt in. |
| **Meeting** | on | on | **on by default** — meetings have side-talk, multi-party turns, statements not directed at the user; the gate earns its keep here. |

When L3 is off, `ambiguous` falls through to `fire` (failing open — better to over-suggest than to silently no-op). When L3 is on and answers `no`, the suggestion is suppressed but the timeline entry is still recorded.

### UX safety net

Three concerns and their mitigations:

- **Gate false-negatives** (L3 says no, user wanted help): the manual hotkey already exists; this is the recovery path. No new UI.
- **Perceived freeze during L3 latency**: the moment L1+L2 pass to L3, the overlay shows a small "thinking…" affordance. If L3 returns `no`, the affordance fades silently. If L3 returns `yes`, generation begins and replaces it. Without this, a 250 ms gate followed by 400 ms first token feels like a 650 ms freeze; with it, the user sees acknowledgement immediately.
- **Cascade overrides on rapid re-trigger**: if a new `Them:` arrives while L3 or L4 is in flight for the previous turn, abort the in-flight call (existing `AbortSignal` plumbing in `streamCopilot`) and restart from L1 on the new entry. The user always wants the freshest answer, never a stale one.

### Settings

Add to the same advanced section as `transcriptN`:

- **Smart trigger** (segmented control or dropdown): `Off` (current behavior — fire on every VAD end-of-speech) / `Rules only` (L1+L2, default for Interview) / `Rules + LLM gate` (L1+L2+L3, default for Meeting).

Persist as `triggerMode: "off" | "rules" | "llm"` in the config alongside `mode`. Existing users without the field get the mode-appropriate default above.

## Code changes

### `src/core/transcript.ts`

`TranscriptManager` switches from time-based to entry-count eviction. Entry shape becomes:

```ts
type TranscriptEntry =
  | { kind: "them"; text: string; suggestion?: string }
  | { kind: "you"; text: string };
```

New methods:

- `getTimeline(): TranscriptEntry[]` — returns the rolling window for the prompt builder.
- `attachSuggestion(text: string)` — finds the latest `Them:` entry (or latest entry of any kind, fallback) and sets `suggestion` to `text`. Replaces the previous suggestion if one is already there (manual re-trigger overwrites).

Existing string-output methods stay for the overlay UI (which renders speaker-tagged lines today).

### `src/core/copilot.ts`

`buildCopilotMessages` signature changes:

```ts
type BuildCopilotMessagesInput = {
  mode: "meeting" | "interview";
  timeline: TranscriptEntry[];
  persona?: string;
  sessionContext?: string;
  interview?: {
    role?: string;
    company?: string;
    jobDescription?: string;
  };
  manualTrigger?: boolean;
  turnType?: TurnType;
};
```

Two prompt constants instead of one: `MEETING_SYSTEM_PROMPT` and `INTERVIEW_SYSTEM_PROMPT`, each containing the layer-1 tags (`<role>`, `<rules>`, `<anti_patterns>`, `<output_format>`). Layer 2/3 tags are appended in code based on which fields are present.

The user-message renderer walks `timeline` and emits `Them:` / `[You suggested I say: …]` / `You:` lines in order, wrapped in `<conversation>…</conversation>`, followed by the trigger sentence (chosen by `manualTrigger`). When `turnType` is supplied (and not `banter`/`statement`), it is rendered as a `<turn_type>…</turn_type>` tag immediately before `<conversation>` so the model can weight its style/length without doing the classification itself.

A second exported function `runTurnGate(input, fetchImpl)` performs the L3 fast-LLM gate. Lives next to `streamCopilot` so both calls share the Groq error-handling path. Uses the static `TURN_GATE_PROMPT` constant. Returns `Promise<{ shouldRespond: boolean }>`. Honors `AbortSignal`.

### `src/core/turnGate.ts` *(new)*

Pure module. Two exports:

```ts
export type TurnType =
  | "question_behavioural"
  | "question_technical"
  | "question_system_design"
  | "question_clarification"
  | "statement"
  | "banter";

export type TurnVerdict = "fire" | "drop" | "ambiguous";

export function classifyTurn(
  latest: TranscriptEntry,
  timeline: TranscriptEntry[],
): { verdict: TurnVerdict; turnType: TurnType };
```

Implements L1+L2 (L1 reuses `isBackchannel` from `transcript.ts`). All deterministic, no I/O. Heavily unit-tested — this is the layer most likely to regress as the rule list evolves.

### `src/core/types.ts`

Add `CopilotMode` and any new IPC payload fields needed to propagate mode + interview context + N from main → worker (worker is the one that builds messages and calls Groq).

### `src/main/keyStore.ts`

Extend the persisted JSON schema:

```ts
type Config = {
  groqKeyEnc?: string;
  persona?: string;          // already present
  sessionContext?: string;   // already present
  mode?: "meeting" | "interview";
  interview?: {
    role?: string;
    company?: string;
    jobDescription?: string;
  };
  transcriptN?: number;
  triggerMode?: "off" | "rules" | "llm";
};
```

Add getter/setter helpers parallel to existing ones. The file mode (`0o600`) and `safeStorage` handling for the key stay as-is — the new fields are plaintext (they're not secrets).

### `src/main/index.ts`

Add IPC channels mirroring the existing key/persona/session-context pattern: `cfg:get-mode` / `cfg:set-mode`, `cfg:get-interview` / `cfg:set-interview`, `cfg:get-transcript-n` / `cfg:set-transcript-n`, `cfg:get-trigger-mode` / `cfg:set-trigger-mode`. Forward changes to the worker so it has the latest values when building messages.

### `src/renderer/worker/main.ts`

Today the worker fires `streamCopilot` directly on each finalised transcript turn. Insert the cascade in front of that call:

1. After committing a `Them:` entry, run `classifyTurn(entry, timeline)`.
2. If `triggerMode === "off"`, fire (current behavior).
3. If verdict is `drop` → no-op (still record the entry, still update the overlay transcript).
4. If verdict is `fire` → call `streamCopilot` with `turnType`.
5. If verdict is `ambiguous`:
   - `triggerMode === "rules"` → fire (fail open).
   - `triggerMode === "llm"` → emit a `evt:copilot-thinking` IPC event, run `runTurnGate`; on `yes` → fire; on `no` → emit `evt:copilot-suppressed` and stop.

Manual-hotkey path skips the cascade entirely and calls `streamCopilot` with `manualTrigger: true` and `turnType` undefined.

If a new `Them:` entry arrives while gate or stream is in flight, abort the in-flight `AbortController` and restart from step 1 on the new entry.

### `src/renderer/overlay/main.ts` and `style.css`

Settings panel additions:

- Mode toggle (radio or segmented control): Meeting / Interview. Default: Meeting.
- Interview-only section (conditionally rendered when mode = interview): three text fields — Role (single line), Company (single line), Job description (multi-line textarea).
- Advanced section: Transcript size (number input, default 50, range 10–200); Smart trigger (segmented control: Off / Rules only / Rules + LLM gate). Default depends on mode — Interview → Rules only, Meeting → Rules + LLM gate.

A small "thinking…" affordance in the suggestion area is rendered while the L3 gate is in flight and during initial generation latency. Style as a low-contrast pulsing dot row; fades out on stream-start or on `evt:copilot-suppressed`.

The existing free-form session-context box stays in both modes.

## Backward compatibility

- Existing user configs without `mode` default to `meeting`. Behavior is the same as today modulo the prompt-quality improvements.
- Existing user configs without `triggerMode` default per mode (Interview → `rules`, Meeting → `llm`). Users who want today's "fire on every VAD end-of-speech" can set it to `off`.
- Existing `persona` and `sessionContext` fields keep their meaning and storage location.
- Anyone who only ever used the app with the old prompt sees better answers immediately, no configuration required.

## Testing

Unit tests live under `tests/*.test.ts`, in line with the project's pure-core convention. New/updated tests:

- `tests/copilot.test.ts` — extend with cases for: meeting mode (no interview fields), interview mode (all fields), interview mode (partial fields), interleaved suggestions in timeline, manual-trigger sentence variant, empty persona/sessionContext omission, `<turn_type>` rendering when supplied vs. omitted for `banter`/`statement`.
- `tests/transcript.test.ts` — extend with cases for: entry-count eviction at N, suggestion attachment to latest `Them:`, suggestion eviction with parent turn, manual-trigger fallback when no `Them:` exists.
- `tests/turnGate.test.ts` *(new)* — `classifyTurn` table-test covering each fire/drop/ambiguous rule and each `turnType` mapping; ensures L1 short-circuit (backchannels return `drop` regardless of other signals); regression cases for known false-positives the rule list is meant to catch.

No new integration tests required; the IPC plumbing follows existing patterns. The L3 LLM gate is exercised via the worker but is not unit-tested directly — it's a thin wrapper around the existing Groq client and would only test the mock.

## Out of scope (future work)

- Two-pass *LLM*-classifier-then-responder (the cascade above adds a binary L3 gate but does not split *generation* across two LLM calls; a richer router that picks model/style up front is a separate change).
- Summarized session memory in `<session_notes>` for very long sessions.
- Streaming the cascade on partial transcripts (mid-utterance speculative generation) — the current design only evaluates on finalised `Them:` entries.
- Replacing the rule-based L2 with a small fine-tuned classifier (e.g. LiveKit's open-weight turn detector). Worth revisiting if rule maintenance becomes a burden or false-fire rates plateau.
- A/B prompt variants behind a flag.
