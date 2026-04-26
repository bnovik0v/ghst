import type { TranscriptEntry } from "./types.js";
import { isBackchannel } from "./transcript.js";

export type TurnType =
  | "question_behavioural"
  | "question_technical"
  | "question_system_design"
  | "question_clarification"
  | "statement"
  | "banter";

export type TurnVerdict = "fire" | "drop" | "ambiguous";

export type ClassifyTurnResult = {
  verdict: TurnVerdict;
  turnType: TurnType;
};

/**
 * Deterministic L1 + L2 classifier.
 *
 * L1: drop empty / backchannel / non-`them` entries.
 * L2: rule-based fire/drop signals + turn-type tagging.
 *
 * Returns `ambiguous` when neither layer can decide; the caller (worker)
 * either fires (in `rules` mode) or escalates to L3 (in `llm` mode).
 */

// L2 fire signals
const QUESTION_TRAILING = /\?\s*$/;

const INTERROGATIVE_STARTERS =
  /^(what|how|why|when|where|who|which|whose|whom|can\s+you|could\s+you|would\s+you|will\s+you|do\s+you|did\s+you|are\s+you|were\s+you|have\s+you|tell\s+me|walk\s+me\s+through|describe|explain|design|give\s+me|show\s+me|talk\s+me\s+through)\b/i;

// "And/so/but/because/like" at the very end signals trailing thought.
const TRAIL_OFF_END =
  /\b(and|so|but|because|cause|cuz|like|or|then|with|um|uh|you\s+know|i\s+mean)[\s.,!?…]*$/i;

const TERMINATOR = /[.!?…]\s*$/;

// Behavioural cues — situation-task-action stories.
const BEHAVIOURAL =
  /^(tell\s+me\s+about\s+a\s+time|describe\s+a\s+(situation|time)|walk\s+me\s+through\s+a\s+(time|situation|moment)|give\s+me\s+an\s+example)\b/i;

// System-design cues — open-ended scaling / architecture asks.
const SYSTEM_DESIGN =
  /\b(design\s+(a|an|the)|how\s+would\s+you\s+(scale|build|architect|design)|architect\s+(a|an)|build\s+a\s+system|scale\s+(this|it)\s+to)\b/i;

// Clarification cues — short re-asks.
const CLARIFICATION =
  /^(sorry|wait|hold\s+on|what\s+do\s+you\s+mean|could\s+you\s+repeat|what\s+did\s+you\s+mean|come\s+again)\b/i;

// Technical cues — explain/how-does-X-work asks.
const TECHNICAL =
  /^(explain|how\s+does|how\s+do|what\s+is|what\s+are|why\s+is|why\s+does)\b/i;

function classifyType(text: string): TurnType {
  if (CLARIFICATION.test(text)) return "question_clarification";
  if (BEHAVIOURAL.test(text)) return "question_behavioural";
  if (SYSTEM_DESIGN.test(text)) return "question_system_design";
  if (TECHNICAL.test(text)) return "question_technical";
  if (QUESTION_TRAILING.test(text) || INTERROGATIVE_STARTERS.test(text))
    return "question_technical";
  return "statement";
}

function wordCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

export function classifyTurn(
  latest: TranscriptEntry,
  _timeline: TranscriptEntry[],
): ClassifyTurnResult {
  // L1: guard against non-them, empty, or backchannel.
  if (latest.kind !== "them") {
    return { verdict: "drop", turnType: "banter" };
  }
  const text = latest.text.trim();
  if (!text || isBackchannel(text)) {
    return { verdict: "drop", turnType: "banter" };
  }

  const turnType = classifyType(text);

  // L2 fire — trailing ?, interrogative starter, or long terminated statement.
  if (
    QUESTION_TRAILING.test(text) ||
    INTERROGATIVE_STARTERS.test(text) ||
    BEHAVIOURAL.test(text) ||
    SYSTEM_DESIGN.test(text)
  ) {
    return { verdict: "fire", turnType };
  }
  if (wordCount(text) >= 25 && TERMINATOR.test(text) && !TRAIL_OFF_END.test(text)) {
    return { verdict: "fire", turnType };
  }

  // L2 drop — fragmentary or mid-clause.
  if (TRAIL_OFF_END.test(text)) {
    return { verdict: "drop", turnType };
  }
  if (wordCount(text) < 6 && !QUESTION_TRAILING.test(text)) {
    return { verdict: "drop", turnType };
  }

  return { verdict: "ambiguous", turnType };
}
