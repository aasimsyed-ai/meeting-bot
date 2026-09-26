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
| No open P1 bugs                                | Yes                                                                                                                 |
| Real-device validation                         | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL ([#15](https://github.com/aasimsyed-ai/meeting-bot/issues/15)) |
| Signed installers and auto-update              | Release-stage task; development builds are unsigned ([#16](https://github.com/aasimsyed-ai/meeting-bot/issues/16))  |
| Security review                                | Internal review and tests done; no external review                                                                  |
| Documentation                                  | Done                                                                                                                |

**Verdict:** ready for a private beta with people willing to install an unsigned build and report back. Not ready for a public release.

## What works (verified)

- Capture from the microphone and meeting audio (Windows and Linux loopback in CI; macOS path reports honestly when permission is missing).
- On-device transcription with speaker labels; real models in CI at about 12x real time.
- Notes with evidence, confirmed vs possible decisions, owners and dates, "Needs review" for anything unclear.
- Follow-up email review with external-recipient warning; opens in the user's mail app; never sends by itself.
- My Tasks, search, questions across meetings, recurring "what changed".
- Crash recovery on Linux, macOS and Windows; sleep handling; retention and deletion.
- Prompt-injection defense, access checks, hardened Electron windows, log redaction.
- Installers built for all three platforms; the packaged app passes the E2E suite on all three platforms in CI (and locally on Linux, including real audio).

## Development is free-first

No paid key, service or certificate is needed to build, test or use the product. The default notes engine is offline; a free local model server is supported; tests use a deterministic mock AI. Production-only items (code signing, optional cloud AI, direct email sending) are release prerequisites, listed with costs in [release-prerequisites.md](release-prerequisites.md). Signing happens at release time.

## Known limitations

See [platform support](platform-support.md) and the open issues. The main ones:

- Not validated on real hardware and real meeting apps.
- Unsigned installers.
- macOS 13 and older: microphone only.
- Everyone on one microphone is "You".
- Offline notes engine is English only and conservative.
- No calendar, no direct Gmail or Outlook sending, no screen reading yet.

## Next steps

1. Run the manual real-device checklist on Windows and macOS with each meeting app ([#15](https://github.com/aasimsyed-ai/meeting-bot/issues/15)).
2. Measure a larger free local model (7B) on the evaluation sets; the 3B model scored below the offline engine ([ai-providers.md](ai-providers.md#local-model-results-qwen25-3b-free)).
3. Build a fresh held-out set from consented real meetings ([#18](https://github.com/aasimsyed-ai/meeting-bot/issues/18)).
