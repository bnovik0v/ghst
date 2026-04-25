import type { IPCFromWorker, IPCToWorker } from "../core/types.js";

export type OverlayCommand =
  | { kind: "clear" }
  | { kind: "toggle-listen" }
  | { kind: "hide" }
  | { kind: "open-settings" };

declare global {
  interface Window {
    workerBridge: {
      onCommand: (cb: (msg: IPCToWorker) => void) => void;
      emit: (msg: IPCFromWorker) => void;
      getGroqKey: () => Promise<string>;
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
    };
  }
}

export {};
