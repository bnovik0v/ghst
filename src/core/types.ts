export type Speaker = "self" | "them";

export type TranscriptLine = {
  id: string;
  text: string;
  receivedAt: number;
  speaker: Speaker;
};

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
