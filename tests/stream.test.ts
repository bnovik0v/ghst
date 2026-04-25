import { describe, it, expect } from "vitest";
import {
  LocalAgreement,
  commonPrefix,
  commonPrefixWords,
  tokenize,
  type Word,
} from "../src/core/stream.js";

const w = (text: string, start: number, end: number): Word => ({ text, start, end });

describe("tokenize", () => {
  it("splits on whitespace and drops empties", () => {
    expect(tokenize("  hello  world  ")).toEqual(["hello", "world"]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("commonPrefix", () => {
  it("returns empty when no agreement", () => {
    expect(commonPrefix(["foo"], ["bar"])).toEqual([]);
  });

  it("returns the shared initial run", () => {
    expect(commonPrefix(["a", "b", "c"], ["a", "b", "x"])).toEqual(["a", "b"]);
  });

  it("is case-insensitive and ignores punctuation", () => {
    expect(commonPrefix(["Hello,", "World"], ["hello", "world!"])).toEqual([
      "hello",
      "world!",
    ]);
  });

  it("handles one side being a prefix of the other", () => {
    expect(commonPrefix(["a"], ["a", "b"])).toEqual(["a"]);
    expect(commonPrefix(["a", "b"], ["a"])).toEqual(["a"]);
  });
});

describe("LocalAgreement", () => {
  it("commits nothing on the first hypothesis", () => {
    const la = new LocalAgreement();
    const r = la.update("hello there friend");
    expect(r.committed).toBe("");
    expect(r.tentative).toBe("hello there friend");
  });

  it("commits the shared prefix across two hypotheses", () => {
    const la = new LocalAgreement();
    la.update("the quick brown");
    const r = la.update("the quick red fox");
    expect(r.committed).toBe("the quick");
    expect(r.tentative).toBe("red fox");
  });

  it("extends the committed prefix as hypotheses grow", () => {
    const la = new LocalAgreement();
    la.update("the quick brown");
    la.update("the quick brown fox");
    const r = la.update("the quick brown fox jumps");
    expect(r.committed).toBe("the quick brown fox");
    expect(r.tentative).toBe("jumps");
  });

  it("never shrinks committed even when a later hypothesis diverges past it", () => {
    const la = new LocalAgreement();
    la.update("one two three");
    la.update("one two three four"); // commits "one two three"
    const r = la.update("one two DIFFERENT tail");
    // Committed must still be at least 3 words ("one two three") — we never
    // walk back. The agreed prefix here is only 2 words, so committed holds.
    expect(r.committed).toBe("one two three");
  });

  it("finalize takes the whole hypothesis as committed", () => {
    const la = new LocalAgreement();
    la.update("partial");
    const final = la.finalize("the full sentence.");
    expect(final).toBe("the full sentence.");
  });

  it("reset clears state", () => {
    const la = new LocalAgreement();
    la.update("hello world");
    la.reset();
    const r = la.update("something else");
    expect(r.committed).toBe("");
    expect(r.tentative).toBe("something else");
  });
});

describe("commonPrefixWords", () => {
  it("matches initial run by normalized text", () => {
    const a = [w("Hello,", 0, 0.3), w("world", 0.3, 0.7), w("foo", 0.7, 1)];
    const b = [w("hello", 0, 0.3), w("World!", 0.3, 0.7), w("bar", 0.7, 1)];
    expect(commonPrefixWords(a, b)).toEqual([
      w("hello", 0, 0.3),
      w("World!", 0.3, 0.7),
    ]);
  });
});

describe("LocalAgreement.updateWords + drainWords", () => {
  it("commits nothing on the first hypothesis", () => {
    const la = new LocalAgreement();
    const r = la.updateWords([w("hi", 0, 0.3), w("there", 0.3, 0.7)]);
    expect(r.committed).toBe("");
    expect(r.tentative).toBe("hi there");
  });

  it("commits the shared prefix and reports drain end time", () => {
    const la = new LocalAgreement();
    la.updateWords([w("the", 0, 0.2), w("quick", 0.2, 0.5), w("brown", 0.5, 0.9)]);
    la.updateWords([w("the", 0, 0.2), w("quick", 0.2, 0.5), w("red", 0.5, 0.9)]);
    expect(la.committedWordCount).toBe(2);
    const drained = la.drainWords();
    expect(drained.words.map((x) => x.text)).toEqual(["the", "quick"]);
    expect(drained.endSec).toBe(0.5);
    // After draining, state is fresh.
    expect(la.committedWordCount).toBe(0);
    const next = la.updateWords([w("anything", 0, 0.4)]);
    expect(next.committed).toBe("");
  });

  it("drain returns endSec=0 when nothing committed", () => {
    const la = new LocalAgreement();
    la.updateWords([w("only", 0, 0.3)]);
    expect(la.drainWords()).toEqual({ words: [], endSec: 0 });
  });
});
