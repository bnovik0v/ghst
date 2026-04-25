# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-04-25

### Added
- Encrypted Groq API key storage via Electron `safeStorage` (libsecret / gnome-keyring on Linux).
- In-app **Settings dialog** — opens automatically on first run, re-openable from the new ⚙ button on the overlay.
- `DEBUG=ghst` env (and `localStorage.ghst:debug`) gate verbose logs in main and renderer.
- README install instructions with copy-pasteable `wget` / `apt install` commands; documented Settings flow.
- Repo screenshot in `docs/screenshot.png`.

### Changed
- Audio capture is now explicitly Linux-only (PipeWire). macOS / Windows fail fast with a clear message rather than crashing in `pactl`.
- `setContentProtection` only invoked on darwin / win32 (it's a no-op elsewhere).
- Worker DevTools no longer auto-open on `npm run dev`; gate behind `DEBUG=ghst`.
- Polished GitHub repo description + topics for discoverability.

### Fixed
- Settings button on the overlay was rendering at 0 px width (label was hidden until hover and there was no key-combo glyph).

## [0.1.0] - 2026-04-25

Initial public release: Linux AppImage + deb, PipeWire system-audio capture, Silero VAD, Groq Whisper streaming, copilot replies, transparent always-on-top overlay.
