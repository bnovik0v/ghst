import { app, safeStorage } from "electron";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CopilotMode, InterviewContext } from "../core/types.js";

export type TranscriptSettings = {
  enabled: boolean;
  dir: string;
};

type Stored = {
  groqKeyEnc?: string;
  transcripts?: TranscriptSettings;
  persona?: string;
  sessionContext?: string;
  mode?: CopilotMode;
  interview?: InterviewContext;
  transcriptN?: number;
};

/** Hard cap on persona length so a runaway paste can't bloat every Groq
 *  request. ~4k chars ≈ 1k tokens. */
export const PERSONA_MAX_CHARS = 4000;

/** Hard cap on session context length, same rationale as PERSONA_MAX_CHARS. */
export const SESSION_CONTEXT_MAX_CHARS = 4000;

export function defaultTranscriptDir(): string {
  return join(app.getPath("documents"), "ghst", "transcripts");
}

function configPath(): string {
  return join(app.getPath("userData"), "config.json");
}

function readStore(): Stored {
  const p = configPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Stored;
  } catch {
    return {};
  }
}

function writeStore(s: Stored): void {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(s, null, 2), { mode: 0o600 });
}

export function getGroqKey(): string {
  const stored = readStore().groqKeyEnc;
  if (stored && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(stored, "base64"));
    } catch {
      // Corrupted entry — fall through to env.
    }
  }
  return process.env.GROQ_API_KEY ?? "";
}

export function setGroqKey(key: string): void {
  const trimmed = key.trim();
  const s = readStore();
  if (!trimmed) {
    delete s.groqKeyEnc;
  } else if (safeStorage.isEncryptionAvailable()) {
    s.groqKeyEnc = safeStorage.encryptString(trimmed).toString("base64");
  } else {
    // No OS keyring available (rare on Linux without libsecret). Refuse to
    // write plaintext to disk — caller should surface this to the user.
    throw new Error("Secure storage unavailable on this system");
  }
  writeStore(s);
}

export function clearGroqKey(): void {
  const s = readStore();
  delete s.groqKeyEnc;
  writeStore(s);
}

export function hasGroqKey(): boolean {
  return getGroqKey().length > 0;
}

export function getTranscriptSettings(): TranscriptSettings {
  const stored = readStore().transcripts;
  return {
    enabled: stored?.enabled ?? false,
    dir: stored?.dir && stored.dir.trim() ? stored.dir : defaultTranscriptDir(),
  };
}

export function getPersona(): string {
  return readStore().persona ?? "";
}

export function setPersona(text: string): string {
  const trimmed = text.trim().slice(0, PERSONA_MAX_CHARS);
  const s = readStore();
  if (!trimmed) delete s.persona;
  else s.persona = trimmed;
  writeStore(s);
  return trimmed;
}

export function getSessionContext(): string {
  return readStore().sessionContext ?? "";
}

export function setSessionContext(text: string): string {
  const trimmed = text.trim().slice(0, SESSION_CONTEXT_MAX_CHARS);
  const s = readStore();
  if (!trimmed) delete s.sessionContext;
  else s.sessionContext = trimmed;
  writeStore(s);
  return trimmed;
}

export function setTranscriptSettings(next: Partial<TranscriptSettings>): TranscriptSettings {
  const s = readStore();
  const cur = getTranscriptSettings();
  const merged: TranscriptSettings = {
    enabled: next.enabled ?? cur.enabled,
    dir:
      next.dir !== undefined && next.dir.trim()
        ? next.dir.trim()
        : cur.dir,
  };
  s.transcripts = merged;
  writeStore(s);
  return merged;
}

export const TRANSCRIPT_N_DEFAULT = 50;
export const TRANSCRIPT_N_MIN = 10;
export const TRANSCRIPT_N_MAX = 200;

const INTERVIEW_FIELD_MAX_CHARS = 4000;

export function getMode(): CopilotMode {
  const m = readStore().mode;
  return m === "interview" ? "interview" : "meeting";
}

export function setMode(mode: CopilotMode): void {
  const s = readStore();
  s.mode = mode === "interview" ? "interview" : "meeting";
  writeStore(s);
}

export function getInterviewContext(): InterviewContext {
  const ic = readStore().interview ?? {};
  const out: InterviewContext = {};
  if (ic.role && ic.role.trim()) out.role = ic.role.trim();
  if (ic.company && ic.company.trim()) out.company = ic.company.trim();
  if (ic.jobDescription && ic.jobDescription.trim())
    out.jobDescription = ic.jobDescription.trim();
  return out;
}

export function setInterviewContext(next: InterviewContext): InterviewContext {
  const s = readStore();
  const trim = (v: string | undefined) =>
    (v ?? "").trim().slice(0, INTERVIEW_FIELD_MAX_CHARS);
  const cleaned: InterviewContext = {};
  const r = trim(next.role);
  const c = trim(next.company);
  const j = trim(next.jobDescription);
  if (r) cleaned.role = r;
  if (c) cleaned.company = c;
  if (j) cleaned.jobDescription = j;
  if (Object.keys(cleaned).length === 0) delete s.interview;
  else s.interview = cleaned;
  writeStore(s);
  return cleaned;
}

export function getTranscriptN(): number {
  const n = readStore().transcriptN;
  if (typeof n !== "number" || !Number.isFinite(n)) return TRANSCRIPT_N_DEFAULT;
  return Math.min(TRANSCRIPT_N_MAX, Math.max(TRANSCRIPT_N_MIN, Math.floor(n)));
}

export function setTranscriptN(n: number): number {
  const s = readStore();
  if (!Number.isFinite(n) || n <= 0) {
    delete s.transcriptN;
    writeStore(s);
    return TRANSCRIPT_N_DEFAULT;
  }
  const clamped = Math.min(
    TRANSCRIPT_N_MAX,
    Math.max(TRANSCRIPT_N_MIN, Math.floor(n)),
  );
  s.transcriptN = clamped;
  writeStore(s);
  return clamped;
}
