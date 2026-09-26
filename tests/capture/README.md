# Capture harness

A repeatable stand-in for a real meeting, so capture can be tested many times without joining a Teams, Zoom, Meet or Slack call. Everything is free and local.

What it simulates:

| Real meeting                                    | Harness                                                                                      |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A meeting app window ("... \| Microsoft Teams") | `fake-meeting/`: an ordinary window with a meeting-style title, participant tiles and slides |
| Other people talking                            | Synthesized voices, played by the fake meeting through the system speaker                    |
| You talking                                     | Your synthesized voice, played into a virtual microphone                                     |
| Shared slides changing                          | Slides shown at set moments in the dialogue                                                  |
| The meeting ending                              | The fake meeting closes its window after the last line                                       |

The app under test is not told any of this. It captures through the same paths it uses in a real meeting: window titles for detection, Chromium loopback of the system speaker for meeting audio, `getUserMedia` for the microphone, and still pictures of the meeting window for slides. No fake devices and no injected audio.

## Files

| Path               | What it is                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `scenarios/*.json` | The dialogue (who, which channel, what), slides, and the expected decisions, tasks, owners, weekdays and slide text |
| `synth.mjs`        | Turns a scenario into `meeting.wav`, `mic.wav`, `mic-idle.wav` and `timeline.json` (sherpa-onnx text to speech)     |
| `fake-meeting/`    | The stand-in meeting app (Electron)                                                                                 |
| `pulse-setup.sh`   | Virtual speaker (`meeting_out`) and virtual microphone (`virtual_mic`, fed by `mic_feed`) on PulseAudio             |
| `run.sh`           | Sets everything up and runs `apps/desktop/e2e/harness.spec.ts`                                                      |

## Running it (Linux)

Needs PulseAudio (or PipeWire's pulse server), Xvfb, a window manager (`openbox`) and a compositor (`xcompmgr`), so apps can see each other's windows the way they can on Windows and macOS:

```bash
sudo apt-get install -y pulseaudio pulseaudio-utils xvfb openbox xcompmgr
# Speech models (the app's own verified downloader) and the free TTS voice model:
node --experimental-strip-types apps/desktop/scripts/fetch-models.mts .models
curl -sSL https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-libritts_r-medium.tar.bz2 | tar xj -C .models
tests/capture/run.sh .models deployment-standup
```

Results (transcript, slide text, decisions, tasks with owners and weekdays, the email draft) are written to `.harness/results/<scenario>.json`. The E2E drives the app exactly as a user would: onboarding, the "meeting detected" card, **Take notes**, the "meeting window has closed" notice, **Stop**, naming speakers, reviewing the email. The only shortcut is that speech models are copied in instead of downloaded.

## Limits

- Linux only for now. Windows and macOS need their own virtual audio devices (for example VB-CABLE or BlackHole) and are not automated.
- Synthetic voices are cleaner and more regular than people. Passing here is necessary, not sufficient: real meetings still need testing on real devices.
- Voices always come from separate channels (headphones). The speakers-and-microphone echo case is not simulated yet.
