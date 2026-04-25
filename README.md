# ghst

Live system-audio transcription overlay. Captures whatever your laptop is playing (Meet, Zoom, browser, Spotify, anything) via PipeWire/WASAPI/ScreenCaptureKit loopback, VAD-gates to avoid Whisper hallucinations, and streams to Groq `whisper-large-v3-turbo` in rolling chunks. Renders captions in a transparent, always-on-top overlay.

## Setup

```bash
npm install
cp .env.example .env   # then fill in GROQ_API_KEY
npm test               # unit tests
npm run dev            # launches Electron
```

Toggle overlay visibility with `Ctrl+Shift+L`. Click the button in the overlay to start/stop listening.

## Ghost mode (invisible to screenshare)

- **macOS / Windows**: active via `setContentProtection(true)` — the window is excluded from screen capture.
- **Linux (Wayland)**: not possible. No per-window exclude API exists in `xdg-desktop-portal`. The overlay will be visible to any screenshare. Workaround: put the overlay on a second monitor or second device.

## Stack

- Electron 33 (Wayland-native)
- `electron-audio-loopback` — cross-platform system audio capture
- `@ricky0123/vad-web` — Silero VAD (WASM) running in-renderer
- Groq `whisper-large-v3-turbo` — file-based transcription API
- Vitest for unit tests

## Architecture

- **main**: window management, IPC routing, global hotkey, exposes `GROQ_API_KEY` via IPC (never bundled into renderer).
- **worker renderer** (hidden): `getDisplayMedia({audio:true})` → `MicVAD` with custom `getStream` → on `onSpeechEnd` encodes Float32 16 kHz PCM to WAV → POSTs to Groq → forwards text via IPC.
- **overlay renderer** (transparent, frameless, alwaysOnTop `screen-saver`): rolling last-3-lines UI with toggle button.

## Install (Linux)

Pre-built artifacts are published on the [Releases page](https://github.com/bnovik0v/ghst/releases) for each `v*` tag.

- **AppImage** — download `ghst-<version>-x86_64.AppImage`, `chmod +x`, run. No install needed. Requires `pipewire` + `pulseaudio-utils` (`pactl`, `pw-record`) on the host.
- **deb** — `sudo apt install ./ghst_<version>_amd64.deb`. Declares pipewire/pulseaudio deps.

After install, set `GROQ_API_KEY` in the environment (e.g. `~/.config/environment.d/ghst.conf` or shell rc) before launching.

## Building from source

```bash
npm ci
npm run dist:linux   # produces dist/*.AppImage and dist/*.deb
```

CI (`.github/workflows/release.yml`) runs the same on every `v*` tag and attaches artifacts to a GitHub Release.

## Tests

Pure modules are unit-tested:
- `src/core/wav.ts` — RIFF/WAVE header, clamping, int16 encoding
- `src/core/groq.ts` — multipart form shape, bearer auth, error surfacing (injected fetch)
- `src/core/transcript.ts` — hallucination filter, ring buffer, rolling prompt context
