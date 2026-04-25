import type { Speaker, TranscriptLine } from "./types.js";

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
  constructor(private readonly maxLines = 50) {}

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
