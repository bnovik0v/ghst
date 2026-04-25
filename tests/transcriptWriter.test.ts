import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// keyStore reaches into Electron's `app`; mock it so the writer can be tested
// in plain Node without the full Electron runtime.
const settingsRef = { enabled: false, dir: "" };

vi.mock("../src/main/keyStore.js", () => ({
  getTranscriptSettings: () => ({ ...settingsRef }),
  defaultTranscriptDir: () => settingsRef.dir,
}));

import {
  flushSession,
  recordLine,
  resetSession,
  sessionSnapshot,
} from "../src/main/transcriptWriter.js";

const T = new Date(2026, 3, 25, 14, 7, 9).getTime();

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "ghst-test-"));
}

beforeEach(() => {
  resetSession(T);
});

describe("session buffer", () => {
  it("starts empty", () => {
    expect(sessionSnapshot().lines).toEqual([]);
  });

  it("records lines in order", () => {
    recordLine({ id: "a", text: "hello", receivedAt: T + 1_000, speaker: "them" });
    recordLine({ id: "b", text: "world", receivedAt: T + 2_000, speaker: "them" });
    const snap = sessionSnapshot();
    expect(snap.lines).toEqual([
      { ts: T + 1_000, text: "hello", speaker: "them" },
      { ts: T + 2_000, text: "world", speaker: "them" },
    ]);
    expect(snap.startedAt).toBe(T);
  });
});

describe("flushSession", () => {
  it("returns null and writes nothing when there are no lines", () => {
    const dir = makeTmpDir();
    settingsRef.enabled = true;
    settingsRef.dir = dir;
    expect(flushSession()).toBeNull();
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("returns null and writes nothing when saving is disabled", () => {
    const dir = makeTmpDir();
    settingsRef.enabled = false;
    settingsRef.dir = dir;
    recordLine({ id: "a", text: "hello", receivedAt: T, speaker: "them" });
    expect(flushSession()).toBeNull();
    expect(readdirSync(dir)).toHaveLength(0);
    // Session should still be cleared after flush, even if disabled.
    expect(sessionSnapshot().lines).toEqual([]);
  });

  it("writes a timestamped .txt when enabled and clears the session", () => {
    const dir = makeTmpDir();
    settingsRef.enabled = true;
    settingsRef.dir = dir;
    recordLine({ id: "a", text: "first", receivedAt: T, speaker: "them" });
    recordLine({ id: "b", text: "second", receivedAt: T + 5_000, speaker: "them" });

    const file = flushSession();
    expect(file).not.toBeNull();
    expect(file).toBe(join(dir, "ghst-2026-04-25_14-07-09.txt"));
    expect(existsSync(file!)).toBe(true);

    const body = readFileSync(file!, "utf8");
    expect(body).toContain("ghst transcript — 2026-04-25 14:07:09");
    expect(body).toContain("[14:07:09] Them: first");
    expect(body).toContain("[14:07:14] Them: second");

    expect(sessionSnapshot().lines).toEqual([]);
  });

  it("creates the destination directory if missing", () => {
    const dir = join(makeTmpDir(), "nested", "deeper");
    settingsRef.enabled = true;
    settingsRef.dir = dir;
    recordLine({ id: "a", text: "hi", receivedAt: T, speaker: "them" });
    const file = flushSession();
    expect(file).not.toBeNull();
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(file!)).toBe(true);
  });

  it("preserves speaker labels in the written file", () => {
    const dir = makeTmpDir();
    settingsRef.enabled = true;
    settingsRef.dir = dir;
    resetSession(Date.now());
    recordLine({
      id: "1", text: "hello", receivedAt: Date.now(), speaker: "them",
    });
    recordLine({
      id: "2", text: "hi", receivedAt: Date.now(), speaker: "self",
    });
    const file = flushSession();
    expect(file).not.toBeNull();
    const body = readFileSync(file as string, "utf8");
    expect(body).toMatch(/Them: hello/);
    expect(body).toMatch(/You: hi/);
  });
});
