import { app, safeStorage } from "electron";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type TranscriptSettings = {
  enabled: boolean;
  dir: string;
};

type Stored = {
  groqKeyEnc?: string;
  transcripts?: TranscriptSettings;
};

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
