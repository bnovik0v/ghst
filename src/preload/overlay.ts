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
  getTranscriptSettings: (): Promise<{ enabled: boolean; dir: string }> =>
    ipcRenderer.invoke("cfg:get-transcripts"),
  setTranscriptSettings: (
    next: Partial<{ enabled: boolean; dir: string }>,
  ): Promise<
    | { ok: true; value: { enabled: boolean; dir: string } }
    | { ok: false; error: string }
  > => ipcRenderer.invoke("cfg:set-transcripts", next),
  defaultTranscriptDir: (): Promise<string> =>
    ipcRenderer.invoke("cfg:default-transcript-dir"),
  pickTranscriptDir: (): Promise<
    { ok: true; dir: string } | { ok: false; canceled?: boolean; error?: string }
  > => ipcRenderer.invoke("cfg:pick-transcript-dir"),
  revealTranscriptDir: (): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("cfg:reveal-transcript-dir"),
  getPersona: (): Promise<string> => ipcRenderer.invoke("cfg:get-persona"),
  setPersona: (
    text: string,
  ): Promise<{ ok: true; value: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke("cfg:set-persona", text),
  getSessionContext: (): Promise<string> =>
    ipcRenderer.invoke("cfg:get-session-context"),
  setSessionContext: (
    text: string,
  ): Promise<{ ok: true; value: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke("cfg:set-session-context", text),
  getMode: (): Promise<"meeting" | "interview"> =>
    ipcRenderer.invoke("cfg:get-mode"),
  setMode: (
    mode: "meeting" | "interview",
  ): Promise<"meeting" | "interview"> =>
    ipcRenderer.invoke("cfg:set-mode", mode),
  getTriggerMode: (): Promise<"off" | "rules" | "llm" | null> =>
    ipcRenderer.invoke("cfg:get-trigger-mode"),
  setTriggerMode: (m: "off" | "rules" | "llm" | null): Promise<void> =>
    ipcRenderer.invoke("cfg:set-trigger-mode", m),
  getInterview: (): Promise<{
    role?: string;
    company?: string;
    jobDescription?: string;
  }> => ipcRenderer.invoke("cfg:get-interview"),
  setInterview: (next: {
    role?: string;
    company?: string;
    jobDescription?: string;
  }): Promise<{ role?: string; company?: string; jobDescription?: string }> =>
    ipcRenderer.invoke("cfg:set-interview", next),
  getTranscriptN: (): Promise<number> =>
    ipcRenderer.invoke("cfg:get-transcript-n"),
  setTranscriptN: (n: number): Promise<number> =>
    ipcRenderer.invoke("cfg:set-transcript-n", n),
});
