# ghst

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-linux-blue.svg)](#install)
[![Tests](https://img.shields.io/badge/tests-vitest-success.svg)](#tests)

Live system-audio transcription overlay. **ghst** taps whatever your speakers are playing (Meet, Zoom, browser, Spotify — anything mixed to the default sink) **and** your mic, runs Silero VAD on each stream to gate Whisper hallucinations, streams chunks to Groq `whisper-large-v3-turbo` for low-latency captions labelled by speaker (`You` / `Them`), and answers end-of-turn with a copilot reply — all in a transparent, always-on-top window.

> **A free, open-source alternative to paid meeting-copilots like [Cluely](https://cluely.com/) and [Parakeet](https://parakeet.ai/).** Pay only for the Groq API calls (Groq's free tier is generous enough for casual use). 🚧 **WIP — v0.1, Linux-only.** macOS and Windows are stubbed for the future; the app exits cleanly on those platforms.

<p align="center"><img src="./docs/screenshot.png" alt="ghst overlay over a video call" width="820"></p>

## Install

Pre-built Linux artifacts (x86_64) are published on the [Releases page](https://github.com/bnovik0v/ghst/releases/latest).

### AppImage (any distro)

```bash
wget https://github.com/bnovik0v/ghst/releases/latest/download/ghst-x86_64.AppImage
chmod +x ghst-x86_64.AppImage
./ghst-x86_64.AppImage
```

### .deb (Ubuntu / Debian / Mint)

```bash
wget https://github.com/bnovik0v/ghst/releases/latest/download/ghst_amd64.deb
sudo apt install ./ghst_amd64.deb
ghst
```

The `.deb` declares all runtime deps. For the AppImage, install them yourself:

```bash
sudo apt install pipewire-bin pulseaudio-utils libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libasound2
```

### Runtime requirements

- Linux with **PipeWire** (Ubuntu 22.10+, Fedora 34+, Arch, recent Mint/Pop!_OS) — PulseAudio-only systems aren't supported.
- `pipewire-bin` (provides `pw-record`) and `pulseaudio-utils` (provides `pactl`).
- A free Groq API key — sign up at [console.groq.com/keys](https://console.groq.com/keys).

## Setup (first run)

1. Launch ghst. The overlay appears at the top of your screen.
2. The **Settings dialog** opens automatically on first launch — paste your Groq API key and click **Save**.
3. Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> to start listening to your system audio.
4. Speak / play a video call / podcast — captions appear in the overlay; the copilot suggests replies after each turn.

Your API key is encrypted via your OS keyring (libsecret / gnome-keyring on Linux) and saved to `~/.config/ghst/config.json`. It is **never** sent anywhere except directly to Groq.

### Re-opening Settings

Click the **⚙ settings** button on the overlay's hotkey row. From there you can:

- **Save** — replace the stored key with a new one.
- **Remove key** — wipe the saved key from disk (the app will fall back to the `GROQ_API_KEY` env var if you have one set, otherwise prompt again).
- **Close** — dismiss without changes (also: <kbd>Esc</kbd> or click outside the dialog).

### About you (persona)

<p align="center"><img src="./docs/settings.png" alt="ghst settings — About you textarea and transcript saving toggle" width="640"></p>

The Settings dialog has an **About you** textarea. Anything you type there
(name, role, current company, key projects, strong opinions, tone you want
the copilot to take) is injected as background context into every copilot
reply, so suggestions stay grounded in your specifics rather than generic
boilerplate. Capped at 4000 characters. Stored in plaintext in `config.json`
(it's not a secret); leave it blank to opt out. Edits take effect on the
next copilot turn — no restart needed.

### Session context

Before a call, paste anything the copilot should know — meeting goal, who's
on the other side, the deal you're negotiating, the bug you're triaging. The
**Session context** textarea on the overlay shows in place of captions while
idle and gets injected into the copilot prompt for the duration of the
session. Cleared independently from your persona; max 4000 chars.

### Mode: chat vs interview

The overlay has a **Chat / Interview** toggle on the prep stage. In
**Interview** mode, extra fields appear (`Role`, `Company`, `Job description`,
`Session notes`) and the copilot switches to an interview-grounded prompt
that weights examples toward the JD and reasons about the round you're in.
**Chat** mode is the default conversational copilot. The toggle, prep
fields, and visible-transcript size all persist across runs.

### Smart trigger

The copilot doesn't fire on every utterance. Each end-of-turn passes through
a three-stage cascade:

1. **L1 backchannel filter** — drops `mhm`, `ok`, `yeah` and other ≤3-word
   non-questions before they hit the LLM.
2. **L2 rule-based classifier** — fast deterministic check (questions,
   commands, statements) that produces a turn type.
3. **L3 fast-LLM gate** — a cheap Groq call decides whether the moment
   actually warrants a suggestion, with a captured reason.

Tune the cascade in **Settings → Smart trigger** (off / rules-only / full
cascade). Manual `Ctrl+Alt+Enter` always bypasses the gate.

### Self-voice capture

ghst captures your mic in parallel with system audio so the transcript
shows both sides labelled `You:` / `Them:`. The copilot only fires
end-of-turn on `Them` (so you're not interrupted while you talk) and
sees the labels in its context. Saved transcripts include the labels too.
On Linux, Chromium's AEC is intentionally disabled for the self-capture
stream — leaving it on breaks PipeWire routing.

### Saving transcripts

Toggle **Save transcripts to disk** in Settings to write a plain-text
transcript every time you stop listening. Each session lands in a
timestamped `.txt` file under your chosen folder (defaults to
`~/Documents/ghst/transcripts/`). Use **Browse…** to pick a different
folder, **Open folder** to reveal it in your file manager, or
**Reset to default** to restore the default path. Transcripts are
written locally only — nothing is uploaded.

## Hotkeys

| Combo                    | Action                          |
|--------------------------|---------------------------------|
| `Ctrl+Shift+Space`       | Start / stop listening          |
| `Ctrl+Alt+Enter`         | Ask copilot now (manual)        |
| `Ctrl+Shift+C`           | Clear transcript                |
| `Ctrl+Shift+L`           | Show / hide overlay             |
| `Ctrl+Shift+Q`           | Kill switch (hard quit)         |

> The copilot trigger uses `Ctrl+Alt+Enter` (not `Ctrl+Shift+Enter`) to avoid clobbering newline-submit in ChatGPT, Slack, and VS Code.

## Building from source

```bash
git clone https://github.com/bnovik0v/ghst.git
cd ghst
npm ci
npm run dev          # launches Electron in dev mode
npm test             # unit tests
npm run typecheck
npm run dist:linux   # produces dist/*.AppImage and dist/*.deb
```

For verbose logging set `DEBUG=ghst` in the environment, or in DevTools run
`localStorage.setItem("ghst:debug", "1")` and reload.

## Architecture

Three Electron processes with strict boundaries — this is why the API key never leaves main and why the heavy audio work survives Chromium throttling.

- **main** — owns the `pw-record` child process, both `BrowserWindow`s, global shortcuts, the encrypted key store (Electron `safeStorage`), and IPC routing between worker → overlay.
- **worker renderer** (hidden) — runs two Silero VAD pipelines in parallel (system-audio "Them" via main IPC, mic "You" via `getUserMedia`), encodes Float32 → 16-bit WAV, calls Groq Whisper, applies LocalAgreement-2 for live committed/tentative captions, filters hallucinations + backchannels, runs the L1/L2/L3 trigger cascade, and streams the copilot reply on `Them` end-of-turn.
- **overlay renderer** (transparent, frameless, always-on-top, X11 click-through over transparent regions) — renders the ribbon, dual-speaker rolling captions, markdown copilot cards, mode toggle + interview prep fields, session context, listen toggle, and Settings dialog.

Pure logic is isolated in `src/core/*` (no Electron imports) so it's all unit-testable: `wav.ts`, `groq.ts`, `copilot.ts`, `stream.ts` (LocalAgreement), `transcript.ts` (ring buffer + hallucination filter).

## Ghost mode (invisible to screenshare)

- **macOS / Windows**: would use `setContentProtection(true)` — the window is excluded from screen capture. (Not yet supported on those platforms.)
- **Linux (Wayland)**: not possible. There is no per-window exclude API in `xdg-desktop-portal`. The overlay is visible to any screenshare. Workarounds: second monitor, second device, or external preview.

## Troubleshooting

**"Captions never appear / VAD never fires."** The default sink's monitor source may be muted or attenuated. ghst force-sets it to 100% on start, but if a session manager re-attenuates it, captions will stop. Verify:

```bash
pactl get-default-sink
pactl list sources | grep -A 5 monitor
```

**"pw-record: command not found."** Install `pipewire-bin`. The `.deb` package declares this dep; AppImage users on bare systems need to install it manually.

**"App says system-audio capture is Linux-only."** Correct — v0.1 ships Linux-only. macOS/Windows support is on the roadmap.

**"It captures my microphone instead of system audio."** This means PipeWire didn't honor the `stream.capture.sink=true` property. Make sure you're on PipeWire (not pure PulseAudio): `pactl info | grep "Server Name"` should mention PipeWire.

## Tests

```bash
npm test            # one-shot
npm run test:watch  # watch mode
npx vitest run -t "<pattern>"
```

Pure modules covered:
- `wav.ts` — RIFF/WAVE header, clamping, int16 encoding
- `groq.ts` — multipart form shape, bearer auth, error surfacing
- `transcript.ts` — hallucination filter, backchannel detection, ring buffer
- `stream.ts` — LocalAgreement word- and token-level prefix agreement
- `copilot.ts` — SSE delta parsing, message assembly, AbortSignal handling

## License

[MIT](./LICENSE) © Borislav Novikov
