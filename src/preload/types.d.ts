import type { IPCFromWorker, IPCToWorker } from "../core/types.js";

export type OverlayCommand =
  | { kind: "clear" }
  | { kind: "toggle-listen" }
  | { kind: "hide" };

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
    };
  }
}

export {};
