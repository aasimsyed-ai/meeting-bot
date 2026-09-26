# Platform support

"Tested in CI" means GitHub-hosted runners with Chromium's fake microphone and synthetic audio. It is real code on the real OS, but not a real meeting on a real laptop. "Capture harness" means Linux with real PulseAudio devices and a stand-in meeting app (see [capture-validation.md](capture-validation.md)); it exercises the OS audio and window paths that fake devices skip. Anything marked **NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL** needs a person with that device or account; see [#15](https://github.com/aasimsyed-ai/meeting-bot/issues/15).

## Operating systems

| OS                                 | Status      | Microphone              | Meeting audio                                                                                                              | Tested                                                                                                                                                                              |
| ---------------------------------- | ----------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11 (x64)                | First class | Chromium `getUserMedia` | WASAPI loopback through Chromium (no driver needed)                                                                        | Unit + E2E on `windows-latest`. Real hardware: NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL                                                                                 |
| macOS 14.2+ (Apple silicon, Intel) | First class | Chromium `getUserMedia` | Core Audio taps through AudioTee; needs "Screen & System Audio Recording" permission                                       | Unit + E2E on `macos-latest` (permission cannot be granted there, so the "no meeting audio" path is what runs). Real hardware: NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL |
| macOS 12 to 14.1                   | Limited     | Yes                     | Not available; the app says so and uses the microphone only ([#20](https://github.com/aasimsyed-ai/meeting-bot/issues/20)) | Not tested                                                                                                                                                                          |
| Linux x64 (PulseAudio or PipeWire) | Best effort | Chromium `getUserMedia` | Chromium PulseAudio loopback (`PulseaudioLoopbackForScreenShare`)                                                          | Unit + E2E + real speech + capture harness (real PulseAudio devices, device changes) in CI. Real desktop sessions with real meeting apps: not tested                                |

Speech runs on the CPU. On a 4-core Linux machine with 2 threads: Parakeet v3 (the default) about 4.7 times faster than real time, Moonshine base about 8 times. A ten-minute harness meeting was transcribed live with notes ready under a second after **Stop**. Low-end laptops: not measured.

Screen reading (slides) uses Electron's window capture, which the OS permission governs: Screen Recording on macOS; on Windows no permission is needed; on Linux it needs X11 (a Wayland session asks through the desktop portal, not tested).

## Meeting apps

Notes come from what the computer hears, so every meeting app works the same way. The app name only sets a label and helps detection.

| App                        | Detection (window title) | Capture                    | Real meeting tested                                  |
| -------------------------- | ------------------------ | -------------------------- | ---------------------------------------------------- |
| Microsoft Teams            | Yes                      | Yes (same path as any app) | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE            |
| Zoom                       | Yes                      | Yes (same path as any app) | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE            |
| Google Meet (in a browser) | Yes (browser tab title)  | Yes (same path as any app) | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE            |
| Slack huddles              | Yes                      | Yes (same path as any app) | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE            |
| Anything else              | "Start taking notes"     | Yes                        | Stand-in meeting app on Linux (capture harness) only |

No meeting app's API is used, and none is needed for the basic flow. The capture harness's stand-in uses a Teams-style window title; its audio and window paths are the same for every app. The full test matrix is in [capture-validation.md](capture-validation.md#2-real-capture-test-matrix).

Detection reads window titles, which apps change from time to time. When detection misses a meeting, **Start taking notes** still works. Detection rules and their tests are in `apps/desktop/src/main/detection-rules.ts` and `test/misc.test.ts`.

## Known platform behavior

- **Headphones vs speakers.** With speakers, the microphone also hears the meeting. The app removes those echoed lines when both channels have the same text; very noisy rooms may still produce duplicates.
- **In-room meetings.** Everyone on one laptop microphone is labelled "You" ([#19](https://github.com/aasimsyed-ai/meeting-bot/issues/19)).
- **Device changes.** When a microphone is unplugged, the OS moves recording to another input and notes carry on; when it comes back, recording moves back (tested on Linux with PulseAudio). Speakers switching to headphones: meeting audio kept flowing (Linux). A source that stops is retried automatically, and **Try again** is offered. Windows and macOS device changes: not tested.
- **Meeting ends.** When the meeting window has been gone for 15 seconds, the app suggests stopping. It never stops by itself.
- **Sleep.** Notes pause when the computer sleeps, and the app offers to resume on wake.
- **Crash.** Audio and transcript are saved as they arrive; the next launch offers to recover the meeting. Tested by killing the main process on Linux, macOS and Windows CI runners.
- **Unsigned builds.** Development installers are unsigned, so Windows SmartScreen and macOS Gatekeeper warn. Signing is a release-stage task ([release-prerequisites.md](release-prerequisites.md)).
