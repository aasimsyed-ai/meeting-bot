// A stand-in meeting app for the capture harness. It is an ordinary desktop window
// with a meeting-style title that shows slides and plays the remote people's voices
// through the normal system speakers, so Meeting Assistant has to capture it the same
// way it captures a real Teams, Zoom, Meet or Slack call.
//
//   electron tests/capture/fake-meeting/main.cjs <scenario.json> <audio-dir> <go-file>
//
// It waits until <go-file> exists (the "meeting starts"), plays the meeting, then
// closes its window a moment after the last line (the "meeting ends").
// Voices: meeting.wav to the default speaker; mic.wav to the output device whose name
// contains FAKE_MEETING_MIC_SINK (a virtual cable into the virtual microphone).
const { app, BrowserWindow, Menu } = require('electron');
const { existsSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const [scenarioPath, audioDir, goFile] = process.argv.slice(-3).map((p) => resolve(p));
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const timeline = JSON.parse(readFileSync(join(audioDir, 'timeline.json'), 'utf8'));
const keepOpen = process.env.FAKE_MEETING_KEEP_OPEN === '1';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.platform === 'linux') app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    title: scenario.windowTitle,
    backgroundColor: '#1b1b28',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Keep the meeting-style title, whatever the page does.
  win.on('page-title-updated', (e) => e.preventDefault());
  await win.loadFile(join(__dirname, 'index.html'));
  const data = {
    slides: scenario.slides ?? [],
    lines: timeline.lines,
    people: [...new Set(scenario.lines.map((l) => l.speaker))],
    meeting: pathToFileURL(join(audioDir, 'meeting.wav')).href,
    mic: pathToFileURL(join(audioDir, 'mic.wav')).href,
    micIdle: pathToFileURL(join(audioDir, 'mic-idle.wav')).href,
    micSink: process.env.FAKE_MEETING_MIC_SINK || '',
  };
  const micOk = await win.webContents.executeJavaScript(`window.setup(${JSON.stringify(data)})`);
  console.log(`FAKE_MEETING_READY mic=${micOk ? 'virtual' : 'none'}`);
  while (!existsSync(goFile)) await new Promise((r) => setTimeout(r, 200));
  console.log('FAKE_MEETING_STARTED');
  await win.webContents.executeJavaScript('window.play()');
  console.log('FAKE_MEETING_FINISHED');
  if (!keepOpen) {
    await new Promise((r) => setTimeout(r, 1500));
    win.destroy();
    console.log('FAKE_MEETING_WINDOW_CLOSED');
  }
});
app.on('window-all-closed', () => {
  // Stay alive (like a real meeting app in the background) until the harness ends it.
});
