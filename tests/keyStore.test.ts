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
