# Test results

Latest full run: 2026-09-25, branch `claude/universal-ai-meeting-assistant-yj65ne`. Everything below was actually run; anything that was not is listed at the end.

## Summary

| Layer                             | Result                                                                                | Where                              |
| --------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------- |
| Lint, format, types               | Pass                                                                                  | Local and CI                       |
| Core unit tests                   | 166 passed                                                                            | Local and CI                       |
| Desktop unit tests                | 87 passed, 1 skipped (the speech test, which needs models; it runs in the speech job) | Local; CI on Linux, Windows, macOS |
| AI quality gate (development set) | Pass (numbers below)                                                                  | Local and CI                       |
| AI held-out set                   | Pass (numbers below)                                                                  | Local and CI                       |
| Performance (analysis)            | Pass                                                                                  | Local and CI                       |
| Real speech integration           | Pass                                                                                  | Local and CI (Linux)               |
| E2E, development build            | Linux 8/8 + real audio, macOS 8/8, Windows: see below                                 | Local (Linux) and CI               |
| E2E, packaged app                 | Linux 9/9 including real audio (local), Linux and macOS 8/8 (CI), Windows: see below  | Local and CI                       |
| Installers                        | Linux AppImage (154 MB) and deb (120 MB) built locally; all three platforms in CI     | Local and CI                       |
| Dependency audit (production)     | No known vulnerabilities                                                              | Local and CI                       |

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
- The Claude engine has not been measured ([#17](https://github.com/aasimsyed-ai/meeting-bot/issues/17)).

## Real speech

Synthetic four-voice Project Phoenix meeting (about 83 seconds, 16 kHz), real models (Silero VAD, Moonshine base int8, WeSpeaker ResNet34):

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

| Test                                                                          | Linux                | macOS                                                  | Windows             |
| ----------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------ | ------------------- |
| First-time user: onboarding, sample meeting, notes, tasks, email, search, ask | Pass                 | Pass                                                   | Pass                |
| Delete a meeting, then everything                                             | Pass                 | Pass                                                   | Pass                |
| Live capture through the real microphone path                                 | Pass                 | Pass (meeting audio correctly reported as unavailable) | Pass                |
| Crash mid-meeting, then recover                                               | Pass                 | Pass                                                   | Fixing (see status) |
| Sample tour: recurring changes, my tasks, external email, speaker names       | Pass                 | Pass                                                   | Pass                |
| Prompt injection shown as a warning, never acted on                           | Pass                 | Pass                                                   | Pass                |
| Accessibility (axe, main screens)                                             | Pass                 | Pass                                                   | Pass                |
| Keyboard only                                                                 | Pass                 | Pass                                                   | Pass                |
| Real meeting audio through the app                                            | Pass (CI speech job) | Not run                                                | Not run             |

## Bugs found by testing

Fifteen bugs are recorded in the [bug log](bug-log.md), each with an issue and a regression test. Five of them (including both P0s) only showed up in the real Electron runtime, with real speech, or on a real OS runner.

## NOT TESTED

Each needs something this project does not have yet. Status for all: **NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL**.

- Real Windows and Mac laptops with real Teams, Zoom, Google Meet and Slack calls ([#15](https://github.com/aasimsyed-ai/meeting-bot/issues/15)).
- macOS system audio with the permission granted (CI runners cannot grant it).
- Signed and notarized installers; auto-update between two releases ([#16](https://github.com/aasimsyed-ai/meeting-bot/issues/16)).
- The Claude engine against the real API ([#17](https://github.com/aasimsyed-ai/meeting-bot/issues/17)).
- Opening the email draft in real mail apps (Outlook, Apple Mail, Gmail in a browser).
- Long real meetings (60 to 120 minutes) on a low-end laptop.
