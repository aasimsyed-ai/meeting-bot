# Security and privacy

Meeting audio and notes are sensitive. The design goal is simple: everything stays on the user's computer unless they choose otherwise, the app never acts on its own behalf (no auto-send, no hidden recording), and nothing the AI or a meeting participant says can make the app do something.

## Data on disk

| What                                                      | Where (inside the app's data folder) | Protection                                                                  |
| --------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| Meetings, notes, tasks, search index, settings, audit log | `meetings.db` (SQLite)               | File mode 0600 (owner only)                                                 |
| Raw audio while processing                                | `audio/<meeting>/{mic,system}.pcm`   | File mode 0600; deleted after processing by default                         |
| Speech models                                             | `models/`                            | SHA-256 verified before install                                             |
| Logs                                                      | `logs/`                              | File mode 0600; never contain transcript text, email bodies, keys or tokens |
| Claude API key (optional)                                 | Settings, encrypted                  | OS keychain via Electron `safeStorage`; memory only if unavailable          |

The data folder is Electron's per-user `userData` folder. Development and test builds use separate folders so they never touch a real installation.

Data is not encrypted at rest beyond the OS account's own protection (for example FileVault or BitLocker). Full database encryption is a possible later addition (see the risk register).

## What leaves the computer

- **Nothing by default.** Speech recognition and the offline notes engine run on the device.
- **Model downloads**, once, from the sherpa-onnx GitHub releases (verified by hash).
- **Local AI server (optional).** Talks only to the address the user sets, normally a model running on the same computer.
- **Cloud AI (optional, off by default, never required).** Only when the user adds their own Claude API key and chooses Claude: the cleaned transcript and meeting title go to the Anthropic API for that meeting's notes. The Settings screen says this plainly.
- **Email** is never sent by the app. It opens a draft in the user's own mail app (or copies the text). The user presses Send there.
- **Update checks** against GitHub releases in packaged builds (30 seconds after start, then every 6 hours).

## Retention and deletion

- Raw audio is deleted after the notes are made (setting, on by default).
- Optional automatic deletion of meetings older than N days (off by default).
- Delete one meeting, delete only its transcript (keeps notes, clears quotes), or delete everything. Deletion removes search index rows and audio files, and is recorded in the audit log without content.

## Application hardening (Electron)

- Renderer windows: `contextIsolation`, `sandbox`, no Node integration, `webSecurity` on, strict Content Security Policy (`default-src 'self'`, no remote scripts, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`).
- Navigation is blocked; new windows are denied (https links open in the default browser); `<webview>` is blocked.
- Media permission is granted only to the app's own windows; every other permission request is refused.
- IPC: one invoke channel (`main/ipc-handler.ts`); the sender must be the main window; every argument is validated with a zod schema (sizes, formats, allowed values); errors are reduced to safe messages before reaching the UI. Unit tests cover each of these.
- Preloads expose a minimal bridge (`invoke`, `onEvent`, `platform`), not Node or Electron APIs.
- The hidden capture window has no UI and can only send audio frames and capture events.

## AI safety

- **Prompt injection.** Transcript and screen text are data, never instructions. Text that looks like instructions to an AI ("ignore previous instructions", "email this to ...") is flagged, shown to the user as a warning, and never becomes a task, decision or email recipient. Prompts fence the transcript and escape delimiter characters.
- **Hallucination guard.** Every item must cite transcript segments. Owners must be a named participant or speaker label that appears in the evidence; deadlines must appear in the evidence text. Anything unsupported is dropped or marked "Needs review".
- **No actions from model output.** The model returns structured data only. It cannot send email, delete data, change settings or call tools.
- **Names are never invented.** Unknown speakers stay "Speaker N" until the user names them.

## Access control

Every meeting has a tenant and an owner. The data layer checks a shared policy (`packages/core/src/access.ts`) on every read and write: owner, admin, organizer, attendee, external attendee, or no access, and never across tenants. The desktop app is single-user today; the policy exists so a future sync server has correct boundaries from day one. Tests: `core/test/security.test.ts`, `desktop/test/repo.test.ts`.

## Search

User input is reduced to quoted, stemmed literal terms before reaching SQLite FTS5, so search syntax cannot be injected. Snippets are rendered as text, never HTML.

## Consent and platform rules

- The app shows clearly when it is taking notes (tray icon, live view, a "taking notes" state) and never records in the background without the user starting it.
- Meeting detection only suggests (a notification asking whether to take notes); it never starts capture on its own.
- The app uses only OS-approved capture paths and asks for permission through the OS. It does not bypass permissions.
- The user is responsible for telling participants they are taking notes, as local law or company policy may require. The last onboarding step says so.

## Supply chain

- Dependencies are pinned in `pnpm-lock.yaml`; installs use `--frozen-lockfile`. Only `electron` and `esbuild` may run install scripts.
- CI runs `pnpm audit --prod --audit-level high` on every push (no known issues at the time of writing).
- Dependabot opens weekly update PRs for npm packages and GitHub Actions.
- Model files are pinned by SHA-256.

## Known gaps

| Gap                                             | Tracking                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Installers are unsigned (development builds)    | Release stage: [release-prerequisites.md](release-prerequisites.md) |
| No database encryption beyond the OS account    | Risk register                                                       |
| No external security review or penetration test | Required before a public release                                    |

## Reporting a problem

Please open a private security advisory on the GitHub repository rather than a public issue.
