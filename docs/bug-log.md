# Bug log

Every meaningful bug found during development, with its GitHub issue, the fix and the test that keeps it fixed. Keep this in sync with the issue tracker.

Severity: **P0** product unusable or data at risk, **P1** core feature wrong, **P2** noticeable quality or security weakness, **P3** cosmetic or minor.

| ID      | Sev | Status | Summary                                                                        | Issue                                                        | Fix              | Regression test                                                             |
| ------- | --- | ------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------- |
| BUG-001 | P2  | Fixed  | Sentence splitter broke email addresses, weakening injection checks            | [#12](https://github.com/aasimsyed-ai/meeting-bot/issues/12) | bde70a4          | `core/test/security.test.ts`, injection fixture in the evaluation           |
| BUG-002 | P3  | Fixed  | "certificate" and "certificates" did not match in search and similarity        | [#12](https://github.com/aasimsyed-ai/meeting-bot/issues/12) | bde70a4          | `core/test/transcript.test.ts`                                              |
| BUG-003 | P2  | Fixed  | Offline engine turned phrases like "let me share my screen" into tasks         | [#10](https://github.com/aasimsyed-ai/meeting-bot/issues/10) | 7453dc0          | `core/test/rules.test.ts`, held-out evaluation                              |
| BUG-004 | P2  | Fixed  | "Okay, Monday it is" read as accepting a task; adopted proposals not confirmed | [#10](https://github.com/aasimsyed-ai/meeting-bot/issues/10) | 7453dc0, a200af6 | `core/test/rules.test.ts` "regressions"                                     |
| BUG-005 | P2  | Fixed  | "Friday end of day" said on a Friday resolved to the wrong day                 | [#10](https://github.com/aasimsyed-ai/meeting-bot/issues/10) | 942d4ad          | `core/test/deadlines.test.ts`                                               |
| BUG-006 | P3  | Fixed  | Very long run-on decisions; a greeting became the first topic                  | [#10](https://github.com/aasimsyed-ai/meeting-bot/issues/10) | bf25d20, ca516e5 | `core/test/rules.test.ts`                                                   |
| BUG-007 | P3  | Fixed  | Renderer bundle was 945 KB (whole core library, not minified)                  | [#13](https://github.com/aasimsyed-ai/meeting-bot/issues/13) | bf25d20, 8772fba | Build output (about 303 KB)                                                 |
| BUG-008 | P0  | Fixed  | Blank app: sandboxed preload tried to load a shared chunk                      | [#7](https://github.com/aasimsyed-ai/meeting-bot/issues/7)   | f69cf53, 8772fba | `desktop/test/misc.test.ts` (single-file preloads, channel names in sync)   |
| BUG-009 | P1  | Fixed  | Quitting mid-meeting threw "database is not open"                              | [#9](https://github.com/aasimsyed-ai/meeting-bot/issues/9)   | b13abf8          | `desktop/test/services.test.ts` "quitting mid-meeting ... (regression)"     |
| BUG-010 | P1  | Fixed  | Four speakers were labelled as two                                             | [#8](https://github.com/aasimsyed-ai/meeting-bot/issues/8)   | ce6be21, f69cf53 | `desktop/test/speech.integration.test.ts` (CI speech job)                   |
| BUG-011 | P0  | Fixed  | Live transcription failed in Electron: "External buffers are not allowed"      | [#6](https://github.com/aasimsyed-ai/meeting-bot/issues/6)   | be4c19c          | `desktop/e2e/audio.spec.ts` (CI speech job)                                 |
| BUG-012 | P3  | Fixed  | Two Stop buttons on the live meeting screen                                    | [#11](https://github.com/aasimsyed-ai/meeting-bot/issues/11) | b2e5c8b          | E2E tests click the single exact "Stop" button                              |
| BUG-013 | P3  | Fixed  | Meeting audio that never arrived was described as "lost"; meter disagreed      | [#14](https://github.com/aasimsyed-ai/meeting-bot/issues/14) | 3f096f8          | `desktop/test/services.test.ts`, `desktop/e2e/capture.spec.ts` on macOS CI  |
| BUG-014 | P1  | Fixed  | A misheard word in real speech dropped a clearly confirmed decision            | [#24](https://github.com/aasimsyed-ai/meeting-bot/issues/24) | 6d0ff3b, 5fef934 | `core/test/rules.test.ts` "robustness to speech recognition", CI speech job |
| BUG-015 | P3  | Fixed  | Loading skeleton used aria-label on a plain div                                | [#25](https://github.com/aasimsyed-ai/meeting-bot/issues/25) | 51b82f8          | `desktop/e2e/samples.spec.ts` accessibility check                           |

## Notes

- BUG-001 to BUG-010 were found and fixed before the first push, so their fixes live in the commits that introduced the code. The issues were filed afterwards to keep a record.
- BUG-004's second half (a proposal adopted by someone else with "let's go with that" stayed "possible") was found while writing its regression test and fixed in a200af6.
- BUG-003 to BUG-006 came from the first run of the held-out evaluation set. After fixing them, that set is no longer blind; see [#18](https://github.com/aasimsyed-ai/meeting-bot/issues/18).
- BUG-008, BUG-011, BUG-013, BUG-014 and BUG-015 only appeared in the real Electron runtime, with real speech, or on a real OS runner. Unit tests under plain Node did not catch them, which is why the E2E and speech jobs exist.

## Test infrastructure issues (not product bugs)

- Downloader tests mutated the real model catalog; refactored to `downloadFiles({ files })` with test-only file lists.
- Playwright's axe wrapper cannot open pages in Electron; axe-core is injected with `evaluate` instead.
- The quit confirmation dialog blocked E2E teardown; it is skipped in test mode only.
- Windows CI: the crash test killed the process Playwright returns, which on Windows is not the app's main process, so the app never crashed and the relaunch was correctly refused. It looked like a product bug and was filed as [#26](https://github.com/aasimsyed-ai/meeting-bot/issues/26); a recovery path was built and then removed once the test killed the real main process and the relaunch worked at once (ADR-014). The test now asks Electron for the main process id.
- Synthetic test audio was different on every run (random TTS noise), so the speech job was not repeatable; noise is now near zero.
