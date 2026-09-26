# Status

Last updated: 2026-09-26 (real meeting capture validation phase).

## In one paragraph

Meeting Assistant is a **working beta that has never been used in a real meeting**. On a Linux machine with real audio devices and a stand-in meeting app, the whole flow now works end to end without developer shortcuts: the app notices the meeting window, **Take notes**, captures the microphone and the meeting's audio through the operating system, reads the text of shared slides, transcribes on the device, notices when the meeting window closes, and after **Stop** gives a summary, decisions, tasks with owners and dates, evidence for each item, and a follow-up email draft. A ten-minute meeting run this way gave correct decisions, tasks, owners, the deadline, the open question and the changed requirement. It is **not ready for a public release**: no real Teams, Zoom, Meet or Slack call on a real Windows or Mac laptop has been tried, the synthetic voices are cleaner than people, and installers are unsigned. See [capture-validation.md](capture-validation.md) for everything that was and was not tested.

## Release readiness

| Gate                              | State                                                                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core flow works end to end        | Yes on Linux with real audio devices and a stand-in meeting (capture harness, in CI); E2E with fake devices on Linux, Windows and macOS                                                 |
| Real meeting apps on real laptops | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE ([#15](https://github.com/aasimsyed-ai/meeting-bot/issues/15))                                                                                |
| Notes quality                     | Development, held-out and difficult sets at or near 100% after fixes; the difficult set's blind first run was weaker (decision recall 50%, deadlines 80%); no hallucinations on any set |
| Transcription                     | Good on numbers, dates and ordinary speech; bare acronyms and uncommon names often misheard ([#36](https://github.com/aasimsyed-ai/meeting-bot/issues/36))                              |
| No open P0 or P1 bugs             | Yes                                                                                                                                                                                     |
| Signed installers and auto-update | Release-stage task; development builds are unsigned ([#16](https://github.com/aasimsyed-ai/meeting-bot/issues/16))                                                                      |

**Verdict:** ready for a private beta on real meetings with people willing to report back. Not ready for a public release.

## Working (tested)

- Start, pause, resume and stop; the app says **Taking notes** only while audio really arrives, and **Not hearing anything** otherwise.
- Microphone and meeting-audio capture through the OS: Linux, real PulseAudio devices (harness); all three OSes with fake devices in CI.
- Recovery: microphone unplugged and plugged back in, headphones connected, app minimized, source lost or access removed (automatic retries and **Try again**), crash recovery, meeting window closed (suggests stopping).
- Permission cases B to F, with clear messages and settings links (simulated denial; see capture-validation.md).
- Slide reading from the meeting window, on the device, text only.
- On-device transcription (Parakeet v3 by default) with speaker separation; kept up live for ten minutes.
- Notes with evidence for every item, email review built only from validated notes, never sent by the app.

## Not tested

Real Teams, Zoom, Meet and Slack calls; real Windows and Mac laptops; macOS permission prompts and AudioTee with permission; Windows WASAPI loopback on hardware; Bluetooth headsets; laptop speakers echoing into the microphone; real people's voices and accents; long meetings on a low-end laptop. Status for all: **NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE**.

## Development is free-first

No paid key, service or certificate is needed to build, test or use the product. The default notes engine is offline; a free local model server is supported; tests use a deterministic mock AI. Production-only items (code signing, optional cloud AI, direct email sending) are release prerequisites, listed with costs in [release-prerequisites.md](release-prerequisites.md). Signing happens at release time.

## Known limitations

See [platform support](platform-support.md), [capture-validation.md](capture-validation.md) and the open issues. The main ones:

- Not validated on real hardware and real meeting apps.
- Bare acronyms and uncommon names are often misheard ([#36](https://github.com/aasimsyed-ai/meeting-bot/issues/36)).
- Remote people are "Speaker 1", "Speaker 2" until the user names them; a voice that speaks only once or twice can get its own label.
- Unsigned installers. macOS 13 and older: microphone only. Everyone on one microphone is "You".
- Offline notes engine is English only and rule-based; small talk can show up as a summary topic.
- No calendar, no direct Gmail or Outlook sending.

## Next steps

1. Run the real-device checklist: one real Teams, Zoom, Meet and Slack call each, on a Windows and a Mac laptop ([#15](https://github.com/aasimsyed-ai/meeting-bot/issues/15)), and record the results in the capture matrix.
2. Build a small held-out set from consented real meetings ([#18](https://github.com/aasimsyed-ai/meeting-bot/issues/18)), since synthetic voices and scripts are not enough.
3. Improve acronym and name recognition only after checking it with real voices ([#36](https://github.com/aasimsyed-ai/meeting-bot/issues/36)).
