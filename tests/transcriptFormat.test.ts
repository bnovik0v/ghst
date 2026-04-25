import { describe, it, expect } from "vitest";
import {
  formatClock,
  formatFilenameStamp,
  formatHeader,
  formatTranscriptBody,
  transcriptFilename,
} from "../src/core/transcriptFormat.js";

// Use a fixed local-time anchor so the tests don't drift across machines.
// new Date(year, monthIndex, day, h, m, s) is interpreted in the local zone,
// matching the local-time formatting our code produces.
const T = new Date(2026, 3, 25, 14, 7, 9).getTime(); // 2026-04-25 14:07:09 local

describe("formatClock", () => {
  it("zero-pads HH:MM:SS", () => {
    const t = new Date(2026, 0, 1, 3, 4, 5).getTime();
    expect(formatClock(t)).toBe("03:04:05");
  });
});

describe("formatFilenameStamp / transcriptFilename", () => {
  it("produces a path-safe stamp", () => {
    expect(formatFilenameStamp(T)).toBe("2026-04-25_14-07-09");
  });
  it("wraps with prefix and extension", () => {
    expect(transcriptFilename(T)).toBe("ghst-2026-04-25_14-07-09.txt");
  });
});

describe("formatHeader", () => {
  it("includes ISO-ish date and clock", () => {
    expect(formatHeader(T)).toBe("ghst transcript — 2026-04-25 14:07:09");
  });
});

describe("formatTranscriptBody", () => {
  it("emits header, blank line, then [HH:MM:SS] lines, trailing newline", () => {
    const body = formatTranscriptBody(T, [
      { ts: T, text: "first line" },
      { ts: T + 5_000, text: "second line" },
    ]);
    expect(body).toBe(
      "ghst transcript — 2026-04-25 14:07:09\n" +
        "\n" +
        "[14:07:09] first line\n" +
        "[14:07:14] second line\n",
    );
  });

  it("handles empty line list (header only, with trailing newline)", () => {
    const body = formatTranscriptBody(T, []);
    expect(body).toBe("ghst transcript — 2026-04-25 14:07:09\n\n\n");
  });
});
