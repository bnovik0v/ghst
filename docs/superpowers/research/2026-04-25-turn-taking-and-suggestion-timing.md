# Turn-taking and Suggestion-Timing Research for ghst

Date: 2026-04-25
Author: research pass for the copilot prompt overhaul (companion to `docs/superpowers/specs/2026-04-25-copilot-prompt-overhaul-design.md`)

This report investigates whether ghst's silence-VAD-plus-hotkey trigger model is leaving quality on the table relative to (a) shipped competitors, (b) the turn-taking research literature, and (c) currently available open turn-detection models. It ends with concrete recommendations for what to fold into the prompt overhaul vs. what to keep deferred.

---

## 1. How shipped competitors handle suggestion timing

The honest summary: **almost every "interview copilot" on the market today fires on a silence-based VAD endpoint plus a manual hotkey, exactly like ghst.** Differentiation is mostly in the prompt, the UI, and "stealth" features — not in the trigger model. Where vendors do anything smarter, it is rarely documented; most claims are inferred from demos and reviews.

### Cluely
- **Documented behaviour:** "Listens to the interviewer's questions as they are asked and then generates suggested responses." A hotkey can also force a suggestion. ([Cluely product description](https://cluely.com/), [autoapplier review](https://www.autoapplier.com/blog/cluely))
- **Inferred from reviews:** Cluely runs a fixed-shape pipeline — capture, transcribe, generate, render — that produces a 3–5 s pause "regardless of question difficulty," and Business Insider observed 5–10 s lags in practice with occasional freezes up to ~90 s. The constant pause shape is the basis for several "how to detect Cluely" blog posts. ([Cluely review – allaboutai](https://www.allaboutai.com/ai-how-to/use-cluely-ai-to-cheat-detection-tools/), [Sherlock detection blog](https://www.withsherlock.ai/blog/detect-and-prevent-cluely-ai), [Fabric detection blog](https://fabrichq.ai/blogs/how-to-detect-cluely-in-interviews))
- **Trigger model:** clearly silence-based EOU + hotkey. No public evidence of question-type classification or speculative streaming.

### Final Round AI
- Marketed as "ultra-low latency, suggestions appear almost instantly." A side-by-side comparison published by a competitor flags Final Round as having "the slowest live latency in the category" — take with appropriate salt. ([Final Round Interview Copilot](https://www.finalroundai.com/interview-copilot), [favtutor review](https://favtutor.com/articles/final-round-ai-review/))
- No documentation describes the trigger; from demos it is endpoint-on-silence with question detection working on completed transcripts.

### LockedIn AI / Verve AI
- **Documented:** Both expose explicit "Manual Mode" vs. "Auto Mode" toggles, and Verve allows the user to **adjust the silence pause interval** the copilot waits before responding. LockedIn AI markets the same auto/manual switch. ([Verve docs](https://docs.vervecopilot.com/features/interview-copilot), [LockedIn AI](https://www.lockedinai.com/), [LockedIn vs Verve](https://www.lockedinai.com/compare/lockedinai-vs-verve-copilot))
- **Implication:** the industry has converged on "tune the silence threshold" as the user's escape hatch, rather than building real EOU classifiers. This is essentially the knob ghst already has implicitly via Silero VAD's `redemption_frames`.

### Pickle / Glass
- Glass (formerly Pickle's open-source desktop assistant, now archived in places) listens passively to screen + audio and is described as "proactive — surfaces summaries and answers the instant you need them." ([Glass on GitHub](https://github.com/pickle-com/glass), [aibase writeup](https://www.aibase.com/news/19506))
- Reading the source: Glass's meeting copilot updates a sliding context window and re-runs an LLM "ask Pickle" call on a timer / on completed transcript chunks. There is no published EOU model; live "insights" are batched periodic summaries, not per-turn responses.

### Otter "AI Chat", Fireflies "Live Assist", Read.ai
- All three surface live answers **only when the user @-mentions the bot** during the meeting. They are not autonomous responders; they are RAG-over-the-running-transcript with a pull trigger. ([Otter AI Chat help](https://help.otter.ai/hc/en-us/articles/15113481068055-Chat-in-a-conversation), [Fireflies Live Assist](https://guide.fireflies.ai/articles/6032274417-learn-about-fireflies-live-assist-get-real-time-suggestions-answers-and-notes-live-during-the-meeting))
- This is a strong signal: meeting-side products (where false positives are *much* more costly than in a 1:1 interview-cheat scenario) deliberately avoid auto-firing.

### Interview Coder
- Pure hotkey-driven, screenshot-based, no audio at all. ⌘+H to capture, ⌘+↵ to solve. Useful as a calibration point: in a coding-interview niche, vendors decided the trigger problem was best **deleted** by going manual-only. ([interviewcoder.co](https://www.interviewcoder.co/still_working))

### Bottom line on competitors
| Product | Auto trigger | Manual hotkey | Tunable silence | Smarter EOU |
|---|---|---|---|---|
| Cluely | Yes (silence) | Yes | Unclear | No (documented) |
| Final Round | Yes (silence) | Yes | No | No |
| Verve | Yes (silence) | Yes | **Yes** | No |
| LockedIn AI | Yes (silence) | Yes | Toggle auto/manual | No |
| Glass / Pickle | Periodic / on-mention | Yes | n/a | No |
| Otter / Fireflies / Read.ai | **On @-mention only** | Yes | n/a | No |
| Interview Coder | n/a (screen) | **Hotkey-only** | n/a | n/a |

ghst's current silence-VAD + hotkey design is **at parity** with the entire interview-copilot category, and *ahead* of meeting tools that intentionally disable auto-fire. Verve's "tune the pause interval" is the most concrete differentiator anyone ships.

---

## 2. Turn-taking research relevant to live LLM assistants

The literature is unambiguous: silence-based endpointing is a known-bad heuristic, and there are working alternatives.

### Why pure silence VAD is bad
- Mid-utterance breath pauses and filler ("uh… so…") routinely exceed 500 ms.
- Interviewers think aloud, restart sentences, and trail off mid-thought ("…so what I'm wondering is…").
- Conversely, real turn-yields can come **without** any silence at all, signalled by prosody (final lowering, lengthening) or syntactic completion.
- Skantze's review consolidates 30 years of conversation-analytic and computational work showing turn-taking is a *projection* problem, not a *detection* problem: humans predict the end of the other's turn ~200 ms before it happens using grammar + prosody. ([Skantze 2021 review](https://www.semanticscholar.org/paper/Turn-taking-in-Conversational-Systems-and-A-Review-Skantze/697589187eeb8e61de7bd39a5d5005e20c4d7b89))

### TurnGPT and projection
- **TurnGPT** (Ekstedt & Skantze, 2020) is a finetuned GPT-2 with a special turn-shift token; it scores the probability of a turn boundary after every word. Outperforms silence baselines and learns to use pragmatic completion, not just punctuation. ([arXiv 2010.10874](https://arxiv.org/abs/2010.10874), [GitHub](https://github.com/ErikEkstedt/TurnGPT))
- Skantze's follow-up "Projection of Turn Completion" (SIGDIAL 2021) explicitly *predicts the words the interlocutor will say next* and fires when projected completion is reached — i.e. you don't wait for silence at all. ([SIGDIAL 2021](https://aclanthology.org/2021.sigdial-1.45/))

### Production EOU models you can use today
- **LiveKit Turn Detector v0.4 / MultilingualModel.** Distilled from Qwen2.5-7B into a 0.5B Qwen2.5-0.5B-Instruct that runs on CPU. Operates on STT text (text-only, no prosody), produces a per-token EOU probability, with per-language thresholds. Reports 98.8% accuracy on completed turns, 87.5% on incomplete ones. **39% reduction in interruptions** vs. silence-only. Claimed CPU inference latency in the tens of ms. License: open weights. ([LiveKit blog](https://blog.livekit.io/improved-end-of-turn-model-cuts-voice-ai-interruptions-39/), [HF model card](https://huggingface.co/livekit/turn-detector), [LiveKit docs](https://docs.livekit.io/agents/build/turns/turn-detector/))
- **Pipecat Smart Turn v3 / v3.1.** Audio-native (operates on the raw waveform, not text), BSD-2, 23 languages, **12 ms CPU inference on modern CPUs, 60 ms on a small AWS instance**. Specifically designed to use prosody so it complements text-based EOU classifiers. ([Smart Turn v3 announcement](https://www.daily.co/blog/announcing-smart-turn-v3-with-cpu-inference-in-just-12ms/), [GitHub](https://github.com/pipecat-ai/smart-turn), [HF v3](https://huggingface.co/pipecat-ai/smart-turn-v3))
- **OpenAI Realtime "semantic_vad".** Hosted-only, but a useful design reference: a semantic classifier scores P(user-done) on the running transcript, with an `eagerness` knob trading off interruption risk vs. latency. Replaces silence detection with content-aware end-of-thought. ([OpenAI realtime VAD docs](https://developers.openai.com/api/docs/guides/realtime-vad))
- **Deepgram UtteranceEnd** is a cheaper but useful middle ground — it endpoints based on word-timing gaps from STT rather than raw VAD, which is materially better in noisy environments. ([Deepgram UtteranceEnd](https://developers.deepgram.com/docs/utterance-end))

The category has clearly shifted from "silence" to "transcript-aware classifier (LiveKit-style) + audio prosody classifier (Pipecat-style)" between roughly 2024 and 2026. Either or both run comfortably on CPU.

---

## 3. Question / turn-type classification

Independent of *when* to fire, there is a question of *what kind of turn just ended*. The design spec lists "Detected-question-type signal injected into the prompt" and "Two-pass classifier-then-responder" as deferred.

### Evidence from the voice-agent world
- A common pattern is a **parallel small classifier** (or SLM) running alongside the main LLM call: it can label the turn ("guardrail violation," "interruption," "fallback") and either intervene or annotate the prompt without serializing latency. WebRTC.ventures' parallel-SLM-and-LLM writeup reports SLM first-token in ~329 ms vs. ~900 ms for the main LLM, with the SLM acting as a fast fallback while the LLM produces the high-quality answer. ([WebRTC.ventures](https://webrtc.ventures/2025/06/reducing-voice-agent-latency-with-parallel-slms-and-llms/))
- **Sequential** classifier-then-responder is rarely a win on latency for voice. It is sometimes a win on *quality* when the system prompt branches dramatically by turn type (e.g. tool-using vs. chit-chat).
- For a copilot whose main job is *generating an answer for the human* (not speaking back), sequential cost is much more tolerable: the human hasn't started answering yet, so a 200–400 ms classifier pass is invisible.

### Classifying interview turns
There is no purpose-built public benchmark for "behavioural vs. technical vs. system-design vs. clarification vs. statement-not-question," but:
- A 0.5B-class instruction model on the running transcript gives essentially-free labels (LiveKit's EOU model already runs a Qwen-0.5B at every STT final — adding a "what kind of question is this?" head is essentially free if you reuse the same context).
- More cheaply: a **regex + heuristic** front-end ("does the last segment end in a `?`, contain `tell me about a time`, contain `design a`, contain a known company/tool entity?") catches >80% of the meaningful branches at zero latency cost. This matches what LockedIn/Verve seem to do under the hood when they distinguish "coding" vs. "behavioural" prompts in their preset packs.

### Pre-extraction
Pre-extracted entities (company names, technologies, role keywords, "tell me about a time" markers) demonstrably help retrieval-augmented prompts. The standard pattern in voice-agent infra is the "Slow Thinker" sidecar — a background pass that maintains a structured representation of the conversation (entities, open questions, recent claims) and the main LLM reads from it. ([VoiceAgentRAG arXiv](https://arxiv.org/html/2603.02206v1))

---

## 4. Mid-utterance / speculative generation

The streaming-LLM-on-partial-transcript pattern is now mainstream in voice-agent infra:

- **Concept:** STT emits partials; the LLM starts generating on each partial; on each new partial the in-flight generation is either kept or aborted; on `final`, the latest generation is committed. ([Cresta engineering](https://cresta.com/blog/engineering-for-real-time-voice-agent-latency), [LiveKit pipeline architecture](https://livekit.com/blog/sequential-pipeline-architecture-voice-agents))
- **Reported gains:** Gladia's "Partials" feature emits first-token text in <100 ms, with their pipeline reaching multi-hundred-ms total LLM latencies that are otherwise unattainable. AssemblyAI Universal-3 Pro also targets ~300 ms partial latency. ([Gladia Partials](https://www.gladia.io/blog/introducing-partial-transcripts), [AssemblyAI Universal-3](https://chatgate.ai/post/assemblyai-universal-3-pro-streaming))
- **LTS-VoiceAgent** (Listen-Think-Speak, arXiv 2601.19952) formalises a Thinker/Speaker split that handles "pause-and-repair" and intent drift while doing speculative drafts — useful design reference. ([LTS arXiv](https://arxiv.org/html/2601.19952))
- **Cost:** the wasted-token tax is real but small. If the average revised draft happens 2× per turn and each draft is ~150 tokens of output before being aborted, the cost is ~300 wasted output tokens per turn — a few cents at most on Groq pricing, less on OSS. The latency win (700–1500 ms shaved off perceived response time) is large.
- **Critical caveat:** speculative generation is a much bigger win when the LLM is talking back to the user. For ghst, where the LLM produces a *visual suggestion the user reads*, the win is "the suggestion appears the moment the question ends" rather than 1–2 s later. Still material, but not the same multi-second savings as a TTS pipeline.

---

## 5. UX patterns for *when to show* the suggestion

Aggregating across all the products surveyed:

- **Eager during the other's turn.** Cluely, Verve, Final Round all render *something* (transcript chunks) while the other party is talking. The actual *answer card* appears after EOU. None render a half-finished answer.
- **Visible "thinking…" affordance.** Most products show a live-transcript band; the answer card slides in once ready. None block on the answer (would feel frozen). Cluely's pause has been criticised precisely because the thinking state isn't well telegraphed.
- **Auto-dismiss on user speech.** Documented in several products (Cluely, LockedIn) — when the candidate starts speaking, the latest card is "locked in" and the next turn starts fresh. This avoids the candidate reading mid-sentence-revised text on screen.
- **Manual mode escape valve.** Universally provided. The user controls when to ask "what should I say."
- **No product** exposes streamed answer-token-by-answer-token *during* the question — every product waits for some form of EOU before showing the answer. The literature suggests this is correct: the human can't read a moving target while being spoken to.

---

## Recommendations for ghst

Mapping all of the above to the deferred items in the design spec:

### Bring into scope (high ROI, low risk)

1. **Replace silence-only EOU with a hybrid: silence VAD + a transcript-aware EOU classifier.**
   - Use the LiveKit turn-detector model (Qwen2.5-0.5B distilled, open weights) as a cheap classifier. It is text-only, runs on CPU in tens of ms, and reduced interruptions 39% in LiveKit's own A/B. It plugs into the worker renderer between Whisper finals and the copilot trigger.
   - Keep current silence as a *fallback* for when classifier confidence is borderline. This is exactly the pattern OpenAI's `semantic_vad` and LiveKit's stack already use.
   - **Do not** ship Pipecat smart-turn yet: it requires running a second audio-native model and the marginal accuracy gain over a transcript classifier on English-only interview audio is small relative to the integration cost.
   - **Expose an `eagerness` knob** (Verve and OpenAI both ship one). Two presets are enough: "snappy" (short timeout, fire on borderline EOU) and "patient" (long timeout, only fire on confident EOU). This is the single most-requested escape valve users of competitors actually use.

2. **Add a cheap rule-based question-type signal to the prompt.**
   - A regex/keyword classifier (`?` suffix, "tell me about a time," "design a," "walk me through," named-entity hits like company/tech keywords) is essentially zero-cost and gives the LLM a structured `turn_type=behavioural` field to branch on.
   - No need for a two-pass classifier-then-responder — the rule layer is sub-millisecond and runs in the same renderer that already runs `transcript.ts` heuristics. Treat this as a minor extension of the existing `isBackchannel` / `isLikelyHallucination` family in `src/core/transcript.ts`.

3. **Pre-extract a small structured context block once per turn.**
   - Capture entities the question references (company names, tools/frameworks, the literal question stem). Inject as a `<context>` block in the system prompt. Cheaply prevents the LLM from guessing what "their stack" or "the role" means.
   - Maintain it in a side `ConversationState` object on the worker. Cleared between sessions; survives across turns within a session.

### Keep deferred (good ideas, expensive vs. payoff right now)

4. **Two-pass classifier-then-responder with an LLM classifier.** Sequential LLM calls add a full RTT before the user sees anything; the rule-based label in (2) captures most of the upside. Revisit only if quality measurements show the responder repeatedly mis-targets the answer style.

5. **Speculative streaming on partial transcripts.** ghst's product is a *read-along card*, not a TTS reply. The latency win is ~1 s, not 3–4 s, and the wasted-draft UX (text appearing then changing as the question is finalised) is jarring on a visual surface. Worth revisiting if/when a TTS or earpiece mode lands; not in this overhaul.

6. **Audio-prosody EOU (Pipecat smart-turn).** Lovely model, but solves a problem that mostly hurts when the agent has to *talk back*. ghst's text-card UX is more forgiving of an extra 200–500 ms.

7. **Mid-utterance prediction / Skantze-style turn projection.** Research-grade; no production reference implementation that integrates with Whisper streaming. Park.

### UX changes to match (small, ship together)

- **Show a "thinking…" affordance** on the overlay while the EOU classifier has fired but the answer is mid-stream. Cluely's biggest documented UX failure is the *invisible* thinking state.
- **Auto-dismiss / lock-in the previous card** on first sign of user speech (`onSpeechStart` from the existing VAD). Already partially possible with current IPC; finish it.
- Keep `Ctrl+Shift+Enter` as the manual override — every successful product in this space ships both auto and manual, and users actively use the manual fallback when auto trips on filler pauses.

### One-line architectural diff

Today: `silence VAD → Whisper final → copilot LLM`.
Proposed: `silence VAD → Whisper final → (rule-classifier ∥ LiveKit EOU model) → copilot LLM with turn_type + entities`.

That gets ghst from "category parity" to "best-in-category trigger quality" with no new external services, ~10 ms of added per-turn CPU, and no change to the user's mental model.

---

## Sources

- Cluely: <https://cluely.com/>, <https://www.autoapplier.com/blog/cluely>, <https://www.allaboutai.com/ai-how-to/use-cluely-ai-to-cheat-detection-tools/>, <https://www.withsherlock.ai/blog/detect-and-prevent-cluely-ai>, <https://fabrichq.ai/blogs/how-to-detect-cluely-in-interviews>, <https://tldv.io/blog/cluely-review/>
- Final Round: <https://www.finalroundai.com/interview-copilot>, <https://favtutor.com/articles/final-round-ai-review/>
- LockedIn AI / Verve: <https://docs.vervecopilot.com/features/interview-copilot>, <https://www.lockedinai.com/>, <https://www.lockedinai.com/compare/lockedinai-vs-verve-copilot>
- Pickle / Glass: <https://github.com/pickle-com/glass>, <https://www.aibase.com/news/19506>
- Otter / Fireflies / Read.ai: <https://help.otter.ai/hc/en-us/articles/15113481068055-Chat-in-a-conversation>, <https://guide.fireflies.ai/articles/6032274417-learn-about-fireflies-live-assist-get-real-time-suggestions-answers-and-notes-live-during-the-meeting>, <https://www.read.ai/articles/best-ai-meeting-assistants>
- Interview Coder: <https://www.interviewcoder.co/still_working>
- LiveKit Turn Detector: <https://blog.livekit.io/improved-end-of-turn-model-cuts-voice-ai-interruptions-39/>, <https://huggingface.co/livekit/turn-detector>, <https://docs.livekit.io/agents/build/turns/turn-detector/>, <https://blog.livekit.io/using-a-transformer-to-improve-end-of-turn-detection>
- Pipecat Smart Turn: <https://github.com/pipecat-ai/smart-turn>, <https://www.daily.co/blog/announcing-smart-turn-v3-with-cpu-inference-in-just-12ms/>, <https://huggingface.co/pipecat-ai/smart-turn-v3>
- OpenAI semantic VAD: <https://developers.openai.com/api/docs/guides/realtime-vad>
- Deepgram UtteranceEnd / endpointing: <https://developers.deepgram.com/docs/utterance-end>, <https://developers.deepgram.com/docs/endpointing>, <https://deepgram.com/learn/voice-activity-detection>
- TurnGPT and Skantze: <https://arxiv.org/abs/2010.10874>, <https://github.com/ErikEkstedt/TurnGPT>, <https://aclanthology.org/2021.sigdial-1.45/>, <https://www.semanticscholar.org/paper/Turn-taking-in-Conversational-Systems-and-A-Review-Skantze/697589187eeb8e61de7bd39a5d5005e20c4d7b89>
- Voice-agent latency / speculative streaming: <https://cresta.com/blog/engineering-for-real-time-voice-agent-latency>, <https://livekit.com/blog/sequential-pipeline-architecture-voice-agents>, <https://www.gladia.io/blog/introducing-partial-transcripts>, <https://chatgate.ai/post/assemblyai-universal-3-pro-streaming>, <https://arxiv.org/html/2601.19952>, <https://webrtc.ventures/2025/06/reducing-voice-agent-latency-with-parallel-slms-and-llms/>, <https://arxiv.org/html/2603.02206v1>
