import { describe, it, expect, vi } from "vitest";
import { transcribe } from "../src/core/groq.js";

const okResponse = (text: string) =>
  new Response(JSON.stringify({ text }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("transcribe", () => {
  it("POSTs multipart to the endpoint with bearer auth and returns text", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      okResponse("hello world"),
    ) as unknown as typeof fetch;

    const result = await transcribe(new Uint8Array([1, 2, 3]), {
      apiKey: "test-key",
      fetchImpl,
      language: "en",
    });

    expect(result.text).toBe("hello world");
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("groq.com");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(init.body).toBeInstanceOf(FormData);

    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("language")).toBe("en");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("includes prompt and temperature when provided", async () => {
    const fetchImpl = vi.fn(async () => okResponse("x")) as unknown as typeof fetch;
    await transcribe(new Uint8Array(), {
      apiKey: "k",
      fetchImpl,
      prompt: "previous context",
      temperature: 0.2,
    });
    const form = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .body as FormData;
    expect(form.get("prompt")).toBe("previous context");
    expect(form.get("temperature")).toBe("0.2");
  });

  it("throws with status and snippet on non-ok response", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("rate limit", { status: 429 }),
    ) as unknown as typeof fetch;
    await expect(
      transcribe(new Uint8Array(), { apiKey: "k", fetchImpl }),
    ).rejects.toThrow(/429/);
  });

  it("trims whitespace from returned text", async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse("   hi there  \n"),
    ) as unknown as typeof fetch;
    const r = await transcribe(new Uint8Array(), { apiKey: "k", fetchImpl });
    expect(r.text).toBe("hi there");
    expect(r.words).toEqual([]);
  });

  it("requests word timestamps when wordTimestamps=true and parses them", async () => {
    const body = {
      text: "hi there",
      words: [
        { word: "hi", start: 0, end: 0.4 },
        { word: "there", start: 0.4, end: 0.8 },
      ],
    };
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const r = await transcribe(new Uint8Array(), {
      apiKey: "k",
      fetchImpl,
      wordTimestamps: true,
    });
    const form = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .body as FormData;
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.getAll("timestamp_granularities[]")).toEqual(["word"]);
    expect(r.words).toHaveLength(2);
    expect(r.words[1]).toEqual({ word: "there", start: 0.4, end: 0.8 });
  });
});
