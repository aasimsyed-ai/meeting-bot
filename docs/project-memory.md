# Project memory

Durable facts only. Read before major work; update after major decisions.

## What this is

A local-first desktop app (Electron) that turns any meeting (Teams, Zoom, Google Meet, Slack huddles, anything else) into notes: TL;DR, topics, decisions, action items with owners and deadlines, open questions, risks, and a follow-up email draft. The user's mental model: open, allow once, **Start taking notes**, **Stop**, read.

## Layout

| Path                        | What                                                                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`             | Platform-independent intelligence (pure TypeScript, no Electron). Runs under Node type stripping; no build step.                                                                                      |
| `packages/core/fixtures`    | Acme Demo Corporation: 15 scenarios (16 transcripts) with ground truth, long-meeting generator, 5 held-out meetings, 8 difficult meetings (`hard.ts`, one real captured transcript in `captured.ts`). |
| `packages/core/eval`        | Evaluation harness and quality gate.                                                                                                                                                                  |
| `apps/desktop/src/main`     | Electron main process: data, capture, speech, processing, email, tray.                                                                                                                                |
| `apps/desktop/src/renderer` | React UI (plain CSS design system in `styles.css`).                                                                                                                                                   |
| `apps/desktop/src/preload`  | Two sandboxed bridges (main window, hidden capture window).                                                                                                                                           |
| `apps/desktop/e2e`          | Playwright tests that drive the real Electron app (`harness.spec.ts` needs the capture harness).                                                                                                      |
| `tests/capture`             | Capture harness: scenarios, TTS synthesizer, stand-in meeting app, PulseAudio setup, runner (`run.sh`).                                                                                               |

## Free-first rule

No paid API key, service or certificate during development unless the user explicitly approves it. Prefer open-source, local models, local transcription, mock providers and synthetic data. Missing credentials mean a mock or local implementation, never a blocked project. Before proposing any paid service, state what it is, why it is needed, the free alternative, the estimated cost, and whether it is MVP or production only. Production-only items live in `docs/release-prerequisites.md`.

## Key decisions (details in architecture-decisions.md)

- Electron 44 + electron-vite 5 + electron-builder. Vite pinned to 7 (electron-vite 5 does not support Vite 8). TypeScript 6.0 (typescript-eslint caps at <6.1).
- Storage: `node:sqlite` (built into Electron 44 / Node 24) with FTS5. No native DB module. Data folder: Electron `userData` (`-development` / `-test` suffixes outside production, or `MEETING_ASSISTANT_DATA_DIR`).
- Speech: `sherpa-onnx-node` 1.13.8 in an Electron utility process. VAD Silero, ASR **Parakeet v3 (default since the capture validation phase; Moonshine base and tiny are smaller options)**, speaker embeddings WeSpeaker ResNet34. Models downloaded on first use from k2-fsa GitHub releases, SHA-256 pinned in `transcription/models.ts`. Each speech segment is recognized with 250 ms of audio either side (VAD cuts clip words).
- **Inside Electron, call sherpa with `enableExternalBuffer = false`** (`vad.front(false)`, `extractor.compute(stream, false)`). Electron's V8 forbids external buffers; default calls fail with "External buffers are not allowed".
- Speaker labels: live online clustering (cosine 0.72) plus an end-of-meeting average-linkage pass (0.75) that relabels meeting-audio segments. Microphone channel = "You" (one person per mic).
- Meeting audio: Windows/Linux via Chromium loopback (`setDisplayMediaRequestHandler` with `audio: 'loopback'`, hidden capture window, start runs as a user gesture). **Request it with `echoCancellation`, `noiseSuppression` and `autoGainControl` false**: Chromium's defaults cancel the meeting audio and turned the PulseAudio monitor volume down to 8% (BUG-017). macOS 14.2+ via AudioTee (Core Audio taps). Electron's own macOS loopback with a custom picker is broken upstream (electron/electron#52738).
- AI: `Extractor` is the offline rules engine (default) or `LlmExtractor(provider)` with providers mock, local-llm (OpenAI-compatible, e.g. Ollama) and optional Claude (`docs/ai-providers.md`). Env override `MEETING_ASSISTANT_AI_PROVIDER`; tests only allow rules or mock. Claude details: (`claude-opus-5`, `client.beta.messages.parse` + `betaZodOutputFormat`, `fallbacks: 'default'` with beta `server-side-fallback-2026-07-01`, adaptive thinking) or the offline rules engine. The validator (`core/src/validate.ts`) is the hallucination guard for both. Email is composed by code from validated notes.
- Email: default opens a `mailto:` draft in the user's mail app; mock provider in tests writes `test-outbox/`. Never report "sent" unless a provider really sent.
- Sandboxed preloads must be single files. The two preloads share no modules (capture preload inlines its channel names; a test checks they match). electron-vite's `isolatedEntries` crashes without a TTY (5.0.0), so it is not used.
- Windows E2E: `electronApp.process()` is not the app's main process; to simulate a crash, kill `await app.evaluate(() => process.pid)` (ADR-014).
- Packaging: `scripts/verify-native.cjs` fails the build if the speech engine binary for the target is missing. macOS CI installs both CPU variants (`supportedArchitectures`) before packaging. Linux executable name is `meeting-assistant`. Releases are drafts.
- `MEETING_ASSISTANT_E2E_EXECUTABLE` runs the E2E suite against a packaged app.
- Synthetic test audio uses near-zero TTS noise (0 means "default" in sherpa-onnx) so CI is repeatable.
- Capture honesty: `CaptureStatus.hearing` ('ok' | 'partial' | 'none' | 'starting'); `shared/capture-label.ts` is the one place that decides the headline, used by the live screen, sidebar and tray. Never show "Taking notes" when no audio arrives.
- Recovery: sources restart on their own (1 s, 3 s, 10 s, 30 s, then every minute), on any device change, and via "Try again" (`capture:retryAudio`); the capture page rebuilds its audio graph when needed.
- Screen reading: `capture/screen.ts` (`ScreenWatcher`, pure, unit-tested) + `capture/screen-source.ts` (Electron `desktopCapturer` window thumbnails, tesseract.js with the bundled `@tesseract.js-data/eng` best_int data, `asarUnpack` in electron-builder). A 128x72 signature in a 16x9 cell grid decides when to read; moving cells (video) are ignored. Only text is stored (`screen_notes`). The same watcher notices a closed meeting window (15 s) and only suggests stopping.
- Echo removal: a microphone line is an echo only if it starts within 1.5 s of a similar meeting-audio line (a reply repeating the question is not an echo).
- Renderer imports core only through `@meeting-assistant/core/ui` to keep the bundle small (~300 KB minified; `minify: true` is set explicitly because electron-vite does not minify by default).

## Test environment

- `MEETING_ASSISTANT_ENV=test` forces mock email and no API key. `MEETING_ASSISTANT_FAKE_PERMISSIONS=1` (test only) enables Chromium fake media devices. `MEETING_ASSISTANT_DEMO_SPEED` speeds up sample meetings. `MEETING_ASSISTANT_TEST_MEETING_AUDIO` streams a WAV as meeting audio.
- Real-speech tests need `MEETING_ASSISTANT_TEST_MODELS` and `MEETING_ASSISTANT_TEST_WAV` (see `scripts/fetch-models.mts`, `scripts/synth-meeting.mjs`).
- Linux E2E needs `xvfb-run -a`.
- Capture harness (`tests/capture/run.sh <models>`): needs PulseAudio, Xvfb, `openbox` (window list) and `xcompmgr` (capture of covered windows), the speech models and the free VITS LibriTTS TTS model. Env: `MEETING_ASSISTANT_HARNESS=1`, `MEETING_ASSISTANT_HARNESS_AUDIO`, `MEETING_ASSISTANT_TEST_DETECTION=1` (detection in test mode). Results in `.harness/results/`.
- `MEETING_ASSISTANT_TEST_DENY=mic,system,screen` (test only; `globalThis.__testDeny` can change it at run time) makes the capture page act as if access was refused, for permission E2E.
- `MEETING_ASSISTANT_TEST_ASR_MODEL` picks the speech model for real-speech tests (default Parakeet v3). `MEETING_ASSISTANT_PROBE_OUT` runs the transcription probe.

## Known limitations (keep current)

- Windows and macOS have not been run on real hardware by the team; CI runs unit and E2E tests on GitHub's Windows and macOS runners.
- Installers are unsigned development builds; signing is a release-stage task (`docs/release-prerequisites.md`).
- One person per microphone: in-room meetings on a shared mic are all labelled "You".
- Offline engine is conservative; on the held-out set (first run) decision recall was 60% and action precision 82%. The held-out set is no longer blind (#18).
- A free 3B local model was measured and scored below the offline engine (#27); Claude is optional and requires provider credentials.
- Bare acronyms and uncommon names are often misheard (#36).
- Capture validated only on Linux with a stand-in meeting app and synthetic voices; permission denials simulated.
- No calendar integration: participants and recipients come from the user.
- Screen reading tested on Linux only; Windows and macOS window capture untested.
