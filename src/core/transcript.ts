import type { Speaker, TranscriptLine, TranscriptEntry } from "./types.js";
import { debug } from "./log.js";

/**
 * Whisper hallucinates certain phrases on silence/noise. Filter them.
 */
const HALLUCINATION_PATTERNS: RegExp[] = [
  /^thanks? for watching[.!]?$/i,
  /^subtitles? (by|from)\b.*/i,
  /\bsubscribe to (the|my|our)\b.*/i,
  /^amara\.?org\b.*/i,
  /^\.?$/,
  /^\[.*\]$/,
  /^\(.*\)$/,
  /^music\b/i,
];

/**
 * Short single-word / filler utterances that just acknowledge the other
 * speaker ("yeah", "ok", "got it", "mhm") aren't real turns — they don't
 * need a transcript row or a copilot reply. We skip them.
 *
 * Heuristic: ≤3 words, doesn't end with a question mark, and starts with
 * one of these common backchannel tokens.
 */
const BACKCHANNEL_STARTERS = new Set([
  "yeah", "yes", "yep", "yup", "no", "nope",
  "ok", "okay", "alright", "mhm", "hmm", "mm",
  "uh-huh", "uhhuh", "huh", "oh", "ah",
  "right", "cool", "sure", "exactly", "true",
  "wow", "nice", "great", "fine", "totally", "absolutely",
  "gotcha", "got", "thanks", "cheers",
]);

export function isBackchannel(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.endsWith("?")) return false; // short questions are NOT backchannels
  const stripped = t.replace(/[.!,;:]+$/, "");
  const words = stripped.split(/\s+/);
  if (words.length === 0) return true;
  if (words.length > 3) return false;
  const first = words[0].toLowerCase().replace(/[^\w-]/g, "");
  return BACKCHANNEL_STARTERS.has(first);
}

export function isLikelyHallucination(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return true;
  return HALLUCINATION_PATTERNS.some((re) => re.test(t));
}

/**
 * Ring buffer of recent transcript lines. Caps length, builds a rolling
 * prompt context for the next Groq call (Whisper uses prompt as prior context).
 */
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
    if (!Number.isFinite(n) || n < 1) {
      debug(`[transcript] setMaxLines ignored invalid n=${n}`);
      return;
    }
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
