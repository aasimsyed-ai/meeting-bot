# Release prerequisites (production only)

Development is free-first: everything needed to build, test and use the product end to end runs locally with open-source tools, local models, mock providers and synthetic test data. The items below are needed **only for a public release** and are deliberately not required now. None of them blocks development; each has a local or mock stand-in today.

## Paid services policy

No paid API key or service is added during development without explicit approval. Before proposing one, the project states what it is, why it is needed, whether a free, open-source or local alternative exists, the estimated cost, and whether it is needed for the MVP or only for production.

| Capability                           | Today (free)                                                     | Production option                                                                                       | Cost (approximate, check current pricing)                               | Needed for              |
| ------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------- |
| Meeting notes AI                     | Offline engine; local model server (Ollama etc.); mock for tests | Optional Claude with the user's own key                                                                 | Pay per use, borne by that user                                         | Nothing requires it     |
| Speech to text                       | On-device sherpa-onnx models                                     | Same                                                                                                    | Free                                                                    | MVP and production      |
| Follow-up email                      | Opens a draft in the user's own mail app; mock provider in tests | Gmail and Outlook sending ([#21](https://github.com/aasimsyed-ai/meeting-bot/issues/21))                | Free, but OAuth app registration and Google's review for the send scope | Production nice-to-have |
| Calendar                             | Manual participants                                              | Google or Microsoft calendar read access ([#23](https://github.com/aasimsyed-ai/meeting-bot/issues/23)) | Free, OAuth registration                                                | Later                   |
| Code signing, Windows                | Unsigned development installers                                  | See below                                                                                               | About $10/month (cloud signing) or $200–600/year (certificate)          | Public release          |
| Code signing and notarization, macOS | Unsigned development builds                                      | See below                                                                                               | $99/year (Apple Developer Program)                                      | Public release          |
| Update hosting                       | GitHub releases                                                  | Same                                                                                                    | Free                                                                    | Production              |

## Code signing (release-stage task)

Installers built today are **unsigned development builds**. They work, but Windows SmartScreen warns on install, macOS Gatekeeper blocks the first launch until the user allows it, and macOS auto-update does not work for unsigned apps. The project never fakes signing and never describes a build as signed when it is not. Tracked in [#16](https://github.com/aasimsyed-ai/meeting-bot/issues/16).

### macOS

| Requirement                              | Detail                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple Developer Program membership       | Individual or organization (an organization needs a D-U-N-S number, which is free). $99 per year.                                                                                                                                                                             |
| **Developer ID Application** certificate | For apps distributed outside the Mac App Store. Exported as a `.p12` file with a password.                                                                                                                                                                                    |
| Notarization credentials                 | Either an Apple ID with an app-specific password and the Team ID, or an App Store Connect API key (issuer ID, key ID, `.p8` file).                                                                                                                                            |
| Already prepared in the repo             | Hardened runtime and entitlements (`apps/desktop/build/entitlements.mac.plist`), usage descriptions for microphone, audio capture and screen, `release.yml` passing signing variables to electron-builder. The bundled AudioTee helper must be signed with the same identity. |

Secrets `release.yml` reads when they exist: `MAC_CERTIFICATE_P12_BASE64`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.

### Windows

| Requirement                                                                          | Detail                                                                                                                                                            |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An Authenticode code signing identity                                                | Since June 2023, publicly trusted code signing keys must live in hardware or a cloud HSM, so a new certificate can no longer be exported as a plain `.pfx` file.  |
| Option A: Microsoft cloud signing (Azure Artifact Signing, formerly Trusted Signing) | About $10 per month. Identity validation required; availability depends on region and account type. electron-builder supports it through `win.azureSignOptions`.  |
| Option B: OV or EV certificate from a certificate authority with cloud signing       | For example DigiCert KeyLocker, SSL.com eSigner or Sectigo. Roughly $200–600 per year, sometimes plus signing fees. Needs a custom sign step in electron-builder. |
| SmartScreen reputation                                                               | Builds up over time and downloads for either option; no certificate type gives instant trust.                                                                     |

`release.yml` currently has a `.pfx` path (`WIN_CERTIFICATE_P12_BASE64`, `WIN_CERTIFICATE_PASSWORD`) that suits only older exportable certificates. When a signing option is chosen, the Windows step will be adapted to it.

### Linux

No signing is required for AppImage or `.deb`. A GPG key is only needed if the project later runs its own package repository.

### Checklist when signing is set up

1. Add the secrets above for the chosen options.
2. Tag a release; check the draft release's installers are signed (`codesign --verify --deep --strict` and `spctl -a -vv` on macOS, `signtool verify /pa` on Windows).
3. Install on real Windows and Mac machines; check first-run permission prompts.
4. Publish two consecutive versions and check auto-update from one to the next.

Until then, status for all of the above: **NOT TESTED — REQUIRES REAL ACCOUNT/DEVICE/CREDENTIAL.**
