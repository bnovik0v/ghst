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
 * L1 (this file, this task): drop empty / backchannel / non-`them` entries.
 * L2 (next task): rule-based fire/drop signals + turn-type tagging.
 *
 * Returns `ambiguous` when neither layer can decide; the caller (worker)
 * either fires (in `rules` mode) or escalates to L3 (in `llm` mode).
 */
export function classifyTurn(
  latest: TranscriptEntry,
  _timeline: TranscriptEntry[],
): ClassifyTurnResult {
  if (latest.kind !== "them") {
    return { verdict: "drop", turnType: "banter" };
  }
  const text = latest.text.trim();
  if (!text || isBackchannel(text)) {
    return { verdict: "drop", turnType: "banter" };
  }
  return { verdict: "ambiguous", turnType: "statement" };
}
