# Architecture decisions

Short records of decisions that shape the product. Newest last. Each one says what we chose, why, and what we gave up.

## ADR-001: Local-first desktop app, no platform APIs for the core flow

**Decision.** Notes come from what the user's own computer can hear and see (system audio, microphone, optional screen keyframes). Teams, Zoom, Google Meet and Slack APIs are not required for note taking.

**Why.** It works the same on every platform, needs no admin approval or paid API tiers, and matches the user's mental model: "open the app, start taking notes".

**Trade-off.** No native transcripts or attendee lists unless the user adds them. Calendar and platform adapters can be added later behind small interfaces.

## ADR-002: Electron for the desktop shell

**Options considered.** Electron, Tauri (Rust + webview), native apps per OS.

**Decision.** Electron 44 with electron-vite and electron-builder.

**Why.**

- System audio on Windows works through Chromium's WASAPI loopback (`setDisplayMediaRequestHandler` with `audio: 'loopback'`), with no native code.
- Microphone, screen thumbnails, tray, notifications, safe credential storage (`safeStorage`) and auto-update (`electron-updater`) are built in.
- Playwright can drive the real app on Linux, Windows and macOS in CI.
- One TypeScript codebase for UI, capture orchestration and AI.

**Trade-off.** Larger installer (~100 MB) than Tauri. Meetily shows Tauri + Rust works well, but it needs native audio code per OS that we would have to write and maintain.

## ADR-003: macOS system audio through Core Audio taps (AudioTee), not Chromium loopback

**Research.** Electron's macOS loopback only captures audio when Electron's own system picker drives capture. With a custom source it creates a track that never produces data (electron/electron#52738, open). AudioTee (MIT) wraps Apple's Core Audio taps API (macOS 14.2+) in a small Swift binary and streams PCM.

**Decision.** macOS 14.2+: AudioTee child process. Windows: Chromium WASAPI loopback. Linux: Chromium PulseAudio/PipeWire loopback (best effort). If system audio is unavailable, capture continues from the microphone and the app says so plainly.

**Trade-off.** One more binary to sign on macOS. macOS 13 and older cannot capture system audio in this version.

## ADR-004: sherpa-onnx for on-device speech (VAD, recognition, speaker labels)

**Options considered.** whisper.cpp bindings, transformers.js, cloud speech APIs, sherpa-onnx.

**Decision.** `sherpa-onnx-node` (Apache-2.0). One package gives voice activity detection (Silero), offline recognition (Moonshine, Whisper, Parakeet) and speaker embeddings, with prebuilt N-API binaries for Windows, macOS and Linux.

**Measured in this repo's spike** (4-core Linux container, 2 threads, 15.8 s synthetic meeting):

| Model                                | Download | Speed           | Result                |
| ------------------------------------ | -------- | --------------- | --------------------- |
| Moonshine tiny (int8)                | 108 MB   | ~6x real time   | Some word errors      |
| Moonshine base (int8)                | 251 MB   | ~10x real time  | Perfect on the sample |
| Parakeet TDT v3 (int8, 25 languages) | 487 MB   | ~7.5x real time | One dropped phrase    |

Default: Moonshine base (English). Multilingual option: Parakeet v3. Speaker labels come from online clustering of speaker embeddings (WeSpeaker ResNet34), which separated the two synthetic voices in the spike. Four voices needed a second pass (ADR-011).

**Trade-off.** Models are downloaded once (about 280 MB total by default). No cloud speech in the MVP.

## ADR-005: One structured AI pass plus a deterministic validator

**Decision.** Transcript, normalize, extract (one schema-constrained call), validate, summarize, draft email. No agents. Two interchangeable extractors:

- **Claude** (`claude-opus-5`, structured outputs, server-side refusal fallbacks) for best quality.
- **Rules** (offline, deterministic) for private mode, demo mode, tests and as the automatic fallback.

The validator is the hallucination guard: items without transcript evidence are dropped, unsupported owners and deadlines are cleared and marked "Needs review", injected instructions are rejected, and superseded decisions are demoted. The follow-up email is composed from validated notes by code, not by the model.

**Why.** A false action item is worse than a missing one. Validation in code is testable and model-independent.

## ADR-006: Long meetings are chunked, cached and synthesized

Transcripts up to about 150k characters (roughly 2.5 hours) go in one request. Longer ones are split with overlap. Each part's result is cached by content hash, and a small synthesis call merges the structured parts. Re-running analysis never re-sends unchanged parts.

## ADR-007: SQLite with FTS5 for storage and search (not PostgreSQL)

**Evaluated.** PostgreSQL full-text search (and PGlite), SQLite FTS5, a vector database.

**Decision.** SQLite with FTS5 through Node's built-in `node:sqlite` in the Electron main process. No vector database.

**Why.** A local-first app should not need a database server. FTS5 with BM25 ranking is fast enough for years of meetings. Search input is reduced to quoted literal terms, so users cannot inject FTS syntax. Semantic search can be added later if keyword search proves insufficient.

## ADR-008: Email is drafted in the app and sent by the user's own mail app

**Decision.** The default is "Open in your email app" (a `mailto:` draft with recipients, subject and body), plus "Copy". A mock provider records drafts for tests and demo mode and is always labelled as not sent. Gmail and Microsoft Graph adapters sit behind an `EmailProvider` interface and need OAuth client registrations to enable.

**Why.** No SMTP setup, no stored mail passwords, and the user always reviews and presses Send themselves. The app never claims an email was sent when it only opened a draft.

## ADR-009: Access policy in the core, even though the app is single-user today

Every meeting has a tenant and an owner. Reads and writes in the desktop data layer go through the same `can(principal, meeting, permission)` policy that a future sync server would use. This keeps data boundaries correct from day one without building a server now.

## ADR-010: Screen context as selective OCR of keyframes, never video

**Decision.** When screen context is on, the app samples the meeting window every few seconds, keeps a frame only when it changes noticeably (perceptual hash), runs OCR on kept frames, stores the text with a timestamp, and discards the image. Screen text is secondary evidence and is fenced as untrusted data in prompts.

**Why.** Understanding slides and dashboards is useful; recording video is costly, risky and out of scope.

## ADR-011: Speaker labels in two passes (live, then end of meeting)

**Measured.** On a synthetic four-voice meeting, cosine similarity between WeSpeaker embeddings of the same speaker went as low as 0.743, while two different speakers reached 0.806. No single threshold separates them on short segments, and a greedy online pass with 0.5 merged four people into two.

**Decision.** Live: online clustering at 0.72 so the transcript shows reasonable labels while the meeting runs. At Stop: average-linkage clustering (Lance-Williams update) over all meeting-audio segments at 0.75, capped at 400 core segments, then the transcript is relabelled. Labels the user has already renamed are never overwritten. The microphone channel is always "You".

**Result.** Four speakers found with purity 1.0 on the sample meeting. Real multi-person calls with similar voices, background noise or crosstalk have not been measured yet.

**Trade-off.** Labels can change once when the meeting ends. The UI shows the final labels after processing, and the notes are built from them.

## ADR-012: Speech buffers are copied inside Electron

Electron's V8 build forbids external array buffers. sherpa-onnx returns audio and embeddings as external buffers by default, which fails with "External buffers are not allowed" and silently stopped live transcription. The engine calls `vad.front(false)` and `extractor.compute(stream, false)` so results are copied into normal buffers. The real-audio E2E test covers this path.

## ADR-013: Sandboxed preloads are single files

A sandboxed preload can only `require` a few built-in modules, so a shared chunk (for example `chunks/channels-*.js`) makes the preload fail and the UI never gets its bridge. Both preloads are bundled as standalone CommonJS files. The capture preload inlines its two channel names, and a unit test checks they match the shared definitions and that no preload imports a chunk. electron-vite's `isolatedEntries` would do this automatically but crashes without a TTY in 5.0.0.

## ADR-014: Recover the single-instance lock after a crash on Windows

**Found.** On Windows, when the main process is killed, its network service, GPU and renderer processes keep running for well over 15 seconds and keep the single-instance lock. A new launch then hands over to a window that no longer exists and closes, so the app seems not to open.

**Decision.** The running instance writes its process id to `instance.pid` in the data folder and removes it on a clean exit. A launch that is refused the lock on Windows checks whether that process is gone; only then does it end that process's children that run the same executable, and take the lock. It never touches a live instance or any other program, and it tries once.

**Trade-off.** A little platform-specific code (PowerShell to list child processes, only on the refused path). The alternative, asking users to end processes in Task Manager, is not acceptable for a crash recovery feature.
