# Test plan

What we test, how, and what still needs a real person, account or device. Results live in [test-results.md](test-results.md).

## Principles

- Tests never send real email, record real meetings, touch production data or use production keys. `MEETING_ASSISTANT_ENV=test` forces the mock email provider and removes any API key.
- A test that needs something we do not have is marked **NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL**, never faked.
- Every fixed bug gets a regression test (see [bug-log.md](bug-log.md)).

## Layers

| Layer              | Where                                          | Runs                                    | What it proves                                                                                                                               |
| ------------------ | ---------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Core unit tests    | `packages/core/test`                           | Every push (CI `checks`)                | Deadlines, transcript cleanup, extraction rules, validator, Claude adapter (fake client), email, Q&A, security                               |
| AI quality gate    | `packages/core/eval`, `test/eval-gate.test.ts` | Every push                              | Precision, recall, owner and deadline accuracy on 16 transcripts; zero hallucinations on the held-out set                                    |
| Performance        | `test/eval-gate.test.ts`                       | Every push                              | Analysis of 5, 30, 60 and 120 minute meetings (6 to 50 participants) finishes in under 5 seconds                                             |
| Desktop unit tests | `apps/desktop/test`                            | Every push, on Linux, Windows and macOS | Data layer, migrations, access checks, search, capture session, crash recovery, retention, IPC validation, secrets, logging, model downloads |
| Speech integration | `apps/desktop/test/speech.integration.test.ts` | CI `speech` job (Linux)                 | Real models on synthetic four-voice audio: transcript, four speakers, correct notes                                                          |
| End to end         | `apps/desktop/e2e`                             | Every push, on Linux, Windows and macOS | The real Electron app, driven like a user                                                                                                    |
| Real audio E2E     | `apps/desktop/e2e/audio.spec.ts`               | CI `speech` job (Linux)                 | Meeting audio streamed into the running app becomes a transcript, speakers and notes                                                         |
| Installers         | CI `package` job                               | After app tests pass                    | Unsigned installers build on all three platforms                                                                                             |
| Claude evaluation  | `.github/workflows/ai-eval-claude.yml`         | Manual, needs `ANTHROPIC_API_KEY`       | Same metrics for the Claude engine. NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL                                                     |

## Test data: Acme Demo Corporation

Fictional people (Alice Johnson, Bob Smith, Charlie Davis, David Wilson, Eva Brown from Globex, Frank Miller as an unauthorized user) on `example.test` domains. Fifteen scenarios with ground truth in `packages/core/fixtures`:

| Scenario                               | What it checks                                                |
| -------------------------------------- | ------------------------------------------------------------- |
| Project Phoenix weekly                 | The standard case: decisions, owners, deadlines, risks        |
| Daily standup                          | Short updates; "I'll" commitments vs status reports           |
| Client kickoff (Globex)                | External attendee, external recipient warning                 |
| Session cache technical review         | Technical vocabulary, proposals vs decisions                  |
| Payment incident                       | Urgent tasks; "today", "tomorrow" and "end of week" deadlines |
| Dashboard showcase                     | Screen sharing talk, no real tasks                            |
| Sprint planning (ambiguous)            | Unclear owners and vague deadlines stay flagged, not guessed  |
| Vendor selection (conflicting)         | A decision replaced later in the same meeting                 |
| Budget review (poor transcript)        | ASR errors, stutters, missing apostrophes                     |
| Pentest scoping (external)             | External security vendor, recipients outside the company      |
| Infrastructure sync (prompt injection) | Spoken instructions to an AI are flagged and never acted on   |
| Platform sync week 1 and 2             | Recurring meeting: what changed since last time               |
| Q4 launch planning                     | Many speakers                                                 |
| Ops call (no names)                    | Owners stay as "Speaker N" until the user names them          |
| Leadership review (generated, long)    | Long meeting, chunking, performance                           |

Five **held-out** meetings (`fixtures/holdout.ts`) were not looked at while writing rules. Their first run is the honest measure of unseen data (see test results). They are no longer blind; a new set is tracked in [#18](https://github.com/aasimsyed-ai/meeting-bot/issues/18).

## Metrics and thresholds (offline engine)

| Metric                        | Threshold    |
| ----------------------------- | ------------ |
| Decision precision            | at least 85% |
| Action item precision         | at least 85% |
| Owner accuracy                | at least 90% |
| Deadline accuracy             | at least 85% |
| Action and decision recall    | at least 70% |
| Hallucinations and violations | 0            |

A violation is any item on a fixture's forbidden list (for example an action item from an injected instruction, or an email to `attacker@example.com`).

## Negative and security tests

- Prompt injection in speech: flagged, no action item, no email recipient (core `security.test.ts`, eval fixture, E2E `samples.spec.ts`).
- Search input cannot inject FTS syntax; every term is quoted.
- Permission matrix for owner, admin, organizer, attendee, external and unrelated users; tenant isolation even for admins.
- IPC: malformed or oversized arguments are rejected (`misc.test.ts`). Calls from any window other than the main window are rejected in `main/index.ts`; that check has no automated test yet.
- Logs never contain transcript text, email bodies, keys or tokens.
- Secrets are stored only through the OS keychain; without one they stay in memory.
- A tampered model download is rejected and nothing is installed.
- Accessibility: axe-core finds no serious or critical issues on the main screens; the app can be used with the keyboard alone.

## Real device validation (manual)

Not yet run. Tracked in [#15](https://github.com/aasimsyed-ai/meeting-bot/issues/15). Status for every row: **NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL**.

Run on Windows 11 and macOS 14.2 or newer, each with Teams, Zoom, Google Meet and a Slack huddle:

1. Fresh install from the CI installer; first-run onboarding; microphone and system audio permissions (macOS: Screen & System Audio Recording).
2. Join a meeting; the app notices it and offers to take notes; the platform label is right.
3. Take notes for 10 minutes with speakers, then with headphones. Both "You" and "Meeting audio" meters show Listening; no echo duplicates in the transcript.
4. Pause and resume; Stop; notes appear within a minute; owners and deadlines make sense.
5. Put the computer to sleep mid-meeting; on wake the app says notes were paused and offers Resume.
6. Unplug the headset mid-meeting; the app says the microphone stopped and keeps going.
7. Kill the app mid-meeting (Task Manager or Activity Monitor), reopen it within 10 seconds, recover the notes.
8. A 60-minute meeting: memory stays stable, notes are ready within a few minutes.
9. Review the follow-up email, open it in the default mail app, and check recipients and the external warning.
10. Delete the meeting and confirm its audio folder and search results are gone.

Record the OS version, hardware, app, result and any bug numbers in [test-results.md](test-results.md).

## Commands

```bash
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test                                   # core and desktop unit tests
pnpm eval                                   # development set with the quality gate
pnpm --filter @meeting-assistant/core eval:holdout
pnpm e2e                                    # builds, then runs Playwright against Electron (Linux: xvfb-run -a)
```

Real speech (optional, downloads about 280 MB of speech models plus a text-to-speech model):

```bash
cd apps/desktop
node --experimental-strip-types scripts/fetch-models.mts ~/.cache/ma-models
# a text-to-speech model is needed to synthesize the test meeting, see .github/workflows/ci.yml
node scripts/synth-meeting.mjs <tts-model-dir> /tmp/phoenix.wav
MEETING_ASSISTANT_TEST_MODELS=~/.cache/ma-models MEETING_ASSISTANT_TEST_WAV=/tmp/phoenix.wav pnpm exec vitest run test/speech.integration.test.ts
```
