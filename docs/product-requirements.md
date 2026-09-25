# Product requirements

## Who it is for

People who spend much of their week in meetings across different tools (Teams, Zoom, Google Meet, Slack) and lose track of what was decided and who owes what. They want one app that works everywhere and asks almost nothing of them.

## The experience

1. Install, open, allow microphone and meeting audio once.
2. When a meeting starts, press **Start taking notes** (or accept the suggestion when the app notices the meeting).
3. Press **Stop** when it ends.
4. A moment later: a short summary, decisions, action items with owners and due dates, open questions, risks, and a follow-up email ready to review.

Principle: complexity belongs in the engineering, simplicity in the product. No setup wizards beyond permissions, no bots joining calls, no admin approval.

## Requirements and status

Status: **Done** (built and tested), **Partial** (works with stated limits), **Not built**.

### Capture

| Requirement                                            | Status    | Notes                                                                                                               |
| ------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------- |
| Works with any meeting app, same flow for all          | Done      | Local capture; the app name is a label                                                                              |
| Microphone and meeting audio captured separately       | Done      | Windows/Linux: Chromium loopback. macOS 14.2+: AudioTee                                                             |
| Pause, resume, stop; tray/menu bar controls; shortcuts | Done      | `Ctrl/Cmd+Shift+.` stop, `Ctrl/Cmd+Shift+,` pause/resume                                                            |
| Notice when a meeting starts                           | Done      | Window-title detection; suggests only, never starts on its own                                                      |
| Tell the user plainly when audio is missing            | Done      | Per-channel meters and messages with a fix action                                                                   |
| Survive sleep and crashes                              | Done      | Pause on sleep; audio and transcript saved as they arrive; recovery on next launch (tested on all three OSes in CI) |
| Screen context (slides, shared screens)                | Not built | Designed (ADR-010), [#22](https://github.com/aasimsyed-ai/meeting-bot/issues/22)                                    |

### Transcript

| Requirement                                         | Status    | Notes                                                                     |
| --------------------------------------------------- | --------- | ------------------------------------------------------------------------- |
| On-device, live transcription                       | Done      | sherpa-onnx, Moonshine base by default; one-time model download           |
| Speaker labels; never invent names; rename speakers | Done      | "You" for the microphone, "Speaker N" for others; renaming updates owners |
| Several people on one microphone                    | Not built | [#19](https://github.com/aasimsyed-ai/meeting-bot/issues/19)              |
| Languages other than English                        | Partial   | Optional Parakeet v3 model (25 languages); notes rules are English only   |

### Notes

| Requirement                                                                       | Status  | Notes                                                                                                                                        |
| --------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| TL;DR and topics                                                                  | Done    |                                                                                                                                              |
| Decisions: confirmed, possible, discussed only                                    | Done    | A proposal is confirmed only when someone else agrees; replaced decisions are demoted                                                        |
| Action items: task, owner, deadline as said, date, priority, confidence, evidence | Done    | Dates in the meeting's time zone; ambiguous ones marked "Needs review"                                                                       |
| Open questions and risks                                                          | Done    |                                                                                                                                              |
| "Why?" for every item                                                             | Done    | Shows the transcript lines it came from                                                                                                      |
| Never invent owners, dates or items                                               | Done    | Validator drops or flags anything without evidence                                                                                           |
| Prompt injection is shown, never acted on                                         | Done    |                                                                                                                                              |
| Cloud AI for higher quality (optional)                                            | Partial | Claude integration built and unit-tested; not yet evaluated with the real API ([#17](https://github.com/aasimsyed-ai/meeting-bot/issues/17)) |

### Follow-up

| Requirement                                              | Status    | Notes                                                                                                     |
| -------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| Follow-up email: generate, review, approve, then send    | Done      | Opens a draft in the user's mail app; never sends by itself; never claims "sent" unless the user marks it |
| Warn about external recipients                           | Done      |                                                                                                           |
| Send through Gmail or Outlook directly                   | Not built | [#21](https://github.com/aasimsyed-ai/meeting-bot/issues/21)                                              |
| My Tasks: Open, In progress, Blocked, Overdue, Completed | Done      | Across all meetings; edit, reassign, add                                                                  |

### Memory

| Requirement                                                                  | Status    | Notes                                                                                                      |
| ---------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| Search across meetings                                                       | Done      | SQLite FTS5 with stemming; snippets                                                                        |
| Ask questions ("what do I owe?", "what did we decide about X?") with sources | Done      | Deterministic answers built from stored notes, each with links to the meeting                              |
| Recurring meetings: what changed since last time                             | Done      | Tasks completed, still outstanding and new; new decisions; changed deadlines; questions still open and new |
| Prepare me (brief before a meeting)                                          | Not built | [#23](https://github.com/aasimsyed-ai/meeting-bot/issues/23)                                               |
| Calendar integration                                                         | Not built | [#23](https://github.com/aasimsyed-ai/meeting-bot/issues/23)                                               |

### Trust, privacy and quality

| Requirement                                                              | Status  | Notes                                                                                |
| ------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------ |
| Local by default; clear about anything that leaves the computer          | Done    | See [security.md](security.md)                                                       |
| Retention and deletion (meeting, transcript only, everything, automatic) | Done    |                                                                                      |
| Access control and tenant isolation                                      | Done    | Enforced in the data layer; single-user app today                                    |
| Audit log without content                                                | Done    |                                                                                      |
| Accessibility: keyboard, screen readers, contrast                        | Done    | axe-core checks in E2E; keyboard-only test                                           |
| Sample meetings to explore without a real meeting                        | Done    | Acme Demo Corporation, removable                                                     |
| Installers for Windows, macOS, Linux; auto-update                        | Partial | Built in CI, unsigned ([#16](https://github.com/aasimsyed-ai/meeting-bot/issues/16)) |

## Non-goals for now

- Bots that join calls, and platform APIs for transcripts.
- Video recording.
- Team workspaces and sync between devices (the data model is ready for it).
- Mobile apps.

## Quality bar

See [test-plan.md](test-plan.md) for thresholds. A false action item is worse than a missing one: precision thresholds are higher than recall thresholds, and anything uncertain is shown as "Needs review" rather than hidden or guessed.
