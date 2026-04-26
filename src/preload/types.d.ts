import type { IPCFromWorker, IPCToWorker } from "../core/types.js";

export type OverlayCommand =
  | { kind: "clear" }
  | { kind: "toggle-listen" }
  | { kind: "hide" }
  | { kind: "open-settings" }
  | { kind: "open-external"; url: string }
  | { kind: "set-shape"; rects: { x: number; y: number; width: number; height: number }[] };

declare global {
  interface Window {
    workerBridge: {
      onCommand: (cb: (msg: IPCToWorker) => void) => void;
      emit: (msg: IPCFromWorker) => void;
      getGroqKey: () => Promise<string>;
      getPersona: () => Promise<string>;
      getSessionContext: () => Promise<string>;
      getMode: () => Promise<"meeting" | "interview">;
      getTriggerMode: () => Promise<"off" | "rules" | "llm" | null>;
      getInterview: () => Promise<{
        role?: string;
        company?: string;
        jobDescription?: string;
      }>;
      getTranscriptN: () => Promise<number>;
      startCapture: () => Promise<void>;
      stopCapture: () => Promise<void>;
      onPcm: (cb: (chunk: Uint8Array) => void) => void;
    };
    overlayBridge: {
      send: (msg: IPCToWorker) => void;
      onEvent: (cb: (msg: IPCFromWorker) => void) => void;
      onCommand?: (cb: (cmd: OverlayCommand) => void) => void;
      command?: (cmd: OverlayCommand) => void;
      hasGroqKey: () => Promise<boolean>;
      setGroqKey: (key: string) => Promise<{ ok: true } | { ok: false; error: string }>;
      clearGroqKey: () => Promise<void>;
      getTranscriptSettings: () => Promise<{ enabled: boolean; dir: string }>;
      setTranscriptSettings: (
        next: Partial<{ enabled: boolean; dir: string }>,
      ) => Promise<
        | { ok: true; value: { enabled: boolean; dir: string } }
        | { ok: false; error: string }
      >;
      defaultTranscriptDir: () => Promise<string>;
      pickTranscriptDir: () => Promise<
        { ok: true; dir: string } | { ok: false; canceled?: boolean; error?: string }
      >;
      revealTranscriptDir: () => Promise<{ ok: true } | { ok: false; error: string }>;
      getPersona: () => Promise<string>;
      setPersona: (
        text: string,
      ) => Promise<{ ok: true; value: string } | { ok: false; error: string }>;
      getSessionContext: () => Promise<string>;
      setSessionContext: (
        text: string,
      ) => Promise<{ ok: true; value: string } | { ok: false; error: string }>;
      getMode: () => Promise<"meeting" | "interview">;
      setMode: (
        mode: "meeting" | "interview",
      ) => Promise<"meeting" | "interview">;
      getTriggerMode: () => Promise<"off" | "rules" | "llm" | null>;
      setTriggerMode: (m: "off" | "rules" | "llm" | null) => Promise<void>;
      getInterview: () => Promise<{
        role?: string;
        company?: string;
        jobDescription?: string;
      }>;
      setInterview: (next: {
        role?: string;
        company?: string;
        jobDescription?: string;
      }) => Promise<{ role?: string; company?: string; jobDescription?: string }>;
      getTranscriptN: () => Promise<number>;
      setTranscriptN: (n: number) => Promise<number>;
    };
  }
}

export {};
