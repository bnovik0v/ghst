# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Encrypted Groq API key storage via Electron `safeStorage` (libsecret / gnome-keyring on Linux).
- In-app Settings dialog — opens automatically on first run.
- `DEBUG=ghst` env (and `localStorage.ghst:debug`) gate verbose logs.
- electron-builder packaging for Linux: AppImage + deb with runtime deps.
- LICENSE (MIT), CHANGELOG.

### Changed
- Audio capture now Linux-only (PipeWire). macOS / Windows fail fast with a clear message.

## [0.1.0] - TBD

Initial public release.
