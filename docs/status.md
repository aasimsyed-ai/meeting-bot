# Status

Last updated: 2026-09-25.

## In one paragraph

Meeting Assistant is a **working beta**. On a computer, the whole flow works: start taking notes, capture the microphone and the meeting's audio, transcribe on the device with speaker labels, stop, and get validated notes, tasks and a follow-up email draft; then search, ask questions, and see what changed in recurring meetings. It is tested on Linux, Windows and macOS in CI, including real speech recognition and the packaged app. It is **not ready for public release**: nobody has used it on a real Teams, Zoom, Meet or Slack call on a real Windows or Mac laptop yet, the installers are unsigned, and the Claude engine has not been measured against the real API.

## Release readiness

| Gate                                           | State                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Core flow works end to end                     | Yes (E2E on three OSes, real speech on Linux)                                                                       |
| Notes quality meets the bar on unseen meetings | Partly: precise, but the first held-out run missed 40% of decisions; zero hallucinations                            |
| No open P0 bugs                                | Yes                                                                                                                 |
| No open P1 bugs                                | One being fixed: reopening right after a crash on Windows (below)                                                   |
| Real-device validation                         | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL ([#15](https://github.com/aasimsyed-ai/meeting-bot/issues/15)) |
| Signed installers and auto-update              | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL ([#16](https://github.com/aasimsyed-ai/meeting-bot/issues/16)) |
| Security review                                | Internal review and tests done; no external review                                                                  |
| Documentation                                  | Done                                                                                                                |

**Verdict:** ready for a private beta with people willing to install an unsigned build and report back. Not ready for a public release.

## What works (verified)

- Capture from the microphone and meeting audio (Windows and Linux loopback in CI; macOS path reports honestly when permission is missing).
- On-device transcription with speaker labels; real models in CI at about 12x real time.
- Notes with evidence, confirmed vs possible decisions, owners and dates, "Needs review" for anything unclear.
- Follow-up email review with external-recipient warning; opens in the user's mail app; never sends by itself.
- My Tasks, search, questions across meetings, recurring "what changed".
- Crash recovery on Linux and macOS; sleep handling; retention and deletion.
- Prompt-injection defense, access checks, hardened Electron windows, log redaction.
- Installers built for all three platforms; the packaged app passes the E2E suite on Linux and macOS in CI (and locally on Linux, including real audio).

## In progress

- **Windows: reopening the app right after a crash.** When the main process is killed, its helper processes keep running and hold the single-instance lock, so reopening silently did nothing. A fix is in (the new launch ends helpers left by a dead instance, never a live one), and CI is verifying it on Windows.

## Known limitations

See [platform support](platform-support.md) and the open issues. The main ones:

- Not validated on real hardware and real meeting apps.
- Unsigned installers.
- macOS 13 and older: microphone only.
- Everyone on one microphone is "You".
- Offline notes engine is English only and conservative.
- No calendar, no direct Gmail or Outlook sending, no screen reading yet.

## Next steps

1. Finish the Windows crash relaunch fix.
2. Run the manual real-device checklist on Windows and macOS with each meeting app ([#15](https://github.com/aasimsyed-ai/meeting-bot/issues/15)).
3. Get signing certificates and publish a signed beta ([#16](https://github.com/aasimsyed-ai/meeting-bot/issues/16)).
4. Add an Anthropic API key secret and run the Claude evaluation ([#17](https://github.com/aasimsyed-ai/meeting-bot/issues/17)).
5. Build a fresh held-out set from consented real meetings ([#18](https://github.com/aasimsyed-ai/meeting-bot/issues/18)).
