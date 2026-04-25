export type GroqTranscribeOptions = {
  apiKey: string;
  model?: string;
  language?: string;
  prompt?: string;
  temperature?: number;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  /** Request per-word start/end timestamps (implies verbose_json). */
  wordTimestamps?: boolean;
};

export type TranscriptionWord = { word: string; start: number; end: number };

export type GroqTranscription = {
  text: string;
  words: TranscriptionWord[];
  raw: unknown;
};

const DEFAULT_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

/**
 * POST WAV bytes to Groq's OpenAI-compatible transcription endpoint.
 * Hallucination filter lives upstream (VAD-gated chunks) — this stays thin.
 */
export async function transcribe(
  wav: Uint8Array,
  opts: GroqTranscribeOptions,
): Promise<GroqTranscription> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const form = new FormData();
  // Copy into a fresh ArrayBuffer to satisfy Blob's BlobPart type.
  const buf = wav.slice().buffer as ArrayBuffer;
  form.append("file", new Blob([buf], { type: "audio/wav" }), "chunk.wav");
  form.append("model", opts.model ?? "whisper-large-v3-turbo");
  form.append("response_format", opts.wordTimestamps ? "verbose_json" : "json");
  if (opts.wordTimestamps) form.append("timestamp_granularities[]", "word");
  form.append("temperature", String(opts.temperature ?? 0));
  if (opts.language) form.append("language", opts.language);
  if (opts.prompt) form.append("prompt", opts.prompt);

  const res = await fetchImpl(opts.endpoint ?? DEFAULT_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { text?: string; words?: TranscriptionWord[] };
  return {
    text: (json.text ?? "").trim(),
    words: json.words ?? [],
    raw: json,
  };
}
