# Real meeting capture validation

The question this page answers: can a normal user open the app, join a real Teams, Zoom, Google Meet or Slack huddle meeting, click **Start taking notes**, and reliably get a useful transcript and summary?

Short answer today: the whole path works on synthetic meetings, but **nobody has tried it on a real meeting on a real laptop yet**. Everything below separates what was run from what was not.

## 1. Audit (2026-09-26, before this phase's changes)

How each part was checked: by reading the code and by what the automated tests actually exercise. "CI" means GitHub-hosted runners, which have no real microphone, speakers, meeting apps or granted macOS permissions.

### Working (exercised by automated tests)

| Part                       | Evidence                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Start, pause, resume, stop | E2E on Linux, Windows and macOS runners                                                                              |
| Microphone capture path    | Hidden capture window, `getUserMedia`, AudioWorklet at 16 kHz; E2E with Chromium's fake microphone on all three OSes |
| Speech to text             | sherpa-onnx (Moonshine) with speaker clustering; real models on synthetic speech in the CI speech job                |
| Meeting processing         | Normalize, extract (offline engine), validate, email; unit tests, evaluation sets, E2E                               |
| Evidence ("Why?")          | Every decision and task cites transcript lines; the button jumps to and highlights them (journey E2E)                |
| Email review               | Draft built from validated notes only; external-recipient warning; mock provider in tests; never sends by itself     |
| Crash recovery             | Killing the main process mid-meeting, then recovering, on all three OSes                                             |
| AI provider layer          | Offline default, mock, local model server, optional Claude; fallback to offline                                      |

### Partially working

| Part                         | What is missing                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meeting audio, Windows/Linux | Code uses Chromium loopback. In CI, Chromium's fake devices replace the loopback stream, so the real OS loopback path has never run in a test.     |
| Meeting audio, macOS 14.2+   | AudioTee code path exists; CI cannot grant the permission, so only the "not available" message has been seen.                                      |
| Meeting detection            | Window-title rules are unit-tested; the live window listing is turned off in test mode and never ran in a test.                                    |
| Permissions                  | Status and settings links exist. A denied microphone shows a notice, but there is no way to retry a failed source without stopping the meeting.    |
| Device changes               | The capture window reports device changes, but nothing listens. An unplugged microphone shows a notice and stays dead for the rest of the meeting. |
| Sleep                        | Notes pause on sleep and offer to resume (unit-tested); never tried on a real laptop lid.                                                          |

### Mocked in tests

- The microphone and loopback streams in CI (Chromium fake devices).
- The real-speech E2E feeds a WAV file straight into the capture session, skipping the OS audio path.
- The sample meeting (clearly labelled in the app).
- Email sending (mock provider; the product itself only opens a draft in the user's mail app).
- The mock AI provider.

### Not built, or broken

| Item                                  | State                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screen context                        | **Not built.** A hidden setting (off), a counter, a database table and pipeline support exist, but nothing captures or reads the screen. No UI shows it. |
| "Taking notes" while nothing is heard | **Bug.** The live screen says "Taking notes" even when both audio sources have failed.                                                                   |
| Screen status on the live screen      | Missing.                                                                                                                                                 |
| Noticing that the meeting ended       | Missing: nothing tells the user when the meeting window closes while notes are still running.                                                            |

### Requires real OS or device testing

Everything with a real Teams, Zoom, Meet or Slack call; the macOS permission prompts; Windows WASAPI loopback on real hardware; Bluetooth headsets; laptop sleep; long meetings on a low-end laptop. Status for all: **NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE**.
