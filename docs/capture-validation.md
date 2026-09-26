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

The audit's gaps were worked on in this phase; what changed is below. The audit above is kept as it was, for the record.

## 2. Real capture test matrix

"Harness" means the capture harness (section 5): a stand-in meeting app on Linux with real PulseAudio devices, not a real meeting app. Nothing here was run on a real meeting.

| Platform | OS      | Screen                                    | Mic                                       | System audio                              | Transcript                                | Status                                        |
| -------- | ------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| Teams    | Windows | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | Not tested                                    |
| Teams    | macOS   | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | Not tested                                    |
| Zoom     | Windows | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | Not tested                                    |
| Zoom     | macOS   | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | Not tested                                    |
| Meet     | Windows | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | Not tested                                    |
| Meet     | macOS   | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | Not tested                                    |
| Slack    | Windows | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | Not tested                                    |
| Slack    | macOS   | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE | Not tested                                    |
| Harness  | Linux   | Works (window capture, slide text read)   | Works (PulseAudio virtual microphone)     | Works (Chromium loopback of PulseAudio)   | Works (Parakeet v3)                       | Tested, synthetic voices, in CI on every push |

What would carry over to a real meeting: the app does not use any meeting app's API. It hears what the computer plays and what the microphone picks up, and reads the meeting window's text, so a Teams, Zoom, Meet or Slack meeting goes through the same code as the harness. What cannot be known without real devices: how each app's window titles look today (detection), how Windows WASAPI loopback and macOS AudioTee behave on real hardware, Bluetooth headsets, echo from laptop speakers into the microphone, and real people's voices.

Detection works from window titles for Teams, Zoom, Meet (browser tab title) and Slack huddles. It only suggests; **Start taking notes** works without it.

## 3. Permissions (cases A to F)

CI machines cannot change real OS permissions. For cases B to F, the app's capture page is told in test mode to act as if access was refused, which gives it the same `NotAllowedError` a real denial gives; everything after that is the real app. `apps/desktop/e2e/permissions.spec.ts` runs on Linux, Windows and macOS in CI.

| Case                        | Expected                           | Result (simulated denial)                                                                                                          | Real OS prompt                            |
| --------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| A. All granted              | Capture works                      | Works (capture harness, Linux, real devices)                                                                                       | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE |
| B. Microphone denied        | Clear explanation and instructions | "Microphone access is off, so your own voice is not being captured." with **Open microphone settings** and **Try again**           | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE |
| C. Screen denied            | Clear explanation and instructions | Screen tile says "Needs permission"; notice explains audio notes are not affected, with **Open screen settings**                   | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE |
| D. System audio unavailable | Explanation and a recovery path    | "Meeting audio could not be captured..." with **Try again**; notes continue from the microphone and say so                         | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE |
| B and D together            | Never claim to be taking notes     | Live screen and sidebar say **Not hearing anything**, with a warning that nothing is being written down                            | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE |
| E. Granted after denial     | Retry works without reinstalling   | After allowing, **Try again** brings the microphone back mid-meeting                                                               | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE |
| F. Revoked during use       | Detected                           | Streams stopped silently: after about 4 seconds the app says **Not hearing anything**; when access returns, **Try again** recovers | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE |

macOS note: after granting Screen Recording, macOS usually asks the user to quit and reopen the app; that cannot be avoided and is not tested.

## 4. Capture recovery

| Situation                                                                 | How it was tested                                       | Result                                                                                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| App window minimized                                                      | Harness, Linux, real devices                            | Capture continues; transcript complete                                                                                                                |
| Microphone unplugged                                                      | Harness: virtual headset microphone removed mid-meeting | The OS moved recording to the built-in microphone; capture continued ("Taking notes" stayed true). What was said into the unplugged headset was lost. |
| Microphone plugged back in                                                | Harness: virtual headset microphone added back          | The OS moved recording back; the user's next lines were transcribed                                                                                   |
| Headphones connected                                                      | Harness: new default speaker, meeting audio moved to it | Loopback followed the new output; remote voices kept being transcribed                                                                                |
| Source ends or goes silent                                                | Unit tests and permission E2E                           | Notice within about 4 seconds, automatic retries (1 s, 3 s, 10 s, 30 s, then every minute), and on any audio device change                            |
| Meeting window closes                                                     | Harness                                                 | After 15 seconds: "The meeting window has closed..." with **Stop**. It never stops by itself.                                                         |
| Application crash                                                         | E2E on Linux, Windows, macOS (kill the main process)    | Next launch offers to recover the meeting; audio and transcript up to the crash are kept                                                              |
| Laptop sleep                                                              | Unit test                                               | Notes pause and offer to resume. Real laptop lid: NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE                                                           |
| Network disappears                                                        | By design                                               | Capture, transcription, notes and email drafting use no network. Only the first model download and optional cloud AI need it. Not separately tested.  |
| Transcription temporarily fails                                           | Unit test                                               | Audio keeps being saved and is transcribed after the meeting; the live screen says so                                                                 |
| Bluetooth headsets, meeting-app window changes (pop-outs, renamed titles) | —                                                       | NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE                                                                                                             |

The live screen shows: the state (**Taking notes**, **Paused**, **Not hearing anything**, **Starting…**), meeting name, elapsed time, **Pause**, **Stop**, a level and state for your microphone and for meeting audio, and the screen-reading state. The same state is in the sidebar on every page and in the tray. It only says **Taking notes** while audio is actually arriving.

## 5. Capture harness

`tests/capture/` (see its README): scenarios with expected results, a synthesizer (free sherpa-onnx text to speech), a stand-in meeting app, PulseAudio virtual devices and a runner. The app is driven exactly as a user would drive it; the only shortcut is copying the speech models instead of downloading them. It runs in CI (Linux) on every push.

| Scenario             | What it checks                                                                                 | Result                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `deployment-standup` | The four-line Alice/Bob/Sarah dialogue from the brief; a slide; notes, owners, weekdays, email | Passes. "QA" is misheard in about one run in five; task, owner and date stay right. |
| `device-changes`     | About a minute: minimized, microphone unplugged and back, headphones                           | Passes (details in section 4)                                                       |
| `team-sync-10min`    | A ten-minute weekly sync run as a normal user, see section 10                                  | See section 10                                                                      |

Bugs the harness found (all fixed, see the bug log): meeting audio almost silent because of Chromium's default voice processing on the loopback; first and last words clipped at speech boundaries; a slide with the same layout never read, and slides next to live video never read; the user's reply dropped as an "echo" of the question; misheard acronyms with the previous default speech model.

## 6. Screen context

While notes are taken, the app looks at the meeting window every 3 seconds (a small picture). When part of it changes and then holds still, it reads the text with tesseract.js on this computer and saves only the text. Parts that never hold still, like webcam tiles, are ignored. Pictures are never saved and it is never video. Text is shown on the meeting's Transcript tab under **On screen** and given to model engines as secondary context; the offline engine does not turn screen text into tasks or decisions.

Tested: unit tests (keyframe rule, video next to a slide, duplicate slides, no window, no permission, paused) and the harness (real window capture and reading on Linux; slides such as "Deployment Date: Monday / Owner: Bob" read exactly). Reading takes about half a second per slide. The packaged Linux app passes the same harness check, so the reader works from inside the app archive; it adds about 32 MB to the installed app. Windows and macOS window capture: NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE.

## 7. Transcription quality

Measured with `apps/desktop/test/asr-probe.integration.test.ts` (synthetic voices, each item transcribed by both free on-device models) and the harness.

| Kind             | Moonshine base (smaller) | Parakeet v3 (default) | Notes                                                                          |
| ---------------- | ------------------------ | --------------------- | ------------------------------------------------------------------------------ |
| Common names     | 1 of 2                   | 0 of 2                | Both missed "Okafor" and "Lindqvist"; Parakeet heard "Priya" as "Freya"        |
| Numbers          | 2 of 2                   | 2 of 2                | "$42,500", "3.2 to 1.8"                                                        |
| Dates            | 2 of 2                   | 2 of 2                | "October 12th", "the third of November"                                        |
| Spoken URL       | 1 of 1                   | 1 of 1                | "acme dot com slash help" came out as "acme.com help"                          |
| Acronyms         | 0 of 2                   | 0 of 2                | API, CI, KPI, MVP missed by both (the synthetic voice may say them oddly)      |
| Technical terms  | 0 of 2                   | 1 of 2                | Parakeet: "TLS certificates on the Kubernetes cluster"; both missed "Postgres" |
| Background noise | 2 of 2                   | 2 of 2                | Moderate noise                                                                 |
| Interruption     | 0 of 1                   | 1 of 1                | Someone talking over the start of a line                                       |
| **Total**        | **8 of 14**              | **9 of 14**           |                                                                                |

Four-voice synthetic meeting (258 words): word error rate 3.5% (Moonshine) and 1.9% (Parakeet). The default changed to Parakeet v3 because it kept the notes right in cases where Moonshine did not ("QA", "firewall"). Not tested: accents (all voices are American English), real people, overlapping crosstalk, far-field room microphones.

What matters more than word accuracy is whether the notes stay right: in the harness scenarios, tasks, owners and dates were right even when a word was misheard, and the user can edit any task.

## 8. Meeting intelligence

A new difficult set (`packages/core/fixtures/hard.ts`, 8 meetings including one real captured transcript) covers suggestions versus decisions, "maybe", "we should", "let's", "I can", "someone should", sarcasm, small talk, cancelled, reassigned and tentative tasks, ambiguous owners, relative and conflicting dates, and a changed requirement.

| Measure            | Blind first run (7 meetings) | After fixes (8 meetings) |
| ------------------ | ---------------------------- | ------------------------ |
| Decision precision | 100%                         | 100%                     |
| Decision recall    | 50%                          | 100%                     |
| Task precision     | 85.7%                        | 100%                     |
| Task recall        | 92.3%                        | 100%                     |
| Owner accuracy     | 91.7%                        | 100%                     |
| Deadline accuracy  | 80%                          | 100%                     |
| Hallucinations     | 0                            | 0                        |

After the fixes the set is no longer blind; a test keeps it from regressing. The development and held-out sets did not change.

## 9. Evidence and email

- Every decision and task cites transcript lines; the timestamp is the first cited line, the "Why?" quote is those lines, owners are people who spoke in or were named in them, and deadlines appear in them. Checked on all 29 fixture meetings (`packages/core/test/trust.test.ts`).
- "Why?" opens the Transcript tab at the highlighted line: journey E2E (decisions) and the harness (tasks, real capture).
- The follow-up email lists exactly the confirmed decisions and the tasks with the same owners and dates, names nobody who was not in the meeting, and contains no date that is not a task deadline. Checked on all 29 fixture meetings. Recipients are the meeting's participants minus the sender; external addresses are flagged.
- Email review warns when someone is still "Speaker 2", with a pointer to naming them.
- Email is never sent by the app: it opens a draft in the user's mail app (tests use a local outbox).

## 10. A ten-minute meeting, run as a normal user

Scenario `team-sync-10min`: Alice and Bob remote, Charlie (the user) on the microphone, 108 spoken lines over 9.9 minutes, five slides. It contains one decision, three tasks for two owners, one deadline, one unresolved question and one changed requirement, surrounded by ordinary talk: status updates, numbers, an idea nobody adopts, a question answered on the spot, a debate deferred to next week, and small talk. The app was driven only through its UI: onboarding, the "meeting detected" card, **Take notes**, the "meeting window has closed" notice, **Stop**, naming the two remote voices, reviewing the email. Synthetic voices, Linux, real PulseAudio devices.

| Question                                  | First run                                                                                                                                  | After fixes (final run)                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Was capture obvious?                      | Yes: red "Taking notes", timer, three status tiles, live transcript                                                                        | Same                                                                                                   |
| Were permissions understandable?          | Not exercised: Linux grants microphone and loopback without prompts (see section 3 for the simulated cases)                                | Same                                                                                                   |
| Did audio work?                           | Yes, both sources for the whole meeting                                                                                                    | Same                                                                                                   |
| Did transcription work?                   | Yes, 108 lines, kept up live; notes ready under a second after **Stop**                                                                    | Same                                                                                                   |
| Were speakers understandable?             | Mostly: Alice, Bob and "You" separated (37, 40 and 30 lines); one or two stray lines got extra labels                                      | Same (clustering, not changed)                                                                         |
| Was the summary useful?                   | Partly: "Topics: Quick status round and Dark, page, mode", a false decision                                                                | Readable topics; still lists small talk ("Coffee") as a topic                                          |
| Were decisions correct?                   | 1 of 1 found, plus a false one ("not read too much into them")                                                                             | 2 confirmed: the design system and the dark mode requirement change; the colour idea stays "discussed" |
| Were tasks correct?                       | 3 of 3                                                                                                                                     | 3 of 3                                                                                                 |
| Were owners correct?                      | Yes, after naming the two voices (Bob, Bob, Charlie)                                                                                       | Same                                                                                                   |
| Was the deadline correct?                 | Yes, Thursday                                                                                                                              | Same                                                                                                   |
| Was the open question right?              | No: lost, and "Who owns it now?" plus an already-answered question instead                                                                 | "Who approves the new text on the pricing page?", plus its risk                                        |
| Was the changed requirement captured?     | Only as a word in a topic title                                                                                                            | "Requirement change: dark mode in the first release"                                                   |
| Was the email useful?                     | Yes, accurate; carried the false decision                                                                                                  | Accurate; nothing invented; nothing sent                                                               |
| Could a non-technical user understand it? | Mostly. Two things needed a technical guess: naming "Speaker 1/2" (the option was only on the Transcript tab) and the speech download step | A notice on the summary now leads to naming voices; the download is the main onboarding button         |

The final run's exact output is in `.harness/results/team-sync-10min.json` when the harness is run; the first run's problems are now regression tests (`packages/core/fixtures/captured.ts`, `test/rules.test.ts`).

## 11. UX review

Walking through the app as a first-time user, the primary flow is: open, onboarding (name, permissions, one-time speech download), **Start taking notes** (or **Take notes** on the "meeting detected" card), live screen, **Stop**, summary, **Review email**. No technical concept is needed to finish it, with two exceptions that were improved:

1. Remote people arrive as "Speaker 1", "Speaker 2". Naming them was only possible on the Transcript tab. Now a notice on the summary says how many voices are unnamed and has a **Name them** button; email review warns if a draft still says "Speaker 2".
2. The speech download step made "Later" the main button, so people could skip it and get no live transcript. "Download now" is now the main button.

Fixed along the way: the red **Stop** button became unreadable on hover (white text on a pale background).

Still to improve (not done, to keep this phase focused): small talk can become a topic in the summary; voices that speak only once or twice may get their own "Speaker N" label; open questions keep the speaker's wording, which can be long.
