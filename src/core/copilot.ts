/**
 * Copilot: streams a Groq chat-completions reply on each detected end-of-turn.
 * OpenAI-compatible SSE protocol; parser is decoupled from Electron so it's
 * trivially unit-testable with a mocked fetch.
 */
import type {
  CopilotMode,
  InterviewContext,
  TranscriptEntry,
  TurnType,
} from "./types.js";

const MEETING_RULES = `<rules>
- Don't echo or paraphrase the other side's words back to them.
- No preamble ("Sure...", "Great question..."), no hedging, no reflexive "I think", no "as an AI" leakage.
- Don't repeat points the user already made (visible in You: lines) — build on them or move past.
- If asked about something not covered by the persona or prior You: turns, deflect honestly using adjacent experience. Never invent specifics, names, numbers, or employers.
- Plain spoken prose. No markdown, no bullets, no emojis, no parentheticals, no em-dashes.
</rules>`;

const INTERVIEW_RULES = `<rules>
- Don't echo or paraphrase the interviewer's words back.
- No preamble ("Sure...", "Great question..."), no hedging, no reflexive "I think", no "as an AI" leakage.
- Don't repeat points already made in You: lines — build on them or move past.
- If asked about something not in the persona, prior You: turns, or the job description, deflect honestly using adjacent experience. Never invent specifics, names, numbers, or employers.
- Behavioral question → situation, task, action, result. Concrete and quantified.
- Technical question → direct answer first, then reasoning, then one tradeoff.
- System design → key decisions, tradeoffs, what you'd validate next. Don't enumerate every component.
- If a job description is present, weight examples and vocabulary toward what it emphasizes.
- Plain spoken prose. No markdown, no bullets, no emojis, no parentheticals, no em-dashes.
</rules>`;

const ANTI_PATTERNS = `<anti_patterns>
Bad: "Great question! So what you're asking about is distributed systems, and yes, I have a lot of experience with that..."
Why: echoes the question, hedges, delays the answer.
Good: "Yes. I rebuilt our order pipeline on Kafka last year, cut p99 latency from 800ms to 90."

Bad: "I think, generally speaking, in most cases, the answer would probably be that it depends on the context."
Why: stacks hedges, says nothing.
Good: "It depends on read-write ratio. For our 95% read workload, I'd put a cache in front of Postgres before sharding."

Bad: "As mentioned earlier, the architecture I described uses microservices..."
Why: refers to prior turn instead of just answering.
Good: "We split it into three services: ingest, scoring, and serving. The split was driven by deploy cadence, not load."
</anti_patterns>`;

const OUTPUT_FORMAT = `<output_format>
- First sentence is a complete, standalone answer the user can deliver if they only get that far.
- Then supporting sentences carrying the substance, sized to the length budget below.
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
You are the candidate. The other side is interviewing you. Speak in first person as the user described in the persona block. Every turn is high-stakes; deliver thought-out answers, not reflexes. Read the full conversation before composing your answer.
</role>`;

export const MEETING_SYSTEM_PROMPT =
  `${MEETING_ROLE}\n\n${MEETING_RULES}\n\n${ANTI_PATTERNS}\n\n${OUTPUT_FORMAT}`;

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
  turnType?: TurnType;
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

const DEFAULT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-20b";

/**
 * Stream Groq chat-completions as text deltas. Yields whenever a content
 * chunk arrives; returns when the server sends `[DONE]` or the stream closes.
 * Honors AbortSignal so the caller can cancel a stream mid-flight.
 */
export async function* streamCopilot(
  opts: StreamCopilotOptions,
): AsyncGenerator<string, void, void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(opts.endpoint ?? DEFAULT_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 1500,
      stream: true,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groq chat ${res.status}: ${body.slice(0, 200)}`);
  }
  if (!res.body) throw new Error("Groq chat: empty response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (;;) {
        const idx = buf.indexOf("\n\n");
        if (idx === -1) break;
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          if (!data) continue;
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) yield delta;
          } catch {
            // Ignore malformed frames — rare, but don't kill the stream.
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* stream already released */
    }
  }
}

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
Them: Walk me through the trickiest production incident you've owned end to end.

Reason: Explicit ask for a structured story.
Verdict: yes

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

