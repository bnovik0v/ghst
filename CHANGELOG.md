# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0](https://github.com/bnovik0v/ghst/compare/v0.2.1...v0.3.0) (2026-4-25)


### Added

* **copilot:** persona context for personalized replies ([f465038](https://github.com/bnovik0v/ghst/commit/f465038b648276fff37083275505569ed883a004))
* save session transcripts to disk ([183407d](https://github.com/bnovik0v/ghst/commit/183407de80939b15324293babc8fdf7f6cd9e147))


### Docs

* **readme:** add settings panel screenshot ([cfd3740](https://github.com/bnovik0v/ghst/commit/cfd3740d86004ad4bc03e44eb43facb729b82cb4))
* **readme:** document persona context and transcript saving ([ffe16fd](https://github.com/bnovik0v/ghst/commit/ffe16fde79363fd973900206eacdcd62dc7ff152))

## [0.2.1](https://github.com/bnovik0v/ghst/compare/v0.2.0...v0.2.1) (2026-4-25)

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
