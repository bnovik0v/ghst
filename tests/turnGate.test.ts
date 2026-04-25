import { describe, it, expect } from "vitest";
import { classifyTurn } from "../src/core/turnGate.js";
import type { TranscriptEntry } from "../src/core/types.js";

const them = (text: string): TranscriptEntry => ({ kind: "them", text });
const you = (text: string): TranscriptEntry => ({ kind: "you", text });

describe("classifyTurn — L1 backchannel filter", () => {
  it("drops short backchannel turns", () => {
    const r = classifyTurn(them("Yeah."), [them("Yeah.")]);
    expect(r.verdict).toBe("drop");
  });

  it("drops empty / whitespace-only turns", () => {
    expect(classifyTurn(them(""), [them("")]).verdict).toBe("drop");
    expect(classifyTurn(them("   "), [them("   ")]).verdict).toBe("drop");
  });

  it("does not drop a short question", () => {
    const r = classifyTurn(them("What?"), [them("What?")]);
    expect(r.verdict).not.toBe("drop");
  });

  it("returns ambiguous for an arbitrary medium statement", () => {
    const r = classifyTurn(
      them("the team was about fifteen engineers at peak"),
      [them("the team was about fifteen engineers at peak")],
    );
    expect(r.verdict).toBe("ambiguous");
  });

  it("only classifies a 'them' entry — 'you' entries return drop", () => {
    const r = classifyTurn(you("anything"), [you("anything")]);
    expect(r.verdict).toBe("drop");
  });
});
