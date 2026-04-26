# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — launches Electron via electron-vite (with `--no-sandbox`, needed on Linux).
- `npm run build` — production build of main, preload, and renderers into `out/`.
- `npm test` — runs all Vitest unit tests once. `npm run test:watch` for watch mode.
- Run a single test file: `npx vitest run tests/<name>.test.ts`. Filter by name: `npx vitest run -t "<pattern>"`.
- `npm run typecheck` — checks both tsconfigs (`tsconfig.node.json` for main/preload, `tsconfig.web.json` for renderers). Run this before declaring TS work done; there is no separate lint step.
- `npm run dist` / `dist:linux` / `dist:dir` — electron-builder packaging (AppImage + deb on Linux; see `build.deb.depends` in `package.json` for runtime deps like `pipewire-bin`, `pulseaudio-utils`). Artifact names are **versionless** (`ghst-x86_64.AppImage`, `ghst_amd64.deb`) so the README's `releases/latest/download/<name>` URLs stay valid across releases — never re-introduce `${version}` into `appImage.artifactName` or `deb.artifactName` in `package.json`.
- `npm run release` (or `release:patch` / `release:minor` / `release:major`) — bumps version via [release-it](https://github.com/release-it/release-it), regenerates the CHANGELOG from conventional-commit messages (`feat:`/`fix:`/`refactor:`/`docs:` etc — see `.release-it.json`), commits, tags `v${version}`, and pushes. The `release.yml` GitHub Actions workflow then fires on the tag, builds the AppImage + deb, and creates the GitHub Release with the artifacts. Pre-flight hooks run `npm run typecheck` and `npm test`; release-it refuses to run on a dirty tree or off `main`. Do **not** hand-bump `package.json#version` or hand-edit version strings in README install URLs — both should always read from latest tag automatically.
- Groq API key resolution order: encrypted user config (`keyStore.ts` via `safeStorage`) → `GROQ_API_KEY` in `.env` (dotenv, main only — never bundled into renderers). The in-app settings UI writes the encrypted entry; `.env` is a dev/fallback path.
- Debug logging: set `DEBUG=ghst` (main/node) or `localStorage.setItem("ghst:debug", "1")` (renderer) and use `debug()` from `src/core/log.ts`. Errors/warnings always log; `debug()` is gated.

## Runtime / system requirements

- Linux audio capture uses **PipeWire**: main spawns `pw-record` against the default sink's monitor (resolved via `pactl get-default-sink`) with `stream.capture.sink=true` so it taps the loopback rather than falling back to the mic. Without that property the capture silently records the microphone instead. Main also force-sets the monitor source to 100% volume; some configs leave it attenuated to ~8% which kills VAD.
- Captured PCM (16 kHz / mono / s16) is forwarded over IPC (`evt:pcm`) to the hidden worker renderer. The macOS/Windows path described in the README (`electron-audio-loopback` via `getDisplayMedia`) is the cross-platform fallback; on Linux this `pw-record` path is the one wired up.

## Architecture

Three Electron processes, each with a distinct role. Keep these boundaries — they are why the API key never leaves main and why the heavy audio work survives Chromium throttling.

- **main** (`src/main/index.ts`): owns `pw-record`, both `BrowserWindow`s, global shortcuts (`Ctrl+Shift+L` overlay toggle, `Ctrl+Shift+Space` toggle-listen, `Ctrl+Shift+C` clear, `Ctrl+Alt+Enter` copilot trigger, `Ctrl+Shift+Q` kill switch / hard quit), and IPC routing between worker → overlay. Handles key management via `src/main/keyStore.ts` and exposes it over `cfg:groq-key` / `cfg:has-groq-key` / `cfg:set-groq-key` / `cfg:clear-groq-key`. Sets `disable-renderer-backgrounding` / `disable-background-timer-throttling` / `disable-backgrounding-occluded-windows` so the hidden worker keeps draining its AudioWorklet at full speed. Calls `setContentProtection(true)` on the overlay (no-op on Linux/Wayland — see README "Ghost mode").
- **worker renderer** (hidden, `src/renderer/worker/main.ts`): runs `MicVAD` (Silero VAD via `@ricky0123/vad-web`) over the PCM stream from main, on `onSpeechEnd` encodes Float32 → 16-bit WAV (`src/core/wav.ts`), POSTs to Groq `whisper-large-v3-turbo` (`src/core/groq.ts`), runs LocalAgreement-2 (`src/core/stream.ts`) for committed/tentative live captions, filters hallucinations + backchannels (`src/core/transcript.ts`), and may stream a copilot reply (`src/core/copilot.ts`). Emits typed events back through main. DevTools only opens when `DEBUG=ghst` is set.
- **overlay renderer** (transparent, frameless, `alwaysOnTop: "screen-saver"`, `src/renderer/overlay/main.ts`): renders the rolling last-N captions, copilot cards, the start/stop button, and the settings panel (for entering/clearing the Groq key at runtime). Styles live in `src/renderer/overlay/style.css`.

IPC is fully typed via `IPCToWorker` / `IPCFromWorker` discriminated unions in `src/core/types.ts`. Add new messages by extending those unions — both ends will fail to typecheck until handled.

### Pure core modules (`src/core/*`)

These have no Electron imports and are the unit-tested seam — keep them that way (tests under `tests/*.test.ts`). Inject `fetch` rather than calling it implicitly so tests can mock it:

- `wav.ts` — RIFF/WAVE header, Float32 → int16 clamping/encoding.
- `groq.ts` — multipart form to Whisper, bearer auth, error surfacing.
- `copilot.ts` — Groq chat-completions SSE streaming generator (`streamCopilot`) + `buildCopilotMessages`. Honors `AbortSignal`. The system prompt (`COPILOT_SYSTEM_PROMPT`) is intentionally opinionated — modify with care.
- `stream.ts` — `LocalAgreement` (Macháček et al., arXiv:2307.14743). Token- and word-level prefix agreement; `drainWords()` returns committed words + their end time so the audio buffer can be trimmed past them.
- `transcript.ts` — `TranscriptManager` ring buffer, `isLikelyHallucination`, `isBackchannel` (≤3 words, non-question, common acknowledgement starter).
- `log.ts` — `debug()` logger gated by `DEBUG=ghst` / `localStorage["ghst:debug"]`. No Electron imports; safe in both main and renderer.
- `types.ts` — shared IPC discriminated unions (`IPCToWorker`, `IPCFromWorker`).

### Main-only modules (`src/main/*`)

- `keyStore.ts` — encrypted Groq key persistence. Uses Electron `safeStorage` (OS keyring: libsecret on Linux, Keychain on macOS, DPAPI on Windows) and writes base64-encrypted blobs to `app.getPath("userData")/config.json` (mode `0o600`). Refuses to write plaintext when `safeStorage` is unavailable; callers must surface that error to the user. `getGroqKey()` falls back to `process.env.GROQ_API_KEY` when no stored key exists.

### VAD / ONNX assets

`electron.vite.config.ts` has a custom `vadAssetsPlugin` that copies Silero ONNX models, the VAD audio worklet, and the onnxruntime-web `.wasm` / `.mjs` files into `<outDir>/vad/` at build time, and serves them from `/vad/*` via Vite middleware in dev. If you upgrade `@ricky0123/vad-web` or `onnxruntime-web` and assets break, that plugin is the place to fix.

## User-global instructions

The user's global CLAUDE.md notes: prefer `uv` over `pip` for Python projects, `gh` is installed, and **don't add "generated by Claude" to commit messages**.
