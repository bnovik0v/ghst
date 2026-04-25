# Self-voice capture (dual-speaker transcript)

**Date:** 2026-04-25
**Status:** Approved (design); plan pending

## Problem

Today the app only transcribes the *other* side of the conversation: `pw-record`
taps the default sink's monitor in `src/main/index.ts`, and the worker renderer
runs a single VAD + Whisper pipeline over that stream. The saved transcript and
copilot context therefore omit what the user said, which:

- makes the saved transcript half a conversation,
- prevents the copilot from accounting for what the user already answered.

## Goal

Capture the user's microphone in parallel with the existing sink-monitor stream
and produce a single chronologically-merged, speaker-tagged transcript that:

1. is written to the on-disk transcript file with `You:` / `Them:` labels,
2. is fed to the copilot so suggestions reflect both sides,
3. is shown in the overlay as a subtle running line (latest self utterance only)
   without altering the existing main caption block.

Self-capture is tied to the existing listening toggle — no new shortcut, no
independent mute. If mic permission is denied, the app degrades gracefully to
the current "them-only" behaviour.

Out of scope: speaker diarization beyond the two physical sources, multi-party
calls, post-hoc dedup heuristics (we rely on Chromium's AEC).

## Architecture

A second, symmetric pipeline lives entirely in the **worker renderer**. The
main process is unchanged except for the IPC contract.

```
main: pw-record(sink monitor) ──► IPC evt:pcm ──► worker
                                                    │
                                                    ├── themVad → whisper → LocalAgreement[them] → events { speaker:"them" }
                                                    │
worker: getUserMedia(mic, AEC) ────────────────────► selfVad → whisper → LocalAgreement[self]  → events { speaker:"self" }
                                                    │
                                                    └── merged TranscriptManager (chronological, speaker-tagged)
                                                                     │
                                                                     ├── disk transcript ([HH:MM:SS] You/Them: …)
                                                                     └── buildCopilotMessages(speaker-tagged entries)
```

### Capture

- Existing `pw-record` path on the sink monitor is unchanged.
- New: `navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false,
  noiseSuppression: true, autoGainControl: true } })` in the worker renderer.
  The resulting `MediaStream` flows into a second `MicVAD` instance via the
  `getStream`/`pauseStream`/`resumeStream` callback shape (matching the
  existing them-pipeline).
- **AEC reversal (post-implementation).** The original design had
  `echoCancellation: true`. Real-world testing on Linux/PipeWire showed
  Chromium's WebRTC AEC silently inserts a virtual `module-echo-cancel` sink
  and reroutes default playback through it for the lifetime of the session,
  which kills system audio (the user can't hear YouTube, meetings, etc.) and
  also confuses the AudioContext shared with the them-pipeline so the self
  VAD never produces frames. The side effect is unacceptable, so AEC is off.
- Trade-off: when the user is on **speakers**, the mic picks up the other
  side and we may double-transcribe the same words as both `Them:` (sink
  monitor) and `You:` (mic). The hallucination/backchannel filters drop the
  worst of it. Headphones case is unaffected. If duplication becomes a real
  problem, the v2 follow-up is a small text-overlap dedup window in
  `TranscriptManager` — not shipped in v1.

### VAD / Whisper

- Two independent `MicVAD` instances (`themVad`, `selfVad`) in
  `src/renderer/worker/main.ts`. Each fires its own `onSpeechEnd`, encodes WAV,
  and calls `transcribeWav` independently.
- Two independent `LocalAgreement` instances; no change to `src/core/stream.ts`
  itself.

### Transcript model

- `TranscriptManager` in `src/core/transcript.ts` gains an optional
  `speaker: "self" | "them"` on entries. Default `"them"` for backwards
  compatibility with existing tests and call sites.
- Hallucination and backchannel filters apply per-segment as today.
- Disk serializer interleaves entries chronologically:
  `[HH:MM:SS] You: …` / `[HH:MM:SS] Them: …`.

### IPC contract

In `src/core/types.ts`, every `IPCFromWorker` event that carries caption text
(`evt:caption-tentative`, `evt:caption-committed`, `evt:segment` — exact names
as they exist) gains a required `speaker: "self" | "them"` field. Both
endpoints fail to typecheck until handled, which is the intended seam.

### Copilot

- `buildCopilotMessages` in `src/core/copilot.ts` accepts speaker-tagged
  entries and renders them in time order inside the user message as `You: …` /
  `Them: …` lines.
- `COPILOT_SYSTEM_PROMPT` gains one sentence clarifying the format and the
  asymmetry: the assistant helps **You** respond to **Them**, and should not
  repeat points You have already made.
- Trigger (`Ctrl+Shift+Enter`) and streaming behaviour are unchanged.

### Overlay rendering

- Main caption block keeps current behaviour and only renders entries where
  `speaker === "them"`. No visual regression for users who never speak.
- New element `.self-line` in `src/renderer/overlay/style.css`: single line,
  smaller font (~85% of caption size), ~70% opacity, positioned below the
  caption block. Shows only the latest committed self utterance; replaced as
  new ones arrive. No history, no scroll. Tentative self captions are not
  rendered (avoids flicker on the secondary line).

### Lifecycle

- `Ctrl+Shift+Space` and the overlay start/stop button continue to be the
  single source of truth. On start, both VADs initialize; on stop, both are
  torn down and `MediaStream` tracks are explicitly stopped to release the OS
  mic indicator.
- If `getUserMedia` rejects (permission denied, no input device), log via
  `debug()`, surface a one-time non-blocking notice in the overlay settings
  panel, and continue with `themVad` only. The app must never refuse to start
  because the mic is unavailable.

## Testing

Unit (Vitest, under `tests/`):

- `TranscriptManager` round-trips speaker labels and orders entries by event
  time across speakers.
- Disk serializer emits correctly formatted, chronologically interleaved lines.
- `buildCopilotMessages` renders `You:` / `Them:` lines in time order and the
  system prompt includes the new clarifying sentence.

Manual:

- Headphones case: no echo, both speakers transcribed cleanly.
- Speakers case: expect occasional duplicate transcription (same words appear
  as both `Them:` and `You:`). Acceptable for v1; tracked as a v2 follow-up.
- Mic-permission-denied case: app starts, transcribes `Them:` only, shows the
  notice once.

## Risks

- **No AEC on Linux/Chromium.** Confirmed during implementation that
  Chromium's WebRTC AEC reroutes system audio via a virtual sink, so we
  ship without it. If user reports show duplicate self-captures becoming
  a real annoyance, follow-up work is a small text-overlap dedup window in
  `TranscriptManager`. Not in v1.
- **`MicVAD` instantiation cost.** Two Silero ONNX sessions in the worker
  renderer. Memory cost is modest and the worker is already long-lived; no
  mitigation planned.
