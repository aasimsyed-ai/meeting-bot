# Test results

Latest full run: 2026-09-26 (real meeting capture validation phase), branch `claude/universal-ai-meeting-assistant-yj65ne`. Everything below was actually run; anything that was not is listed at the end.

## Summary

| Layer                                 | Result                                                                                                       | Where                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Lint, format, types                   | Pass                                                                                                         | Local and CI                       |
| Core unit tests                       | 250 passed (includes evidence and email trust checks on 29 meetings)                                         | Local and CI                       |
| Desktop unit tests                    | 103 passed, 2 skipped (speech test and transcription probe, which need models; the speech test runs in CI)   | Local; CI on Linux, Windows, macOS |
| AI quality gate (development set)     | Pass, 100% on every measure                                                                                  | Local and CI                       |
| AI held-out set                       | Pass (numbers below)                                                                                         | Local and CI                       |
| AI difficult set (new)                | 100% after fixes; blind first run lower (section below)                                                      | Local and CI                       |
| Real speech integration               | Pass (Parakeet v3)                                                                                           | Local and CI (Linux)               |
| E2E, development build                | 14/14 locally on Linux, including the five permission cases; CI runs the same on Linux, Windows, macOS       | Local (Linux) and CI               |
| Capture harness (real OS audio paths) | 3 scenarios pass locally; the two short ones run in CI on every push                                         | Local and CI (Linux)               |
| Installers                            | All three platforms built in CI; packaged app E2E in CI                                                      | CI                                 |
| Packaged app, real capture            | Linux package (unpacked) passes the harness standup, including reading the slide from inside the app archive | Local (Linux)                      |

## Capture harness

Real PulseAudio devices, a stand-in meeting app with a Teams-style title, synthetic voices; the app driven only through its UI. Details in [capture-validation.md](capture-validation.md).

| Scenario             | Result                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deployment-standup` | Pass. Decision "Move the deployment to Monday" (confirmed); Bob, firewall rule, Friday; Sarah Lee, QA, Monday; slide read; email correct. "QA" misheard in 1 of 5 repeat runs. |
| `device-changes`     | Pass. Minimized, microphone unplugged and back, headphones; all three tasks, owners and weekdays right; both slides read.                                                      |
| `team-sync-10min`    | 9.9 minutes, 108 lines. Final run: see capture-validation.md section 10. Notes ready under a second after **Stop**.                                                            |

## Transcription

| Measure                             | Moonshine base              | Parakeet v3 (default)   |
| ----------------------------------- | --------------------------- | ----------------------- |
| Word error rate, four-voice meeting | 3.5%                        | 1.9%                    |
| Transcription probe (14 items)      | 8 of 14                     | 9 of 14                 |
| Speed (4 cores, 2 threads)          | about 8x real time          | about 4.7x real time    |
| "QA" in the harness standup         | Misheard in 3 of 3 captures | Misheard in 1 of 5 runs |

Probe details (names, numbers, dates, URL, acronyms, technical terms, noise, interruption) are in [capture-validation.md](capture-validation.md#7-transcription-quality). Numbers, dates and ordinary speech come through; acronyms and uncommon names often do not ([#36](https://github.com/aasimsyed-ai/meeting-bot/issues/36)).

## Permissions (simulated denial, real app code after it)

| Case                                       | Linux (local) | CI (Linux, Windows, macOS) |
| ------------------------------------------ | ------------- | -------------------------- |
| B + E: microphone denied, then "Try again" | Pass          | Runs on every push         |
| C: screen denied                           | Pass          | Runs on every push         |
| D: meeting audio unavailable               | Pass          | Runs on every push         |
| B + D: nothing heard, never "Taking notes" | Pass          | Runs on every push         |
| F: access removed mid-meeting, recovered   | Pass          | Runs on every push         |

## AI quality (offline engine)

Thresholds are in the [test plan](test-plan.md#metrics-and-thresholds-offline-engine).

| Metric                    | Development set (16 meetings) | Held-out set, first run (5 meetings) | Held-out set, now |
| ------------------------- | ----------------------------- | ------------------------------------ | ----------------- |
| Decision precision        | 100%                          | 100%                                 | 100%              |
| Decision recall           | 100%                          | 60%                                  | 100%              |
| Action item precision     | 100%                          | 81.8%                                | 90.9%             |
| Action item recall        | 100%                          | 90%                                  | 100%              |
| Owner accuracy            | 100%                          | 100%                                 | 100%              |
| Deadline accuracy         | 100%                          | 88.9%                                | 100%              |
| Hallucinations            | 0                             | 0                                    | 0                 |
| Forbidden-item violations | 0                             | 0                                    | 0                 |

How to read this honestly:

- The development set was used to write the rules, so 100% there is expected and says little about new meetings.
- The **first held-out run** is the best estimate for unseen meetings: precise, but it missed 2 of 5 decisions and produced 2 false action items out of 11.
- The held-out set is no longer blind after the fixes it prompted ([#18](https://github.com/aasimsyed-ai/meeting-bot/issues/18)).
- Zero hallucinations and zero violations hold on every set: nothing appeared without evidence, and the prompt-injection meeting produced no action and no email to the attacker's address.
- The mock AI path reproduces the expected notes for every development meeting in CI. A small free local model (qwen2.5 3B, CPU only) was measured once and scored below the offline engine, with zero hallucinations; numbers in [ai-providers.md](ai-providers.md#local-model-results-qwen25-3b-free). Larger local models and the optional Claude engine have not been measured.

## Difficult set (discussion vs decision vs action item)

Eight meetings in `packages/core/fixtures/hard.ts`, including one real captured transcript. Expected answers written before the first run.

| Measure            | Blind first run (7 meetings) | After fixes (8 meetings) |
| ------------------ | ---------------------------- | ------------------------ |
| Decision precision | 100%                         | 100%                     |
| Decision recall    | 50%                          | 100%                     |
| Task precision     | 85.7%                        | 100%                     |
| Task recall        | 92.3%                        | 100%                     |
| Owner accuracy     | 91.7%                        | 100%                     |
| Deadline accuracy  | 80%                          | 100%                     |
| Hallucinations     | 0                            | 0                        |

The set is no longer blind after the fixes. It now guards against regressions (`test/eval-gate.test.ts`).

## Real speech

Earlier results with the previous default model (Moonshine base). Synthetic four-voice Project Phoenix meeting (about 83 seconds, 16 kHz), real models (Silero VAD, Moonshine base int8, WeSpeaker ResNet34):

| Measure                        | Result                                                                                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Speed                          | 12.6x real time on a GitHub Linux runner, 13.6x on a 4-core development container (2 threads)                                                                                           |
| Speakers                       | 3 during the meeting, 4 after the end-of-meeting pass (correct)                                                                                                                         |
| Notes                          | Confirmed decision to move the deployment to Monday; firewall task for Speaker 4 due 2026-09-24; the migration task in most runs (in one, the recognizer reduced that sentence to "5.") |
| Through the running app (E2E)  | Transcript, speakers and notes appear; about 30 seconds end to end                                                                                                                      |
| Robustness, 6 random syntheses | 5 of 6 fully correct; the other has "firewall" heard as "fire while" (recognition error)                                                                                                |

The synthetic audio is clean. Real calls will have more recognition errors ([#19](https://github.com/aasimsyed-ai/meeting-bot/issues/19)).

## Performance of analysis

Offline engine on generated meetings (development container):

| Meeting                | Segments | Characters | Time  |
| ---------------------- | -------- | ---------- | ----- |
| 5 minutes, 6 people    | 38       | 2,117      | 6 ms  |
| 30 minutes, 10 people  | 158      | 13,432     | 12 ms |
| 60 minutes, 10 people  | 326      | 29,276     | 20 ms |
| 120 minutes, 50 people | 654      | 60,171     | 40 ms |

The generated transcripts are lighter than real speech (a real 2-hour meeting is closer to 100,000 characters), so real timings will be somewhat higher, still well under a second. Speech recognition, not analysis, is the heavy part, and it runs while the meeting happens.

## End to end (Playwright driving the real Electron app)

| Test                                                                          | Linux                | macOS                                                  | Windows |
| ----------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------ | ------- |
| First-time user: onboarding, sample meeting, notes, tasks, email, search, ask | Pass                 | Pass                                                   | Pass    |
| Delete a meeting, then everything                                             | Pass                 | Pass                                                   | Pass    |
| Live capture through the real microphone path                                 | Pass                 | Pass (meeting audio correctly reported as unavailable) | Pass    |
| Crash mid-meeting, then recover                                               | Pass                 | Pass                                                   | Pass    |
| Sample tour: recurring changes, my tasks, external email, speaker names       | Pass                 | Pass                                                   | Pass    |
| Prompt injection shown as a warning, never acted on                           | Pass                 | Pass                                                   | Pass    |
| Accessibility (axe, main screens)                                             | Pass                 | Pass                                                   | Pass    |
| Keyboard only                                                                 | Pass                 | Pass                                                   | Pass    |
| Real meeting audio through the app                                            | Pass (CI speech job) | Not run                                                | Not run |
| Permission cases B to F                                                       | Pass                 | CI                                                     | CI      |
| Capture harness (real OS audio and window paths)                              | Pass (CI and local)  | Not run                                                | Not run |

## Bugs found by testing

Twenty-four bugs are recorded in the [bug log](bug-log.md), each with an issue. In this phase the capture harness found five that fake devices and unit tests had missed (almost silent meeting audio, clipped words, unread slides, a dropped reply, misheard acronyms), the audit found the false "Taking notes" and the missing recovery, and the difficult set and the ten-minute meeting found the notes mistakes.

## NOT TESTED

Each needs something this project does not have yet. Status for all: **NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL**.

- Real Windows and Mac laptops with real Teams, Zoom, Google Meet and Slack calls ([#15](https://github.com/aasimsyed-ai/meeting-bot/issues/15)).
- macOS system audio with the permission granted (CI runners cannot grant it).
- Signed and notarized installers; auto-update between two releases ([#16](https://github.com/aasimsyed-ai/meeting-bot/issues/16)). Release-stage task.
- The optional Claude engine against the real API ([#17](https://github.com/aasimsyed-ai/meeting-bot/issues/17)): NOT TESTED — REQUIRES PROVIDER CREDENTIALS. Not needed for the MVP.
- Larger local models (7B and up) on the evaluation sets: not run yet. A 3B model has been measured.
- Opening the email draft in real mail apps (Outlook, Apple Mail, Gmail in a browser).
- Long real meetings (60 to 120 minutes) on a low-end laptop.
- Real people's voices, accents, crosstalk, and laptop speakers echoing into the microphone.
- Windows and macOS device changes, Bluetooth headsets, laptop sleep on real hardware.
- Screen reading on Windows and macOS, and on a Linux Wayland session.
- Real OS permission prompts (the permission cases were simulated).
