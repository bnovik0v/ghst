# Changelog

All notable changes to this project will be documented in this file.

## [0.4.0](https://github.com/bnovik0v/ghst/compare/v0.3.0...v0.4.0) (2026-04-26)


### Added

* **config:** persist triggerMode in user config ([143ab46](https://github.com/bnovik0v/ghst/commit/143ab46ded733af2cf55ac3c6245f1b701b7487c))
* **copilot:** build context with You/Them labels, EOT only on them ([561d5fa](https://github.com/bnovik0v/ghst/commit/561d5fa52bde57ab427cee51e7508719d930ef21))
* **copilot:** document You/Them transcript format in system prompt ([fee6e1d](https://github.com/bnovik0v/ghst/commit/fee6e1dcaaf1bc4e46b6c2e7d547b36302450c31))
* **copilot:** L2 rule-based turn classifier with type mapping ([ec02832](https://github.com/bnovik0v/ghst/commit/ec02832152937d90536efe1ce0c26fa16acc91ac))
* **copilot:** render <turn_type> tag in user message ([27fd042](https://github.com/bnovik0v/ghst/commit/27fd0420a18dc230ddb28b2ad608c732754567db))
* **copilot:** runTurnGate L3 fast-LLM gate with reason capture ([c864b77](https://github.com/bnovik0v/ghst/commit/c864b772476782fbae47419a0b5fa1c6a4cd6ac1))
* **copilot:** trigger-mode and cascade IPC event types ([3111041](https://github.com/bnovik0v/ghst/commit/31110413cddacab07eee3742541dacaae38a5bff))
* **copilot:** turnGate skeleton with L1 backchannel filter ([746a9d4](https://github.com/bnovik0v/ghst/commit/746a9d4bece3576b7509977d7d4a429fae8b6bc0))
* **copilot:** wire trigger cascade into worker EOT path ([4887e18](https://github.com/bnovik0v/ghst/commit/4887e18595e7b09c8f64d3cabd8d64e716a4d743))
* **copilot:** XML-tagged mode-aware prompt + structured builder ([944707c](https://github.com/bnovik0v/ghst/commit/944707c09772b361932e4c0ea20a3ef1e73d7794))
* **ipc:** expose mode, interview, transcriptN over both bridges ([5df33a2](https://github.com/bnovik0v/ghst/commit/5df33a2e544ea34843753ee5d2bffa2635db60c1))
* **ipc:** triggerMode get/set channels and bridge methods ([76023a4](https://github.com/bnovik0v/ghst/commit/76023a4fe258e455fe88ee38aa904c709d9c63e4))
* **keyStore:** persist mode, interview context, transcriptN ([7cc5ab2](https://github.com/bnovik0v/ghst/commit/7cc5ab25658cae6d2beb409f829401f05ef9f55e))
* **keystore:** persist session context ([8d15560](https://github.com/bnovik0v/ghst/commit/8d155609da399a6cf0ecdc6d591b87548cbf10eb))
* **main:** ipc handlers for session context ([cad76dd](https://github.com/bnovik0v/ghst/commit/cad76dd1ffc109fa4b9d9f8aa0321c95ab5d5adb))
* **main:** widen overlay default window for new layout ([91b0e25](https://github.com/bnovik0v/ghst/commit/91b0e2568d3748585392d4634f4d939e8c2881fc))
* **overlay:** add dimmed self-line element + style ([745447b](https://github.com/bnovik0v/ghst/commit/745447b70d379200d8cb4294bd9bd5522fc125b7))
* **overlay:** click-through transparent areas of the window ([233ac5d](https://github.com/bnovik0v/ghst/commit/233ac5d3623cd06c3399bd3d94e612ef60b58954))
* **overlay:** markdown rendering helper for card bodies ([c659bff](https://github.com/bnovik0v/ghst/commit/c659bff238a69b436bf4164cbf6adc212eabd4e5))
* **overlay:** mode toggle + interview fields + transcript-size setting ([994b06d](https://github.com/bnovik0v/ghst/commit/994b06de21431aba19ab229f177c22586ead864b))
* **overlay:** move mode toggle + interview fields to main-stage prep area ([1f11856](https://github.com/bnovik0v/ghst/commit/1f11856005451581bc474f645239c5ba41f43dab))
* **overlay:** render self transcripts on the running line ([289abb2](https://github.com/bnovik0v/ghst/commit/289abb24e76c3dc0fe3f99cb96bb09d4f372f076))
* **overlay:** ribbon + markdown cards + inline remove + switch toggle ([1365c4c](https://github.com/bnovik0v/ghst/commit/1365c4cf8062bcae8c36695411b7004e4c72d672))
* **overlay:** session context input replaces captions when idle ([45ab0d9](https://github.com/bnovik0v/ghst/commit/45ab0d926d0c9976900114bae4a1fb22b34d4f58))
* **overlay:** session context textarea markup ([3656861](https://github.com/bnovik0v/ghst/commit/3656861f95aa3284cf32531acc396f398c7cc4b2))
* **overlay:** smart-trigger settings + thinking affordance ([8d667e6](https://github.com/bnovik0v/ghst/commit/8d667e66b7c630ab6b9a2719343580f287fcb538))
* **overlay:** style session context textarea ([4f09eaf](https://github.com/bnovik0v/ghst/commit/4f09eaf34d24bdf2459e764cde6f1988c0ce0d63))
* **overlay:** X11 click-through via setShape input regions ([91fa92e](https://github.com/bnovik0v/ghst/commit/91fa92edbbdf90d12d6d5ed1c1831bc9b5498fbb))
* **preload:** bridge methods for session context ([0c9e4a8](https://github.com/bnovik0v/ghst/commit/0c9e4a8e0dbc8291713029dd16b69db667fab0e1))
* **transcript-format:** label disk lines as You/Them ([b7f1f09](https://github.com/bnovik0v/ghst/commit/b7f1f09176d7ee429efa68a8a6c2ccfac1410795))
* **transcript-writer:** persist speaker labels ([d428246](https://github.com/bnovik0v/ghst/commit/d4282461ca8ca2c1a87bfdc6e7c310a886110ccf))
* **transcript:** add speaker arg to TranscriptManager.add ([35e0a61](https://github.com/bnovik0v/ghst/commit/35e0a61a00c33e9c6ab44bb60f88595bb0073137))
* **transcript:** attachSuggestion + getTimeline + setMaxLines ([1b964a3](https://github.com/bnovik0v/ghst/commit/1b964a3f0ba4972c3f201c8ffe7fd77a6aa1de59))
* **types:** add CopilotMode, InterviewContext, TranscriptEntry ([ee5128b](https://github.com/bnovik0v/ghst/commit/ee5128b8edb4192391b6581d5e82e4bd1798d7bf))
* **types:** add Speaker tag to TranscriptLine ([e4951f6](https://github.com/bnovik0v/ghst/commit/e4951f65fca15a18cf6d585ab2c708330e29efcc))
* **worker:** add self-capture pipeline via getUserMedia + AEC ([72eb426](https://github.com/bnovik0v/ghst/commit/72eb426ef25d7ec78016d11d7e3bb32bdb8868a4))
* **worker:** inject session context into copilot prompt ([fb27635](https://github.com/bnovik0v/ghst/commit/fb2763566cbf8fce1dcdc59f68b4c3c29c014089))
* **worker:** use mode-aware builder, attach suggestions to transcript ([dcebe7c](https://github.com/bnovik0v/ghst/commit/dcebe7cf51e7d3171940226f3f9ba5c1678b88e7))


### Fixed

* **copilot:** cascade race + thinking-placeholder cleanup ([aeeb072](https://github.com/bnovik0v/ghst/commit/aeeb07248f2f211040ef55d761c60ae524a83441))
* **copilot:** drop em-dash in good example, soften length cap, rename SHARED_RULES ([b126b17](https://github.com/bnovik0v/ghst/commit/b126b17f698be672f0186f24b0772faf1d087eab))
* **overlay/click-through:** observe each element + bigger rect padding ([64f6abb](https://github.com/bnovik0v/ghst/commit/64f6abba68d9234aefc1d3747237a5c3f7120511))
* **overlay/markdown:** harden link targets and drop unnecessary cast ([6270325](https://github.com/bnovik0v/ghst/commit/627032539dc4ec782388e215cc93a3fd772fff0e))
* **overlay/settings:** drop dim scrim so pod stays visible behind panel ([efb36e3](https://github.com/bnovik0v/ghst/commit/efb36e36467a301e1be98f2e311bc4d03e3b5b68))
* **overlay:** clear self-line on stop and put current card in wide track ([79bf994](https://github.com/bnovik0v/ghst/commit/79bf99498e9c7e6e6f281cfb4d112547737e3348))
* **overlay:** make self-line visually prominent + open overlay devtools with DEBUG=ghst ([7313d81](https://github.com/bnovik0v/ghst/commit/7313d81c2d9d75ccbb83e5c6d215898bca5d28eb))
* **overlay:** prep becomes one solid glass pane so fields read on transparent window ([37da7ee](https://github.com/bnovik0v/ghst/commit/37da7eebd5fec2ed8a2672e9896859f4b79ef2d3))
* **transcript:** log invalid setMaxLines, test eviction with suggestions ([51cf2f5](https://github.com/bnovik0v/ghst/commit/51cf2f59c64f9ffa7ed926868b1ed52969aea4d4))
* **worker:** clean up mic stream on MicVAD init failure ([f9659fb](https://github.com/bnovik0v/ghst/commit/f9659fb9a918baaeef029c1afc2a53215b04aa75))
* **worker:** disable Chromium AEC for self-capture (breaks Linux audio routing) ([3ae9626](https://github.com/bnovik0v/ghst/commit/3ae962610c9b8ff7749b88e02b94d746c1c509bf))
* **worker:** don't block listening start on self-capture init ([f56de74](https://github.com/bnovik0v/ghst/commit/f56de74876175f1a57565541643c5c8550359399))
* **worker:** tune self-VAD thresholds and re-enable NS/AGC ([aa12aa3](https://github.com/bnovik0v/ghst/commit/aa12aa3dd64e4c1a96b48cc19b431c18d6db4c88))


### Changed

* **copilot:** drop renderGateTimeline duplicate ([791f1a0](https://github.com/bnovik0v/ghst/commit/791f1a01091486051475d2431a5c7c63f36312cc))
* **copilot:** merge persona and add sessionContext into single system message ([cd15789](https://github.com/bnovik0v/ghst/commit/cd15789b645aff39243253b500d15e4cf774848d))
* **main:** type overlay IPC handler with OverlayCommand union ([793ea7d](https://github.com/bnovik0v/ghst/commit/793ea7dc2a23928f0a87e5f16b8f6e540142e906))
* **overlay:** a11y fixes — button actions, aria-labelledby, per-key kbd ([f04298f](https://github.com/bnovik0v/ghst/commit/f04298f778afb5ad70fb80dbc2f9ff0a6ebe4294))
* **overlay:** replace chat block with ribbon + stage; rebuild settings markup ([031f8c7](https://github.com/bnovik0v/ghst/commit/031f8c7d9c3d486ca495aa985f8d9991d78e506a))
* **worker:** tag existing pipeline as them-speaker ([8946c26](https://github.com/bnovik0v/ghst/commit/8946c26cbdd914fcea7e1157535e4de2a8a018ef))


### Docs

* add self-line placement to overlay UI polish spec ([12501a2](https://github.com/bnovik0v/ghst/commit/12501a299c4b3ae1929655f19054e78c69305e2f))
* clarify transcript history is dropped from view, not from storage ([fcd3fbc](https://github.com/bnovik0v/ghst/commit/fcd3fbcaa68b0121d2b69295cedf9ee1a3c8d6b5))
* **claude.md:** note Ctrl+Alt+Return rebind and Ctrl+Shift+Q kill switch ([ff36413](https://github.com/bnovik0v/ghst/commit/ff364138cd7ed12eb384548cfaad9ffa6adae9e0))
* copilot prompt overhaul design spec ([ff72b19](https://github.com/bnovik0v/ghst/commit/ff72b19aa285e0185020b3d6ac37d6d46f22a5e1))
* copilot prompt overhaul implementation plan ([8a9f659](https://github.com/bnovik0v/ghst/commit/8a9f659d64f206a87ff9e174fa153b2f59ac72e6))
* overlay UI polish design spec ([55c929a](https://github.com/bnovik0v/ghst/commit/55c929a3911406b28442e738ea5e03314abea944))
* overlay UI polish implementation plan ([b89386a](https://github.com/bnovik0v/ghst/commit/b89386a71f4dd9fcb6fdc294c956f9128a8e9398))
* **plan:** self-voice capture implementation plan ([baf4818](https://github.com/bnovik0v/ghst/commit/baf4818f16d8d59de6b896e893fb9dd9b549be5c))
* **plan:** session context implementation plan ([d2fcd42](https://github.com/bnovik0v/ghst/commit/d2fcd423cf14356da6f0af7b48d6c3a9d28ab23a))
* **readme:** document dual-speaker capture, mode toggle, smart trigger ([d9571a9](https://github.com/bnovik0v/ghst/commit/d9571a9409a844d5625fe7367e71a64923ccbf3b))
* **research:** turn-taking and suggestion-timing prior art ([73daabe](https://github.com/bnovik0v/ghst/commit/73daabe8c3f3a575d820b25c09a4896fc9d1a219))
* **spec:** fold trigger cascade design into copilot prompt overhaul ([19a092d](https://github.com/bnovik0v/ghst/commit/19a092de2dbcdf11500873644971c0fa62722020))
* **spec:** self-voice capture design ([532cf28](https://github.com/bnovik0v/ghst/commit/532cf284aba27c28d3334b5d4a9b420ef3872c97))
* **spec:** session context input design ([0bc2871](https://github.com/bnovik0v/ghst/commit/0bc2871b06f3c84b946b67f6bde52bea9fad1827))
* trigger cascade implementation plan ([a7ed9a8](https://github.com/bnovik0v/ghst/commit/a7ed9a84c9fff185e865c9696b943af239dada81))

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
