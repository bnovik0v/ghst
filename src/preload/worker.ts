import { contextBridge, ipcRenderer } from "electron";
import type { IPCFromWorker, IPCToWorker } from "../core/types.js";

contextBridge.exposeInMainWorld("workerBridge", {
  onCommand: (cb: (msg: IPCToWorker) => void) => {
    ipcRenderer.on("cmd:to-worker", (_e, msg) => cb(msg));
  },
  emit: (msg: IPCFromWorker) => ipcRenderer.send("evt:from-worker", msg),
  getGroqKey: (): Promise<string> => ipcRenderer.invoke("cfg:groq-key"),
  getPersona: (): Promise<string> => ipcRenderer.invoke("cfg:get-persona"),
  getSessionContext: (): Promise<string> => ipcRenderer.invoke("cfg:get-session-context"),
  getMode: (): Promise<"meeting" | "interview"> =>
    ipcRenderer.invoke("cfg:get-mode"),
  getTriggerMode: (): Promise<"off" | "rules" | "llm" | null> =>
    ipcRenderer.invoke("cfg:get-trigger-mode"),
  getInterview: (): Promise<{
    role?: string;
    company?: string;
    jobDescription?: string;
  }> => ipcRenderer.invoke("cfg:get-interview"),
  getTranscriptN: (): Promise<number> =>
    ipcRenderer.invoke("cfg:get-transcript-n"),
  startCapture: (): Promise<void> => ipcRenderer.invoke("capture:start"),
  stopCapture: (): Promise<void> => ipcRenderer.invoke("capture:stop"),
  onPcm: (cb: (chunk: Uint8Array) => void) => {
    ipcRenderer.on("evt:pcm", (_e, chunk: Buffer) => cb(new Uint8Array(chunk)));
  },
});
