# Platform support

"Tested in CI" means GitHub-hosted runners with Chromium's fake microphone and synthetic audio. It is real code on the real OS, but not a real meeting on a real laptop. Anything marked **NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL** needs a person with that device or account; see [#15](https://github.com/aasimsyed-ai/meeting-bot/issues/15).

## Operating systems

| OS                                 | Status      | Microphone              | Meeting audio                                                                                                              | Tested                                                                                                                                                                              |
| ---------------------------------- | ----------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11 (x64)                | First class | Chromium `getUserMedia` | WASAPI loopback through Chromium (no driver needed)                                                                        | Unit + E2E on `windows-latest`. Real hardware: NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL                                                                                 |
| macOS 14.2+ (Apple silicon, Intel) | First class | Chromium `getUserMedia` | Core Audio taps through AudioTee; needs "Screen & System Audio Recording" permission                                       | Unit + E2E on `macos-latest` (permission cannot be granted there, so the "no meeting audio" path is what runs). Real hardware: NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL |
| macOS 12 to 14.1                   | Limited     | Yes                     | Not available; the app says so and uses the microphone only ([#20](https://github.com/aasimsyed-ai/meeting-bot/issues/20)) | Not tested                                                                                                                                                                          |
| Linux x64 (PulseAudio or PipeWire) | Best effort | Chromium `getUserMedia` | Chromium PulseAudio loopback (`PulseaudioLoopbackForScreenShare`)                                                          | Unit + E2E + real speech in CI and in development. Real desktop sessions: not tested                                                                                                |

Speech runs on the CPU. Measured with Moonshine base on a 4-core Linux container: about 11 to 13 times faster than real time, so a laptop keeps up comfortably during a meeting.

## Meeting apps

Notes come from what the computer hears, so every meeting app works the same way. The app name only sets a label and helps detection.

| App                        | Detection (window title)  | Capture | Real meeting tested                                  |
| -------------------------- | ------------------------- | ------- | ---------------------------------------------------- |
| Microsoft Teams            | Yes                       | Yes     | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL |
| Zoom                       | Yes                       | Yes     | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL |
| Google Meet (in a browser) | Yes (browser tab title)   | Yes     | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL |
| Slack huddles              | Yes                       | Yes     | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL |
| Anything else              | "Capture current meeting" | Yes     | Tested with synthetic audio only                     |

Detection reads window titles, which apps change from time to time. When detection misses a meeting, **Start taking notes** still works. Detection rules and their tests are in `apps/desktop/src/main/detection-rules.ts` and `test/misc.test.ts`.

## Known platform behavior

- **Headphones vs speakers.** With speakers, the microphone also hears the meeting. The app removes those echoed lines when both channels have the same text; very noisy rooms may still produce duplicates.
- **In-room meetings.** Everyone on one laptop microphone is labelled "You" ([#19](https://github.com/aasimsyed-ai/meeting-bot/issues/19)).
- **Sleep.** Notes pause when the computer sleeps, and the app offers to resume on wake.
- **Crash.** Audio and transcript are saved as they arrive; the next launch offers to recover the meeting. Tested by killing the main process on Linux, macOS and Windows CI runners.
- **Unsigned builds.** Development installers are unsigned, so Windows SmartScreen and macOS Gatekeeper warn. Signing is a release-stage task ([release-prerequisites.md](release-prerequisites.md)).
