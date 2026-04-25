import { MicVAD } from "@ricky0123/vad-web";
import { encodeWav } from "../../core/wav.js";
import { transcribe } from "../../core/groq.js";
import { TranscriptManager, isBackchannel } from "../../core/transcript.js";
import { LocalAgreement, type Word } from "../../core/stream.js";
import { buildCopilotMessages, streamCopilot } from "../../core/copilot.js";
import { debug } from "../../core/log.js";
import type { IPCToWorker } from "../../core/types.js";

const bridge = window.workerBridge;
const transcripts = new TranscriptManager();
const agreement = new LocalAgreement();

const SR = 16000;
const PRE_ROLL_MS = 1000;
const PRE_ROLL_N = (SR * PRE_ROLL_MS) / 1000;
const TICK_MS = 700;
const MIN_TICK_AUDIO_S = 0.6;
const MAX_UTTER_S = 30;
const MAX_IN_FLIGHT = 2;
/** Soft-commit the current locked line once it has a sentence terminator
 *  and is at least this long (chars). Prevents monologues from piling into
 *  one endless row. */
const SOFT_COMMIT_MIN_CHARS = 50;
/** Hard fallback — long line with no sentence end still gets committed. */
const SOFT_COMMIT_HARD_CHARS = 140;

/** End-of-turn detection thresholds (ms since VAD speech_end). */
const EOT_MIN_SILENCE_MS = 900;
const EOT_MAX_SILENCE_MS = 1800;
const EOT_WATCH_INTERVAL_MS = 200;
/** After firing EOT, suppress re-fire for this long to avoid double-triggers. */
const EOT_COOLDOWN_MS = 3000;
/** Copilot prompt uses the last this-many milliseconds of transcript. */
const COPILOT_CONTEXT_MS = 60_000;

let vad: Awaited<ReturnType<typeof MicVAD.new>> | null = null;
let audioCtx: AudioContext | null = null;
let pcmNode: AudioWorkletNode | null = null;
let streamOut: MediaStream | null = null;
let selfVad: Awaited<ReturnType<typeof MicVAD.new>> | null = null;
let selfMediaStream: MediaStream | null = null;
let selfNoticeShown = false;
let groqKey = "";
let tickTimer: ReturnType<typeof setInterval> | null = null;
let eotTimer: ReturnType<typeof setInterval> | null = null;
let lastSpeechEndAt: number | null = null;
let lastTurnFiredAt = 0;
let activeCopilot: {
  id: string;
  controller: AbortController;
  text: string;
} | null = null;
/** Last N completed copilot replies, oldest → newest. Passed back into the
 *  LLM so it can build on or pivot from prior suggestions. */
const priorReplies: string[] = [];
const MAX_PRIOR_REPLIES = 3;

// ─── rolling buffers ─────────────────────────────────────────────────────────
const preRoll = new Float32Array(PRE_ROLL_N);
let preRollPos = 0;
let preRollFull = false;
const utter: Float32Array[] = [];
let utterSamples = 0;
let inSpeech = false;
let inFlight = 0;
/** Committed text for the current utterance — what trim has locked in. */
let lockedText = "";

function log(msg: string): void {
  debug("[ghst worker]", msg);
}

function pushPreRoll(s: Float32Array): void {
  for (let i = 0; i < s.length; i++) {
    preRoll[preRollPos] = s[i];
    preRollPos = (preRollPos + 1) % PRE_ROLL_N;
    if (preRollPos === 0) preRollFull = true;
  }
}

function drainPreRoll(): Float32Array {
  if (!preRollFull) return preRoll.slice(0, preRollPos);
  const out = new Float32Array(PRE_ROLL_N);
  out.set(preRoll.subarray(preRollPos));
  out.set(preRoll.subarray(0, preRollPos), PRE_ROLL_N - preRollPos);
  return out;
}

function appendUtter(s: Float32Array): void {
  utter.push(s);
  utterSamples += s.length;
  const cap = MAX_UTTER_S * SR;
  while (utterSamples > cap && utter.length > 1) {
    const g = utter.shift()!;
    utterSamples -= g.length;
  }
}

function concatUtter(): Float32Array {
  const out = new Float32Array(utterSamples);
  let off = 0;
  for (const c of utter) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function resetUtter(): void {
  utter.length = 0;
  utterSamples = 0;
}

/**
 * Drop the first `samples` samples from the front of `utter`. Walks the
 * chunk list so partial chunks at the boundary are sliced in-place.
 */
function trimUtterFront(samples: number): void {
  let remaining = Math.min(samples, utterSamples);
  while (remaining > 0 && utter.length > 0) {
    const head = utter[0];
    if (head.length <= remaining) {
      utter.shift();
      utterSamples -= head.length;
      remaining -= head.length;
    } else {
      utter[0] = head.subarray(remaining);
      utterSamples -= remaining;
      remaining = 0;
    }
  }
}

function joinWithSpace(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

function endsWithSentence(text: string): boolean {
  return /[.!?](["'”’)\]\s]*)$/.test(text.trim());
}

/** If the current locked line is long/complete enough, send it as a finished
 *  transcript line and reset. Keeps overlay rows short during monologues. */
function maybeSoftCommit(): void {
  const t = lockedText.trim();
  if (!t) return;
  const ready =
    (endsWithSentence(t) && t.length >= SOFT_COMMIT_MIN_CHARS) ||
    t.length >= SOFT_COMMIT_HARD_CHARS;
  if (!ready) return;
  const line = transcripts.add(t, "them");
  if (line) bridge.emit({ kind: "transcript", line });
  lockedText = "";
}

// ─── worklet-backed MediaStream for MicVAD ──────────────────────────────────
const WORKLET_SRC = `
const CAP = 8000;
class PcmSource extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = [];
    this.pos = 0;
    this.total = 0;
    this.port.onmessage = (e) => {
      if (!(e.data instanceof Float32Array)) return;
      this.q.push(e.data);
      this.total += e.data.length;
      while (this.total - (this.q[0] ? this.q[0].length - this.pos : 0) > CAP) {
        const h = this.q.shift();
        this.total -= (h.length - this.pos);
        this.pos = 0;
      }
    };
  }
  process(_i, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      const h = this.q[0];
      if (!h) { out[i] = 0; continue; }
      out[i] = h[this.pos++];
      this.total--;
      if (this.pos >= h.length) { this.q.shift(); this.pos = 0; }
    }
    return true;
  }
}
registerProcessor('pcm-source', PcmSource);
`;

async function createPcmStream(): Promise<MediaStream> {
  audioCtx = new AudioContext({ sampleRate: SR });
  const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  pcmNode = new AudioWorkletNode(audioCtx, "pcm-source");
  const dest = audioCtx.createMediaStreamDestination();
  pcmNode.connect(dest);
  return dest.stream;
}

function wirePcm(): void {
  bridge.onPcm((chunk) => {
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const samples = new Float32Array(chunk.byteLength / 2);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = view.getInt16(i * 2, true) / 0x8000;
    }
    // Always-on pre-roll so speech_start can backfill a full second.
    pushPreRoll(samples);
    if (inSpeech) appendUtter(samples);
    // Feed VAD. Don't transfer the buffer — we already used it above.
    pcmNode?.port.postMessage(samples);
  });
}

// ─── self capture ────────────────────────────────────────────────────────────

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
        error: "Mic unavailable — only the other side will be transcribed.",
      });
    }
    return;
  }

  try {
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
  } catch (err) {
    console.warn("[ghst self] MicVAD init failed:", err);
    if (selfMediaStream) {
      for (const t of selfMediaStream.getTracks()) t.stop();
      selfMediaStream = null;
    }
    selfVad = null;
    return;
  }
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

// ─── Groq calls ──────────────────────────────────────────────────────────────

async function transcribeWithWords(audio: Float32Array): Promise<{
  text: string;
  words: Word[];
}> {
  const wav = encodeWav(audio, SR);
  const { text, words } = await transcribe(wav, {
    apiKey: groqKey,
    language: "en",
    // Carry committed text as prompt so Whisper keeps fluent continuity.
    prompt: joinWithSpace(transcripts.promptContext(), lockedText).slice(-240),
    temperature: 0,
    wordTimestamps: true,
  });
  const wordObjs: Word[] = words.map((w) => ({
    text: w.word,
    start: w.start,
    end: w.end,
  }));
  return { text, words: wordObjs };
}

/**
 * Transcribe current buffer, run LocalAgreement-2. When the committed prefix
 * grows, lock that prefix into `lockedText` and trim the audio buffer past
 * the last committed word's end time. This is how whisper_streaming makes
 * forward progress on long utterances without a silence gap.
 */
async function tick(): Promise<void> {
  if (!inSpeech) return;
  if (inFlight >= MAX_IN_FLIGHT) return;
  if (utterSamples < MIN_TICK_AUDIO_S * SR) return;
  const audio = concatUtter();
  const audioSec = audio.length / SR;
  const t0 = performance.now();
  inFlight++;
  try {
    const { words } = await transcribeWithWords(audio);
    const rtt = Math.round(performance.now() - t0);
    if (!inSpeech) return;

    const upd = agreement.updateWords(words);
    let tentative = upd.tentative;

    if (agreement.committedWordCount > 0) {
      const { words: committed, endSec } = agreement.drainWords();
      const committedText = committed.map((w) => w.text).join(" ");
      lockedText = joinWithSpace(lockedText, committedText);
      if (endSec > 0) trimUtterFront(Math.round(endSec * SR));
      debug(
        `[ghst tick] +${committed.length}w audio=${audioSec.toFixed(2)}s ` +
          `rtt=${rtt}ms locked="${lockedText.slice(-60)}" tent="${tentative.slice(0, 40)}"`,
      );
      maybeSoftCommit();
    } else {
      debug(
        `[ghst tick] +0w audio=${audioSec.toFixed(2)}s rtt=${rtt}ms ` +
          `tent="${tentative.slice(0, 40)}"`,
      );
    }

    bridge.emit({ kind: "live", committed: lockedText, tentative });
  } catch (err) {
    console.warn("[ghst tick] error:", err);
  } finally {
    inFlight--;
  }
}

async function finalize(): Promise<void> {
  const audio = concatUtter();
  resetUtter();
  let final = "";
  try {
    if (audio.length >= SR * 0.15) {
      const wav = encodeWav(audio, SR);
      const { text } = await transcribe(wav, {
        apiKey: groqKey,
        language: "en",
        prompt: joinWithSpace(transcripts.promptContext(), lockedText).slice(-240),
        temperature: 0,
      });
      lockedText = joinWithSpace(lockedText, text);
    }
    final = lockedText.trim();
    if (!final) return;
    if (isBackchannel(final)) {
      debug(`[ghst worker] skipped backchannel: "${final}"`);
      return;
    }
    const line = transcripts.add(final, "them");
    if (line) bridge.emit({ kind: "transcript", line });
  } catch (err) {
    console.warn("[ghst finalize] error:", err);
  } finally {
    lockedText = "";
    agreement.reset();
    bridge.emit({ kind: "live", committed: "", tentative: "" });
    // Only arm the EOT watchdog if this was a real turn worth replying to.
    lastSpeechEndAt = final && !isBackchannel(final) ? Date.now() : null;
  }
}

// ─── end-of-turn detection + copilot runner ──────────────────────────────────

function contextForCopilot(): string {
  const cutoff = Date.now() - COPILOT_CONTEXT_MS;
  const lines = transcripts
    .recent(50)
    .filter((l) => l.receivedAt >= cutoff)
    .map((l) => `${l.speaker === "self" ? "You" : "Them"}: ${l.text}`);
  // Include the in-progress (not-yet-committed) them-utterance so a manual ask
  // mid-speech has the freshest context available. lockedText only ever holds
  // them-side speech (self pipeline doesn't use locked text).
  const tail = lockedText.trim();
  if (tail) lines.push(`Them: ${tail}`);
  return lines.join("\n").trim();
}

function manualAsk(): void {
  const ctx = contextForCopilot();
  if (!ctx) {
    debug("[ghst ask] skipped — no context yet");
    return;
  }
  debug(`[ghst ask] manual, context=${ctx.length}ch`);
  // Reset EOT debounce so an auto-fire can still happen later in the same
  // silence window without colliding with this manual call.
  lastSpeechEndAt = null;
  void runCopilot(ctx);
}

function endsWithTerminator(text: string): boolean {
  return /[.!?…](["'”’)\]\s]*)$/.test(text.trim());
}

function checkTurnEnd(): void {
  if (inSpeech) return;
  if (lastSpeechEndAt == null) return;
  const silence = Date.now() - lastSpeechEndAt;
  if (silence < EOT_MIN_SILENCE_MS) return;

  // Only react to the OTHER side finishing — never auto-fire when the user
  // just finished talking.
  const recent = transcripts.recent(5).filter((l) => l.speaker === "them");
  if (recent.length === 0) return;
  const lastText = recent[recent.length - 1].text;
  const terminates = endsWithTerminator(lastText);

  const fire =
    silence >= EOT_MAX_SILENCE_MS ||
    (silence >= EOT_MIN_SILENCE_MS && terminates);
  if (!fire) return;

  // Debounce: once fired for this turn, don't re-fire until the next speech_end.
  lastSpeechEndAt = null;
  if (Date.now() - lastTurnFiredAt < EOT_COOLDOWN_MS) return;
  lastTurnFiredAt = Date.now();

  const ctx = contextForCopilot();
  if (!ctx) return;
  debug(
    `[ghst eot] fired after ${silence}ms silence, context=${ctx.length}ch`,
  );
  void runCopilot(ctx);
}

async function runCopilot(context: string): Promise<void> {
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
    // Pulled fresh each run so persona edits in Settings take effect
    // without restarting the listener.
    const persona = await bridge.getPersona().catch(() => "");
    const messages = buildCopilotMessages(context, priorReplies, persona);
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
      if (finalText) {
        priorReplies.push(finalText);
        while (priorReplies.length > MAX_PRIOR_REPLIES) priorReplies.shift();
      }
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

function abortCard(id: string): void {
  if (activeCopilot?.id === id) {
    activeCopilot.controller.abort();
    activeCopilot = null;
  }
}

// ─── lifecycle ───────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  if (vad) return;
  if (!groqKey) groqKey = await bridge.getGroqKey();
  if (!groqKey) {
    bridge.emit({ kind: "status", status: "error", error: "Groq API key missing — open settings to add one." });
    return;
  }
  try {
    log("starting native capture…");
    await bridge.startCapture();
    if (!streamOut) {
      streamOut = await createPcmStream();
      wirePcm();
    }
    log("initializing VAD…");
    vad = await MicVAD.new({
      model: "v5",
      baseAssetPath: "/vad/",
      onnxWASMBasePath: "/vad/",
      positiveSpeechThreshold: 0.35,
      negativeSpeechThreshold: 0.25,
      minSpeechMs: 120,
      redemptionMs: 400,
      preSpeechPadMs: 120,
      getStream: async () => streamOut!,
      pauseStream: async () => {},
      resumeStream: async (s) => s,
      onSpeechStart: () => {
        debug("[ghst worker] speech start");
        inSpeech = true;
        lastSpeechEndAt = null;
        agreement.reset();
        lockedText = "";
        resetUtter();
        appendUtter(drainPreRoll());
        bridge.emit({ kind: "live", committed: "", tentative: "" });
      },
      onSpeechEnd: () => {
        debug(`[ghst worker] speech end (utter=${(utterSamples / SR).toFixed(2)}s)`);
        inSpeech = false;
        void finalize();
      },
      onVADMisfire: () => {
        inSpeech = false;
        resetUtter();
        lockedText = "";
        agreement.reset();
        lastSpeechEndAt = null;
        bridge.emit({ kind: "live", committed: "", tentative: "" });
      },
    });
    vad.start();
    if (!tickTimer) tickTimer = setInterval(() => void tick(), TICK_MS);
    if (!eotTimer) eotTimer = setInterval(checkTurnEnd, EOT_WATCH_INTERVAL_MS);
    // Fire-and-forget so a slow / hanging getUserMedia (e.g. waiting on a
    // permission decision) cannot block the them-pipeline from going live.
    void startSelfCapture();
    bridge.emit({ kind: "status", status: "listening" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ghst worker] start failed:", err);
    bridge.emit({ kind: "status", status: "error", error: msg });
  }
}

async function stop(): Promise<void> {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (eotTimer) {
    clearInterval(eotTimer);
    eotTimer = null;
  }
  if (activeCopilot) {
    activeCopilot.controller.abort();
    activeCopilot = null;
  }
  lastSpeechEndAt = null;
  inSpeech = false;
  resetUtter();
  lockedText = "";
  agreement.reset();
  vad?.destroy();
  vad = null;
  await stopSelfCapture();
  await bridge.stopCapture();
  bridge.emit({ kind: "live", committed: "", tentative: "" });
  bridge.emit({ kind: "status", status: "idle" });
}

function clearContext(): void {
  transcripts.clear();
  lockedText = "";
  agreement.reset();
  lastSpeechEndAt = null;
  lastTurnFiredAt = 0;
  priorReplies.length = 0;
  if (activeCopilot) {
    activeCopilot.controller.abort();
    activeCopilot = null;
  }
  bridge.emit({ kind: "live", committed: "", tentative: "" });
  debug("[ghst worker] context cleared");
}

bridge.onCommand((msg: IPCToWorker) => {
  if (msg.kind === "start") void start();
  else if (msg.kind === "stop") void stop();
  else if (msg.kind === "card:dismiss") abortCard(msg.id);
  else if (msg.kind === "copilot:trigger") manualAsk();
  else if (msg.kind === "clear-context") clearContext();
});

bridge.emit({ kind: "status", status: "idle" });
