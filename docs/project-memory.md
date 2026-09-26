# Project memory

Durable facts only. Read before major work; update after major decisions.

## What this is

A local-first desktop app (Electron) that turns any meeting (Teams, Zoom, Google Meet, Slack huddles, anything else) into notes: TL;DR, topics, decisions, action items with owners and deadlines, open questions, risks, and a follow-up email draft. The user's mental model: open, allow once, **Start taking notes**, **Stop**, read.

## Layout

| Path                        | What                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/core`             | Platform-independent intelligence (pure TypeScript, no Electron). Runs under Node type stripping; no build step.     |
| `packages/core/fixtures`    | Acme Demo Corporation: 15 scenarios (16 transcripts) with ground truth, long-meeting generator, 5 held-out meetings. |
| `packages/core/eval`        | Evaluation harness and quality gate.                                                                                 |
| `apps/desktop/src/main`     | Electron main process: data, capture, speech, processing, email, tray.                                               |
| `apps/desktop/src/renderer` | React UI (plain CSS design system in `styles.css`).                                                                  |
| `apps/desktop/src/preload`  | Two sandboxed bridges (main window, hidden capture window).                                                          |
| `apps/desktop/e2e`          | Playwright tests that drive the real Electron app.                                                                   |

## Key decisions (details in architecture-decisions.md)

- Electron 44 + electron-vite 5 + electron-builder. Vite pinned to 7 (electron-vite 5 does not support Vite 8). TypeScript 6.0 (typescript-eslint caps at <6.1).
- Storage: `node:sqlite` (built into Electron 44 / Node 24) with FTS5. No native DB module. Data folder: Electron `userData` (`-development` / `-test` suffixes outside production, or `MEETING_ASSISTANT_DATA_DIR`).
- Speech: `sherpa-onnx-node` 1.13.8 in an Electron utility process. VAD Silero, ASR Moonshine base (default), speaker embeddings WeSpeaker ResNet34. Models downloaded on first use from k2-fsa GitHub releases, SHA-256 pinned in `transcription/models.ts`.
- **Inside Electron, call sherpa with `enableExternalBuffer = false`** (`vad.front(false)`, `extractor.compute(stream, false)`). Electron's V8 forbids external buffers; default calls fail with "External buffers are not allowed".
- Speaker labels: live online clustering (cosine 0.72) plus an end-of-meeting average-linkage pass (0.75) that relabels meeting-audio segments. Microphone channel = "You" (one person per mic).
- Meeting audio: Windows/Linux via Chromium loopback (`setDisplayMediaRequestHandler` with `audio: 'loopback'`, hidden capture window, start runs as a user gesture). macOS 14.2+ via AudioTee (Core Audio taps). Electron's own macOS loopback with a custom picker is broken upstream (electron/electron#52738).
- AI: one structured pass. Claude (`claude-opus-5`, `client.beta.messages.parse` + `betaZodOutputFormat`, `fallbacks: 'default'` with beta `server-side-fallback-2026-07-01`, adaptive thinking) or the offline rules engine. The validator (`core/src/validate.ts`) is the hallucination guard for both. Email is composed by code from validated notes.
- Email: default opens a `mailto:` draft in the user's mail app; mock provider in tests writes `test-outbox/`. Never report "sent" unless a provider really sent.
- Sandboxed preloads must be single files. The two preloads share no modules (capture preload inlines its channel names; a test checks they match). electron-vite's `isolatedEntries` crashes without a TTY (5.0.0), so it is not used.
- Windows E2E: `electronApp.process()` is not the app's main process; to simulate a crash, kill `await app.evaluate(() => process.pid)` (ADR-014).
- Packaging: `scripts/verify-native.cjs` fails the build if the speech engine binary for the target is missing. macOS CI installs both CPU variants (`supportedArchitectures`) before packaging. Linux executable name is `meeting-assistant`. Releases are drafts.
- `MEETING_ASSISTANT_E2E_EXECUTABLE` runs the E2E suite against a packaged app.
- Synthetic test audio uses near-zero TTS noise (0 means "default" in sherpa-onnx) so CI is repeatable.
- Renderer imports core only through `@meeting-assistant/core/ui` to keep the bundle small (~300 KB minified; `minify: true` is set explicitly because electron-vite does not minify by default).

## Test environment

- `MEETING_ASSISTANT_ENV=test` forces mock email and no API key. `MEETING_ASSISTANT_FAKE_PERMISSIONS=1` (test only) enables Chromium fake media devices. `MEETING_ASSISTANT_DEMO_SPEED` speeds up sample meetings. `MEETING_ASSISTANT_TEST_MEETING_AUDIO` streams a WAV as meeting audio.
- Real-speech tests need `MEETING_ASSISTANT_TEST_MODELS` and `MEETING_ASSISTANT_TEST_WAV` (see `scripts/fetch-models.mts`, `scripts/synth-meeting.mjs`).
- Linux E2E needs `xvfb-run -a`.

## Known limitations (keep current)

- Windows and macOS have not been run on real hardware by the team; CI runs unit and E2E tests on GitHub's Windows and macOS runners.
- Installers are unsigned (no certificates). macOS auto-update needs signing.
- One person per microphone: in-room meetings on a shared mic are all labelled "You".
- Offline engine is conservative; on the held-out set (first run) decision recall was 60% and action precision 82%. The held-out set is no longer blind (#18).
- Claude engine is wired and unit-tested with a fake client, but has not been evaluated against the real API (no key in development).
- No calendar integration: participants and recipients come from the user.
- Screen-context OCR is designed (ADR-010) but not built.
