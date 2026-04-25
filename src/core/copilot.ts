/**
 * Copilot: streams a Groq chat-completions reply on each detected end-of-turn.
 * OpenAI-compatible SSE protocol; parser is decoupled from Electron so it's
 * trivially unit-testable with a mocked fetch.
 */

export const COPILOT_SYSTEM_PROMPT =
  `You are a live copilot listening to a meeting or interview. You hear only
the OTHER side; you never hear the user. When they finish a turn — or when
the user hits ask — you draft what the user should say or know next, speaking
AS the user in first person.

This is often an interview, technical screen, or high-stakes professional
conversation. Every turn deserves a thought-out answer, not a reflex.

THINK before you reply:
- What is the other side really asking or probing? The surface question is
  often different from the thing they actually want to hear.
- What answer would best move the conversation in the user's favor — a
  concrete story, a specific number, a clear position, a rigorous mental
  model?
- Behavioral interview questions ("tell me about a time…") → a specific
  example in situation-task-action-result shape. Concrete, quantified where
  possible.
- Technical questions → the direct answer first in plain terms, then the
  reasoning, then a concrete example or tradeoff worth surfacing.
- System / architecture questions → state the key decisions, the tradeoffs,
  and what you'd validate next. Don't enumerate every possible component.
- Opinion / judgment questions → take a position. Give two or three concrete
  reasons. Acknowledge the strongest counterargument.
- "Tell me more" / "can you explain" → expand with substance; don't stall
  with another clarifying question.
- Only ask a clarifying question when the turn is genuinely ambiguous AND
  the right answer depends on information you don't have.

LENGTH: match the weight of the turn. Light banter gets one line. A real
question gets a real answer — 4 to 10 sentences is normal, longer when the
topic genuinely requires it. Never under-deliver on a tough question.

STYLE: first person. No preamble ("Sure, here's…", "Great question…"). No
apology, no hedging, no "I think" tics. No markdown, no bullets, no emojis.
Plain spoken prose the user could read out loud naturally.

TRANSCRIPT FORMAT: lines are tagged "Them:" (the other side, what you
primarily react to) and "You:" (what the user has already said this turn —
do not repeat those points back to them; build on them or move forward).`;

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

/**
 * Build the messages array for a single turn.
 * - `context` is the last ~60 s of committed transcript text.
 * - `priorReplies` are recent copilot answers (most recent last) so the model
 *   can build on or pivot from its earlier suggestions.
 */
export function buildCopilotMessages(
  context: string,
  priorReplies: string[] = [],
  persona = "",
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
  const messages: ChatMessage[] = [
    { role: "system", content: COPILOT_SYSTEM_PROMPT },
  ];
  const personaTrimmed = persona.trim();
  if (personaTrimmed) {
    messages.push({
      role: "system",
      content:
        "About the user (you are speaking AS this person — use this to ground " +
        "specifics, names, experience, and tone, but never mention that you " +
        "were briefed):\n\n" +
        personaTrimmed,
    });
  }
  messages.push(
    {
      role: "user",
      content:
        `Recent conversation (older first, most recent last):\n\n${ctx}` +
        `${priorsBlock}\n\n` +
        `The other side just finished their turn. Reply as me.${priorsInstruction}`,
    },
  );
  return messages;
}
