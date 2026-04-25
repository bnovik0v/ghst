import { describe, it, expect, beforeEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Stub Electron before importing keyStore. keyStore reads userData via
// app.getPath at call time, so each test points it at an isolated tmp dir.
let userDataDir = "";
vi.mock("electron", () => ({
  app: { getPath: (_: string) => userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, "utf8"),
    decryptString: (b: Buffer) => b.toString("utf8"),
  },
}));

// Import AFTER the mock so the module picks up the stubbed `app`.
import {
  getSessionContext,
  setSessionContext,
  getPersona,
  setPersona,
  SESSION_CONTEXT_MAX_CHARS,
  getMode,
  setMode,
  getInterviewContext,
  setInterviewContext,
  getTranscriptN,
  setTranscriptN,
  TRANSCRIPT_N_MIN,
  TRANSCRIPT_N_MAX,
  TRANSCRIPT_N_DEFAULT,
} from "../src/main/keyStore.js";

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), "ghst-keystore-test-"));
  return () => {
    rmSync(userDataDir, { recursive: true, force: true });
  };
});

describe("session context persistence", () => {
  it("returns empty string when unset", () => {
    expect(getSessionContext()).toBe("");
  });

  it("roundtrips a value through disk", () => {
    setSessionContext("Stripe SRE interview");
    expect(getSessionContext()).toBe("Stripe SRE interview");
    const onDisk = JSON.parse(
      readFileSync(join(userDataDir, "config.json"), "utf8"),
    );
    expect(onDisk.sessionContext).toBe("Stripe SRE interview");
  });

  it("trims surrounding whitespace", () => {
    setSessionContext("   demo for Acme   \n");
    expect(getSessionContext()).toBe("demo for Acme");
  });

  it("truncates beyond SESSION_CONTEXT_MAX_CHARS", () => {
    const long = "x".repeat(SESSION_CONTEXT_MAX_CHARS + 500);
    setSessionContext(long);
    expect(getSessionContext().length).toBe(SESSION_CONTEXT_MAX_CHARS);
  });

  it("removes the key from config.json when set to empty", () => {
    setSessionContext("hello");
    setSessionContext("");
    const onDisk = JSON.parse(
      readFileSync(join(userDataDir, "config.json"), "utf8"),
    );
    expect(onDisk.sessionContext).toBeUndefined();
  });

  it("does not disturb persona when written", () => {
    setPersona("I'm Borislav.");
    setSessionContext("Stripe interview");
    expect(getPersona()).toBe("I'm Borislav.");
    expect(getSessionContext()).toBe("Stripe interview");
  });
});

describe("mode persistence", () => {
  it("defaults to 'meeting' when unset", () => {
    expect(getMode()).toBe("meeting");
  });

  it("round-trips set/get", () => {
    setMode("interview");
    expect(getMode()).toBe("interview");
    setMode("meeting");
    expect(getMode()).toBe("meeting");
  });

  it("ignores invalid mode strings and stores 'meeting'", () => {
    // The TS type forbids this, but defend at runtime — IPC payloads are untyped.
    // @ts-expect-error testing invalid payload
    setMode("nonsense");
    expect(getMode()).toBe("meeting");
  });
});

describe("interview context persistence", () => {
  it("defaults to all-empty", () => {
    expect(getInterviewContext()).toEqual({});
  });

  it("trims and stores fields, drops empties", () => {
    setInterviewContext({
      role: "  Senior backend  ",
      company: "Stripe",
      jobDescription: "  ",
    });
    expect(getInterviewContext()).toEqual({
      role: "Senior backend",
      company: "Stripe",
    });
  });

  it("removes the entire interview key when all fields are empty", () => {
    setInterviewContext({ role: "x" });
    setInterviewContext({ role: "", company: "", jobDescription: "" });
    const onDisk = JSON.parse(
      readFileSync(join(userDataDir, "config.json"), "utf8"),
    );
    expect(onDisk.interview).toBeUndefined();
  });

  it("returns trimmed value from getInterviewContext after roundtrip", () => {
    setInterviewContext({ role: "Backend", company: "Acme", jobDescription: "Build APIs." });
    const got = getInterviewContext();
    expect(got.role).toBe("Backend");
    expect(got.company).toBe("Acme");
    expect(got.jobDescription).toBe("Build APIs.");
  });
});

describe("transcriptN persistence", () => {
  it("defaults to TRANSCRIPT_N_DEFAULT when unset", () => {
    expect(getTranscriptN()).toBe(TRANSCRIPT_N_DEFAULT);
  });

  it("clamps below TRANSCRIPT_N_MIN", () => {
    setTranscriptN(5);
    expect(getTranscriptN()).toBe(TRANSCRIPT_N_MIN);
  });

  it("clamps above TRANSCRIPT_N_MAX", () => {
    setTranscriptN(9999);
    expect(getTranscriptN()).toBe(TRANSCRIPT_N_MAX);
  });

  it("stores valid in-range values", () => {
    setTranscriptN(75);
    expect(getTranscriptN()).toBe(75);
  });

  it("invalid input (NaN, 0, negative) resets to default and clears storage", () => {
    setTranscriptN(75);
    setTranscriptN(0);
    expect(getTranscriptN()).toBe(TRANSCRIPT_N_DEFAULT);
    const onDisk = JSON.parse(
      readFileSync(join(userDataDir, "config.json"), "utf8"),
    );
    expect(onDisk.transcriptN).toBeUndefined();
  });
});
