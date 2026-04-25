export type Speaker = "self" | "them";

export type CopilotMode = "meeting" | "interview";

export type InterviewContext = {
  role?: string;
  company?: string;
  jobDescription?: string;
};

export type TranscriptLine = {
  id: string;
  text: string;
  receivedAt: number;
  speaker: Speaker;
  /** Copilot reply that was generated in response to this line, if any.
   *  Only meaningful when `speaker === "them"`. */
  suggestion?: string;
};

/** Flattened view of the transcript window for prompt building. Each entry is
 *  one renderable line. `suggested` entries appear immediately after the
 *  `them` entry that produced them. */
export type TranscriptEntry =
  | { kind: "them"; text: string }
  | { kind: "you"; text: string }
  | { kind: "suggested"; text: string };

export type WorkerStatus = "idle" | "listening" | "error";

export type IPCFromWorker =
  | { kind: "transcript"; line: TranscriptLine }
  | { kind: "status"; status: WorkerStatus; error?: string }
  | { kind: "live"; committed: string; tentative: string }
  | { kind: "card:start"; id: string; ts: number }
  | { kind: "card:delta"; id: string; delta: string }
  | { kind: "card:done"; id: string }
  | { kind: "card:error"; id: string; msg: string };

export type IPCToWorker =
  | { kind: "start" }
  | { kind: "stop" }
  | { kind: "card:dismiss"; id: string }
  | { kind: "copilot:trigger" }
  | { kind: "clear-context" };
