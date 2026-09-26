# Project plan

## Milestones

| Milestone                       | Goal                                                                | Status                          |
| ------------------------------- | ------------------------------------------------------------------- | ------------------------------- |
| M1 Core intelligence            | Transcript to validated notes, offline and with Claude; evaluation  | DONE                            |
| M2 Desktop app                  | Capture, speech, storage, UI, email, tasks, search, memory, samples | DONE                            |
| M3 Quality and delivery         | E2E on three OSes, real speech in CI, installers, docs              | TESTING                         |
| M4 Private beta on real devices | Manual pass on Windows and macOS with real meetings; signed builds  | BLOCKED (devices, certificates) |
| M5 Public release               | Signed, notarized, auto-updating release with release notes         | BACKLOG                         |

## Definition of Ready

A backlog item is READY when it has a user-visible outcome, acceptance criteria, a priority, and no unknown dependency (or the dependency is its own item).

## Definition of Done

- Acceptance criteria met and demonstrated.
- Unit tests, and an E2E test for anything a user clicks.
- Lint, format, types, unit tests, evaluation gate and E2E green in CI on all three OSes.
- No new serious accessibility issues.
- Errors, empty and loading states handled; nothing claims success that did not happen.
- Docs updated (status, test results, and any decision in the ADRs).
- Bugs found on the way are in the bug log and GitHub issues.

## Backlog

Statuses: BACKLOG, READY, IN_PROGRESS, BLOCKED, IN_REVIEW, TESTING, FAILED, FIXING, DONE. Priorities: P0 (release blocker) to P3 (nice to have).

### Done

| ID    | Item                                                                               | Pri | Acceptance criteria (summary)                                                            |
| ----- | ---------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------- |
| MA-01 | Transcript normalization and echo removal                                          | P0  | Clean text, repaired timestamps, mic echo of meeting audio removed; unit tests           |
| MA-02 | Deadline normalization in the meeting's time zone                                  | P0  | Relative dates resolved; ambiguity flagged; 37 unit tests                                |
| MA-03 | Offline extractor and evidence validator                                           | P0  | Quality gate met on 16 transcripts; zero hallucinations on held-out set                  |
| MA-04 | Claude extractor with structured output, fallback, chunking                        | P1  | Unit-tested with a fake client; falls back to offline on any failure                     |
| MA-05 | Follow-up email, external recipient warning, mail app draft                        | P0  | Never sends by itself; external domains flagged; mock provider in tests                  |
| MA-06 | Meeting memory Q&A, search, recurring diff                                         | P1  | Answers cite meetings; FTS input sanitized; recurring changes shown                      |
| MA-07 | Access policy and tenant isolation                                                 | P1  | Permission matrix tests; no cross-tenant access even for admins                          |
| MA-08 | Local data layer with migrations and audit log                                     | P0  | Idempotent processing; user edits survive reprocessing                                   |
| MA-09 | Capture session: mic and meeting audio, health, pause, sleep                       | P0  | Real capture path works in E2E; missing audio explained                                  |
| MA-10 | On-device speech engine with verified downloads                                    | P0  | Real speech to notes in CI; tampered download rejected                                   |
| MA-11 | Speaker labels with end-of-meeting clustering                                      | P1  | Four synthetic voices separated                                                          |
| MA-12 | Crash recovery                                                                     | P0  | Killed mid-meeting, the next launch recovers the notes (Linux, macOS in CI)              |
| MA-13 | UI: Home, live view, Meetings, Meeting detail, Tasks, Search, Settings, onboarding | P0  | Full journey E2E; keyboard only; axe clean                                               |
| MA-14 | Tray, shortcuts, notifications, meeting detection                                  | P1  | Detection rules unit-tested; never starts on its own                                     |
| MA-15 | Sample meetings (Acme Demo Corporation)                                            | P1  | Load and remove; profile restored                                                        |
| MA-16 | CI on three OSes, real speech job, installers, packaged-app E2E                    | P0  | Workflows green                                                                          |
| MA-18 | Automated tests for the IPC sender check and error reduction                       | P3  | Refused senders, channels and arguments never reach a handler; errors carry no internals |
| MA-17 | Documentation set                                                                  | P1  | README and docs in this folder                                                           |

### Open

| ID    | Item                                                           | Pri | Status  | Issue                                                        |
| ----- | -------------------------------------------------------------- | --- | ------- | ------------------------------------------------------------ |
| MA-21 | Real-device validation on Windows and macOS with real meetings | P1  | BLOCKED | [#15](https://github.com/aasimsyed-ai/meeting-bot/issues/15) |
| MA-22 | Code signing and notarization                                  | P1  | BLOCKED | [#16](https://github.com/aasimsyed-ai/meeting-bot/issues/16) |
| MA-23 | Claude engine evaluated with the real API                      | P2  | BLOCKED | [#17](https://github.com/aasimsyed-ai/meeting-bot/issues/17) |
| MA-24 | Fresh held-out evaluation set                                  | P2  | READY   | [#18](https://github.com/aasimsyed-ai/meeting-bot/issues/18) |
| MA-25 | Speaker quality on real calls; in-room meetings                | P2  | BACKLOG | [#19](https://github.com/aasimsyed-ai/meeting-bot/issues/19) |
| MA-26 | Meeting audio on macOS 13 and older; Linux desktops            | P2  | BACKLOG | [#20](https://github.com/aasimsyed-ai/meeting-bot/issues/20) |
| MA-27 | Gmail and Outlook sending                                      | P2  | BACKLOG | [#21](https://github.com/aasimsyed-ai/meeting-bot/issues/21) |
| MA-28 | Screen context (OCR of slides)                                 | P2  | BACKLOG | [#22](https://github.com/aasimsyed-ai/meeting-bot/issues/22) |
| MA-29 | Calendar integration and "Prepare me"                          | P3  | BACKLOG | [#23](https://github.com/aasimsyed-ai/meeting-bot/issues/23) |
| MA-30 | Model attributions in the app; mirror models on own releases   | P2  | READY   | Release checklist                                            |
