import { describe, it, expect } from "vitest";
import {
  TranscriptManager,
  isLikelyHallucination,
  isBackchannel,
} from "../src/core/transcript.js";

describe("isLikelyHallucination", () => {
  it("flags common Whisper silence hallucinations", () => {
    expect(isLikelyHallucination("Thanks for watching!")).toBe(true);
    expect(isLikelyHallucination("Subtitles by the Amara.org community")).toBe(true);
    expect(isLikelyHallucination("Please subscribe to the channel")).toBe(true);
    expect(isLikelyHallucination("[Music]")).toBe(true);
    expect(isLikelyHallucination("(applause)")).toBe(true);
    expect(isLikelyHallucination(".")).toBe(true);
    expect(isLikelyHallucination("")).toBe(true);
  });

  it("lets real speech through", () => {
    expect(isLikelyHallucination("Let me share my screen for a moment.")).toBe(false);
    expect(isLikelyHallucination("The deploy is scheduled for tomorrow")).toBe(false);
  });
});

describe("isBackchannel", () => {
  it("flags common single-word acknowledgements", () => {
    expect(isBackchannel("Yeah.")).toBe(true);
    expect(isBackchannel("ok")).toBe(true);
    expect(isBackchannel("Right!")).toBe(true);
    expect(isBackchannel("Cool.")).toBe(true);
    expect(isBackchannel("Mhm")).toBe(true);
    expect(isBackchannel("Got it.")).toBe(true);
    expect(isBackchannel("Yeah yeah yeah.")).toBe(true);
    expect(isBackchannel("Oh nice")).toBe(true);
  });

  it("keeps short questions", () => {
    expect(isBackchannel("What?")).toBe(false);
    expect(isBackchannel("Really?")).toBe(false);
    expect(isBackchannel("Are you sure?")).toBe(false);
  });

  it("keeps substantive short lines", () => {
    expect(isBackchannel("Tell me more.")).toBe(false);
    expect(isBackchannel("I disagree.")).toBe(false);
    expect(isBackchannel("The API changed.")).toBe(false);
  });

  it("lets longer lines starting with backchannel words through", () => {
    expect(isBackchannel("Yeah I think the architecture is solid.")).toBe(false);
    expect(isBackchannel("Right, so the next step is to validate.")).toBe(false);
  });

  it("treats empty / whitespace as backchannel", () => {
    expect(isBackchannel("")).toBe(true);
    expect(isBackchannel("   ")).toBe(true);
  });
});

describe("TranscriptManager", () => {
  it("drops hallucinations", () => {
    const m = new TranscriptManager();
    expect(m.add("Thanks for watching!", "them")).toBeNull();
    expect(m.add("Real speech here", "them")).not.toBeNull();
    expect(m.recent(10)).toHaveLength(1);
  });

  it("caps buffer at maxLines", () => {
    const m = new TranscriptManager(3);
    for (let i = 0; i < 10; i++) m.add(`line ${i}`, "them");
    const lines = m.recent(10);
    expect(lines).toHaveLength(3);
    expect(lines[0].text).toBe("line 7");
    expect(lines[2].text).toBe("line 9");
  });

  it("promptContext returns most recent lines within char budget", () => {
    const m = new TranscriptManager();
    m.add("first line added", "them");
    m.add("second line added", "them");
    m.add("third line added", "them");
    const ctx = m.promptContext(40);
    expect(ctx.endsWith("third line added")).toBe(true);
    expect(ctx.length).toBeLessThanOrEqual(40);
  });

  it("promptContext is empty when no lines", () => {
    const m = new TranscriptManager();
    expect(m.promptContext()).toBe("");
  });

  it("clear empties the buffer", () => {
    const m = new TranscriptManager();
    m.add("something", "them");
    m.clear();
    expect(m.recent(5)).toHaveLength(0);
  });
});

describe("TranscriptManager speaker tagging", () => {
  it("records the speaker on added lines", () => {
    const tm = new TranscriptManager();
    const a = tm.add("hello there", "them");
    const b = tm.add("hi back", "self");
    expect(a?.speaker).toBe("them");
    expect(b?.speaker).toBe("self");
  });

  it("preserves speaker through recent()", () => {
    const tm = new TranscriptManager();
    tm.add("hello", "them");
    tm.add("goodbye", "self");
    const recent = tm.recent(2);
    expect(recent.map((l) => l.speaker)).toEqual(["them", "self"]);
  });
});
