/**
 * LocalAgreement-2 over rolling Whisper hypotheses.
 *
 * Whisper returns a full-buffer transcript on each call. The early words are
 * usually stable; the last 1–2 words often change once more audio arrives.
 * LocalAgreement treats a token as "committed" when two successive hypotheses
 * agree on it from the start. Everything past that is tentative and shown
 * greyed until confirmed.
 *
 * Reference: Macháček, Dabre, Bojar — "Turning Whisper into Real-Time
 * Transcription System" (arXiv:2307.14743).
 */

export function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function normalize(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

export function commonPrefix(a: string[], b: string[]): string[] {
  const out: string[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (normalize(a[i]) !== normalize(b[i])) break;
    out.push(b[i]);
  }
  return out;
}

export type Word = { text: string; start: number; end: number };

export function commonPrefixWords(a: Word[], b: Word[]): Word[] {
  const out: Word[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (normalize(a[i].text) !== normalize(b[i].text)) break;
    out.push(b[i]);
  }
  return out;
}

export type LiveUpdate = { committed: string; tentative: string };

export class LocalAgreement {
  private committed: string[] = [];
  private committedWords: Word[] = [];
  private prev: string[] | null = null;
  private prevWords: Word[] | null = null;

  update(text: string): LiveUpdate {
    const hyp = tokenize(text);
    if (this.prev) {
      const agreed = commonPrefix(this.prev, hyp);
      if (agreed.length > this.committed.length) this.committed = agreed;
    }
    this.prev = hyp;
    return {
      committed: this.committed.join(" "),
      tentative: hyp.slice(this.committed.length).join(" "),
    };
  }

  /** Word-level variant — required for audio-buffer trimming. */
  updateWords(words: Word[]): LiveUpdate {
    if (this.prevWords) {
      const agreed = commonPrefixWords(this.prevWords, words);
      if (agreed.length > this.committedWords.length) this.committedWords = agreed;
    }
    this.prevWords = words;
    return {
      committed: this.committedWords.map((w) => w.text).join(" "),
      tentative: words
        .slice(this.committedWords.length)
        .map((w) => w.text)
        .join(" "),
    };
  }

  /**
   * Take committed words out so the caller can trim audio past their end time.
   * After draining, LocalAgreement starts fresh — the next two hypotheses on
   * the trimmed buffer will converge on a new committed prefix.
   */
  drainWords(): { words: Word[]; endSec: number } {
    const words = this.committedWords;
    const endSec = words.length ? words[words.length - 1].end : 0;
    this.committedWords = [];
    this.prevWords = null;
    return { words, endSec };
  }

  finalize(text: string): string {
    const hyp = tokenize(text);
    this.committed = hyp;
    this.prev = hyp;
    return hyp.join(" ");
  }

  reset(): void {
    this.committed = [];
    this.committedWords = [];
    this.prev = null;
    this.prevWords = null;
  }

  get committedLength(): number {
    return this.committed.length;
  }

  get committedWordCount(): number {
    return this.committedWords.length;
  }
}
