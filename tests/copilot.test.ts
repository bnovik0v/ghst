import { describe, it, expect } from "vitest";
import {
  buildCopilotMessages,
  streamCopilot,
  COPILOT_SYSTEM_PROMPT,
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

describe("COPILOT_SYSTEM_PROMPT", () => {
  it("explains the You:/Them: convention", () => {
    expect(COPILOT_SYSTEM_PROMPT).toMatch(/You:/);
    expect(COPILOT_SYSTEM_PROMPT).toMatch(/Them:/);
  });
});
