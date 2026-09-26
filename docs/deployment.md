# Building, releasing and updating

## Build from source

Prerequisites: Node.js 22.12 or newer, pnpm 10 (`corepack enable`), and on Linux the usual Electron libraries (`libnss3`, `libgtk-3-0`, `libasound2`, `xvfb` for headless tests).

```bash
pnpm install
pnpm dev          # run the app with hot reload
pnpm build        # production bundles in apps/desktop/out
pnpm package      # installers for the current OS in apps/desktop/release/<version>/
```

`pnpm package` builds for the OS it runs on. Cross-building (for example a macOS app on Linux) is not supported; CI builds each platform on its own runner.

## What gets built

| Platform | Files                                                       | Notes                                                                                                 |
| -------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Windows  | `Meeting-Assistant-Setup-<version>.exe` (NSIS, x64)         | Per-user install, choice of folder, desktop shortcut                                                  |
| macOS    | `.dmg` and `.zip` for Apple silicon (arm64) and Intel (x64) | Hardened runtime and entitlements for microphone and audio capture. The zip is what auto-update uses. |
| Linux    | `.AppImage` and `.deb` (x64)                                | Best effort (see platform support)                                                                    |

Native pieces that must stay outside the asar archive: `sherpa-onnx-*` (speech engine) and `audiotee/bin` (macOS system audio).

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

1. **checks** (Linux): lint, format, types, unit tests, both AI evaluation sets, production dependency audit, desktop build.
2. **app** (Linux, Windows, macOS): unit tests and the Playwright E2E suite against the real Electron app.
3. **speech** (Linux): downloads the real models with the app's verified downloader, synthesizes a four-voice meeting, runs the speech integration test and the real-audio E2E.
4. **package** (Linux, Windows, macOS): unsigned installers, uploaded as workflow artifacts for 14 days.

## Releasing

1. Update `version` in `apps/desktop/package.json`.
2. Check the [release checklist](#release-checklist).
3. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
4. `.github/workflows/release.yml` builds all three platforms and uploads them to a **draft** GitHub release.
5. Review the draft, write the notes, then publish it. Auto-update only sees published releases.

## Code signing and notarization

Not set up yet: no certificates are available to the project ([#16](https://github.com/aasimsyed-ai/meeting-bot/issues/16)). Unsigned builds work, but:

- Windows SmartScreen warns on first install.
- macOS Gatekeeper blocks the app until the user allows it in System Settings, and macOS auto-update does not work for unsigned apps.

To enable, add these repository secrets. `release.yml` already passes them to electron-builder, which signs (and on macOS notarizes) when they are present.

| Secret                        | What                                                |
| ----------------------------- | --------------------------------------------------- |
| `MAC_CERTIFICATE_P12_BASE64`  | Developer ID Application certificate (.p12), base64 |
| `MAC_CERTIFICATE_PASSWORD`    | Its password                                        |
| `APPLE_ID`                    | Apple ID used for notarization                      |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID             |
| `APPLE_TEAM_ID`               | Apple developer team ID                             |
| `WIN_CERTIFICATE_P12_BASE64`  | Windows code signing certificate (.pfx), base64     |
| `WIN_CERTIFICATE_PASSWORD`    | Its password                                        |

Then verify on real machines: install, first-run permission prompts, an update from one signed version to the next. **NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL.**

## Auto-update

Packaged builds use `electron-updater` against GitHub releases: a check 30 seconds after start and every 6 hours, download in the background, install on quit. The app shows when an update is ready. Development and test builds never check. End-to-end update has not been tested yet because it needs two signed, published releases.

## Optional: Claude evaluation in CI

Add `ANTHROPIC_API_KEY` as a repository secret, then run the "AI evaluation (Claude)" workflow by hand. It calls the paid API for 21 meetings (16 development, 5 held-out) and uploads the results.

## Release checklist

- [ ] CI green on all three platforms, including the speech job
- [ ] `pnpm eval` and `eval:holdout` pass; numbers copied into `docs/test-results.md`
- [ ] No open P0 or P1 bugs
- [ ] Manual real-device pass ([test plan](test-plan.md#real-device-validation-manual)) on Windows and macOS
- [ ] Installers signed and notarized
- [ ] Model licenses confirmed and attributions shown in the app
- [ ] `docs/status.md` and README updated
- [ ] Draft release reviewed, then published
