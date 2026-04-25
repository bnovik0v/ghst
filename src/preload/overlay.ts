import { contextBridge, ipcRenderer } from "electron";
import type { IPCFromWorker, IPCToWorker } from "../core/types.js";
import type { OverlayCommand } from "./types.js";

contextBridge.exposeInMainWorld("overlayBridge", {
  send: (msg: IPCToWorker) => ipcRenderer.send("cmd:to-worker", msg),
  onEvent: (cb: (msg: IPCFromWorker) => void) => {
    ipcRenderer.on("evt:from-worker", (_e, msg) => cb(msg));
  },
  onCommand: (cb: (cmd: OverlayCommand) => void) => {
    ipcRenderer.on("overlay:cmd", (_e, cmd) => cb(cmd));
  },
  command: (cmd: OverlayCommand) => ipcRenderer.send("overlay:cmd-self", cmd),
  hasGroqKey: (): Promise<boolean> => ipcRenderer.invoke("cfg:has-groq-key"),
  setGroqKey: (key: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("cfg:set-groq-key", key),
  clearGroqKey: (): Promise<void> => ipcRenderer.invoke("cfg:clear-groq-key"),
});
