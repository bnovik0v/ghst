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

describe("classifyTurn — L2 fire rules", () => {
  it("fires on trailing question mark", () => {
    const r = classifyTurn(
      them("how would you scale this?"),
      [them("how would you scale this?")],
    );
    expect(r.verdict).toBe("fire");
  });

  it("fires on interrogative starters", () => {
    for (const q of [
      "what do you think about microservices",
      "how would you handle that situation",
      "tell me about a tough deadline you hit",
      "walk me through your last incident",
      "describe your testing philosophy",
      "explain how Raft works at a high level",
      "design a rate limiter for our API",
    ]) {
      const r = classifyTurn(them(q), [them(q)]);
      expect(r.verdict, `expected fire for: ${q}`).toBe("fire");
    }
  });

  it("fires on long complete statements with terminator", () => {
    const long =
      "We have been talking with several candidates this week and " +
      "the bar has been pretty high so this should be a real " +
      "exercise in technical depth.";
    const r = classifyTurn(them(long), [them(long)]);
    expect(r.verdict).toBe("fire");
  });
});

describe("classifyTurn — L2 drop rules", () => {
  it("drops short fragmentary statements with no marker", () => {
    const r = classifyTurn(
      them("the team was small"),
      [them("the team was small")],
    );
    expect(r.verdict).toBe("drop");
  });

  it("drops mid-clause trail-offs ending on a conjunction", () => {
    for (const q of [
      "we built it on Postgres and",
      "the migration was pretty smooth so",
      "I had to step in because",
      "we considered Kafka but",
      "it was kind of like",
    ]) {
      const r = classifyTurn(them(q), [them(q)]);
      expect(r.verdict, `expected drop for: ${q}`).toBe("drop");
    }
  });
});

describe("classifyTurn — turnType mapping", () => {
  it("maps 'tell me about a time' to behavioural", () => {
    const r = classifyTurn(
      them("Tell me about a time you handled a tough deadline."),
      [them("Tell me about a time you handled a tough deadline.")],
    );
    expect(r.turnType).toBe("question_behavioural");
  });

  it("maps 'design a' / 'how would you scale' to system_design", () => {
    expect(
      classifyTurn(them("Design a URL shortener."), [them("Design a URL shortener.")])
        .turnType,
    ).toBe("question_system_design");
    expect(
      classifyTurn(
        them("How would you scale this to a million QPS?"),
        [them("How would you scale this to a million QPS?")],
      ).turnType,
    ).toBe("question_system_design");
  });

  it("maps 'explain' / 'how does X work' to technical", () => {
    expect(
      classifyTurn(them("Explain how Raft works."), [them("Explain how Raft works.")])
        .turnType,
    ).toBe("question_technical");
  });

  it("maps short clarifications to clarification", () => {
    expect(
      classifyTurn(them("Sorry, what did you mean by sharded?"), [
        them("Sorry, what did you mean by sharded?"),
      ]).turnType,
    ).toBe("question_clarification");
  });

  it("backchannels keep banter type alongside drop verdict", () => {
    const r = classifyTurn(them("yeah"), [them("yeah")]);
    expect(r.verdict).toBe("drop");
    expect(r.turnType).toBe("banter");
  });
});
