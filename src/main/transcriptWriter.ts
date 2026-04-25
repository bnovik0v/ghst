import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptLine } from "../core/types.js";
import {
  formatTranscriptBody,
  transcriptFilename,
  type SessionLine,
} from "../core/transcriptFormat.js";
import { getTranscriptSettings } from "./keyStore.js";
import { debug } from "../core/log.js";

let session: SessionLine[] = [];
let sessionStartedAt = 0;

export function resetSession(now: number = Date.now()): void {
  session = [];
  sessionStartedAt = now;
}

export function recordLine(line: TranscriptLine, now: number = Date.now()): void {
  if (!sessionStartedAt) sessionStartedAt = now;
  session.push({ ts: line.receivedAt, text: line.text });
}

export function sessionSnapshot(): { startedAt: number; lines: SessionLine[] } {
  return { startedAt: sessionStartedAt, lines: session.slice() };
}

/**
 * Write the current session's lines to a file if saving is enabled and there
 * is anything to save. Returns the file path written, or null. Always clears
 * the in-memory session afterward.
 */
export function flushSession(): string | null {
  const lines = session;
  const startedAt = sessionStartedAt || Date.now();
  session = [];
  sessionStartedAt = 0;

  if (lines.length === 0) return null;

  const settings = getTranscriptSettings();
  if (!settings.enabled) return null;

  try {
    mkdirSync(settings.dir, { recursive: true });
    const file = join(settings.dir, transcriptFilename(startedAt));
    writeFileSync(file, formatTranscriptBody(startedAt, lines), { encoding: "utf8" });
    debug(`[ghst main] wrote transcript to ${file}`);
    return file;
  } catch (err) {
    console.warn(`[ghst main] failed to write transcript: ${(err as Error).message}`);
    return null;
  }
}
