import { describe, it, expect } from "vitest";
import {
  buildCopilotMessages,
  streamCopilot,
  MEETING_SYSTEM_PROMPT,
  INTERVIEW_SYSTEM_PROMPT,
} from "../src/core/copilot.js";

function makeStream(chunks: string[]): Response {
  const enc = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(chunks[i++]));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function collect(iter: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

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

describe("streamCopilot", () => {
  const args = {
    apiKey: "k",
    messages: [{ role: "user" as const, content: "hi" }],
  };

  it("yields content deltas in order", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const fetchImpl = (async () => makeStream(chunks)) as unknown as typeof fetch;
    const out = await collect(streamCopilot({ ...args, fetchImpl }));
    expect(out.join("")).toBe("Hi there");
  });

  it("skips empty or missing content frames", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":""}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const fetchImpl = (async () => makeStream(chunks)) as unknown as typeof fetch;
    expect(await collect(streamCopilot({ ...args, fetchImpl }))).toEqual(["x"]);
  });

  it("splits frames across chunk boundaries", async () => {
    const chunks = [
      'data: {"choices":[{"delt',
      'a":{"content":"hello"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const fetchImpl = (async () => makeStream(chunks)) as unknown as typeof fetch;
    expect(await collect(streamCopilot({ ...args, fetchImpl }))).toEqual(["hello"]);
  });

  it("terminates on [DONE] and ignores any further frames", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
      "data: [DONE]\n\n",
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
    ];
    const fetchImpl = (async () => makeStream(chunks)) as unknown as typeof fetch;
    expect(await collect(streamCopilot({ ...args, fetchImpl }))).toEqual(["a"]);
  });

  it("ignores malformed JSON frames without killing the stream", async () => {
    const chunks = [
      "data: not-json\n\n",
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const fetchImpl = (async () => makeStream(chunks)) as unknown as typeof fetch;
    expect(await collect(streamCopilot({ ...args, fetchImpl }))).toEqual(["ok"]);
  });

  it("throws on non-ok status with status code in the message", async () => {
    const fetchImpl = (async () =>
      new Response("rate limit", { status: 429 })) as unknown as typeof fetch;
    await expect(collect(streamCopilot({ ...args, fetchImpl }))).rejects.toThrow(
      /429/,
    );
  });

  it("sends the expected body shape", async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      captured = { url, init };
      return makeStream(["data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;
    await collect(
      streamCopilot({
        apiKey: "secret",
        messages: [{ role: "user", content: "x" }],
        fetchImpl,
      }),
    );
    expect(captured!.url).toContain("chat/completions");
    const headers = captured!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret");
    const body = JSON.parse(captured!.init!.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe("openai/gpt-oss-20b");
    expect(body.messages[0].content).toBe("x");
  });
});

describe("system prompts", () => {
  it("both prompts mention the conversation block", () => {
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

describe("buildCopilotMessages — turn_type rendering", () => {
  it("renders <turn_type> tag for question types", () => {
    const ms = buildCopilotMessages({
      mode: "interview",
      timeline: [{ kind: "them", text: "Tell me about a tough deadline." }],
      turnType: "question_behavioural",
    });
    expect(ms[1].content).toContain("<turn_type>");
    expect(ms[1].content).toContain("question_behavioural");
    expect(ms[1].content).toContain("</turn_type>");
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
