# Open-source dependencies

What we reuse, why, and under which license. Versions are the ones locked in `pnpm-lock.yaml` at the time of writing. `pnpm licenses list --prod` prints the full list of shipped packages.

## Shipped with the app

| Package               | Version | License    | Used for                                                                   |
| --------------------- | ------- | ---------- | -------------------------------------------------------------------------- |
| electron              | 44.4.5  | MIT        | Desktop shell, Chromium audio capture, tray, `safeStorage`, `node:sqlite`  |
| sherpa-onnx-node      | 1.13.8  | Apache-2.0 | On-device voice activity detection, speech recognition, speaker embeddings |
| audiotee (macOS only) | 0.0.7   | MIT        | System audio on macOS 14.2+ through Core Audio taps                        |
| electron-updater      | 6.8.9   | MIT        | Auto-update from GitHub releases                                           |
| @anthropic-ai/sdk     | 0.128.0 | MIT        | Optional cloud AI (Claude)                                                 |
| zod                   | 4.6.5   | MIT        | IPC validation and the AI output schema                                    |
| chrono-node           | 2.10.1  | MIT        | Parsing spoken dates ("next Tuesday", "end of the month")                  |
| react, react-dom      | 19.3.0  | MIT        | User interface                                                             |
| lucide-react          | 1.48.0  | ISC        | Icons                                                                      |

Transitive production packages are MIT, ISC, Apache-2.0, BlueOak-1.0.0 (`sax`), Python-2.0 (`argparse`) and Unlicense (`fast-sha256`). All are permissive.

## Speech models (downloaded on first use, not bundled)

Models are fetched from the sherpa-onnx GitHub releases and verified against SHA-256 hashes pinned in `apps/desktop/src/main/transcription/models.ts`.

| Model                                   | License                                                            | Notes                                         |
| --------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------- |
| Silero VAD                              | MIT                                                                | Voice activity detection                      |
| Moonshine base and tiny (English, int8) | MIT (Useful Sensors, English models)                               | Default recognizer                            |
| NVIDIA Parakeet TDT 0.6B v3 (int8)      | CC-BY-4.0                                                          | Optional multilingual recognizer; attribution |
| WeSpeaker ResNet34 (VoxCeleb)           | WeSpeaker code Apache-2.0; weights trained on VoxCeleb (CC-BY-4.0) | Speaker labels                                |

Before a commercial release, confirm each model's license on its upstream page and add the attributions to the app's About screen. This is part of the release checklist.

## Development and test only (not shipped)

| Package                               | License                | Used for                                       |
| ------------------------------------- | ---------------------- | ---------------------------------------------- |
| electron-vite 5.0.0, vite 7.3.6       | MIT                    | Build                                          |
| @vitejs/plugin-react 5.2.0            | MIT                    | Build                                          |
| electron-builder 26.15.3              | MIT                    | Installers                                     |
| @playwright/test 1.63.0               | Apache-2.0             | End-to-end tests against the real Electron app |
| axe-core 4.13.0                       | MPL-2.0                | Accessibility checks, injected only in tests   |
| vitest 4.1.11                         | MIT                    | Unit tests                                     |
| typescript 6.0.3                      | Apache-2.0             | Types                                          |
| eslint 9, typescript-eslint 8.70      | MIT                    | Lint                                           |
| prettier 3.9.9                        | MIT                    | Formatting                                     |
| Piper voice `en_US-libritts_r-medium` | CC-BY-4.0 (LibriTTS-R) | Synthesizing test meetings in CI               |

## Considered and not used

| Project                    | Why not                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Tauri                      | Smaller installer, but system audio needs native code per OS that we would write and maintain.                                               |
| whisper.cpp bindings       | Good accuracy, but slower on CPU for live use and a separate package per feature. sherpa-onnx covers VAD, ASR and speaker embeddings in one. |
| transformers.js            | Too slow for live transcription on typical laptops.                                                                                          |
| PostgreSQL / PGlite        | A local app does not need a database server; SQLite FTS5 is enough (ADR-007).                                                                |
| Vector database            | Keyword search with stemming meets the current need; revisit if semantic search is required.                                                 |
| Meeting bots joining calls | Needs per-platform accounts and admin approval; visible bot in the call. Local capture works everywhere.                                     |
| Meetily (Tauri + Rust)     | Useful reference for local-first design; not reused because we chose Electron.                                                               |
