import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { launch, onboard, shot, type Launched } from './app';

let l: Launched | null = null;

/**
 * Killing Electron's main process leaves its helper processes (network service, GPU) running for
 * a while on Windows, still holding the data folder. A real user relaunches seconds later; wait
 * for them the same way (tests run one at a time, so no other Electron is expected).
 */
async function leftoverProcessesGone(killedPid?: number): Promise<void> {
  if (process.platform !== 'win32') return void (await new Promise((r) => setTimeout(r, 1000)));
  let list = '';
  for (let i = 0; i < 30; i++) {
    list = execFileSync('tasklist', ['/FI', 'IMAGENAME eq electron.exe', '/NH'], {
      encoding: 'utf8',
    });
    if (!/electron\.exe/i.test(list)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  // Which helpers survive, and whose children they are.
  const detail = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process -Filter "Name=\'electron.exe\'" | ForEach-Object { "$($_.ProcessId) parent=$($_.ParentProcessId) $($_.CommandLine)" }',
    ],
    { encoding: 'utf8' },
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const type = /--type=(\S+)/.exec(line)?.[1] ?? 'browser';
      const sub = /--utility-sub-type=(\S+)/.exec(line)?.[1] ?? '';
      return `${line.split(' ').slice(0, 2).join(' ')} ${type} ${sub}`;
    });
  console.log(
    `Electron processes still running 15 s after killing ${killedPid}:\n${detail.join('\n')}`,
  );
}

test.afterEach(async () => {
  await l?.app.close().catch(() => undefined);
  l = null;
});

test('live capture uses the real microphone path and explains what is missing', async () => {
  l = await launch();
  const { win } = l;
  await onboard(win);
  await win.getByRole('button', { name: 'Zoom' }).click();
  await win.getByRole('button', { name: 'Start taking notes' }).click();
  await expect(win.locator('.live-state')).toHaveText('Taking notes');

  // Chromium's fake microphone feeds real audio through the capture window.
  const you = win.locator('.meter', { hasText: 'You' });
  await expect(you).toContainText('Listening', { timeout: 15_000 });
  // The speech engine was never downloaded: say so, and keep the audio.
  await expect(
    win.getByText('The speech engine is not downloaded yet.', { exact: false }),
  ).toBeVisible();
  // Windows/Linux: Chromium's fake devices also fake the loopback stream, so meeting audio flows.
  // macOS: meeting audio comes from AudioTee, which needs a permission CI cannot grant. Either
  // audio flows, or the meter and a notice both say plainly that it does not.
  const meetingMeter = win.locator('.meter', { hasText: 'Meeting audio' });
  if (process.platform === 'darwin') {
    await expect(async () => {
      const state = await meetingMeter.innerText();
      if (state.includes('Listening')) return;
      expect(state).toMatch(/No audio|Not available/);
      await expect(win.locator('.notice-text', { hasText: /meeting audio/i }).first()).toBeVisible({
        timeout: 1000,
      });
    }).toPass({ timeout: 20_000 });
  } else {
    await expect(meetingMeter).toContainText('Listening', { timeout: 15_000 });
  }
  await shot(win, '09-live-capture');

  await win.getByRole('button', { name: 'Pause' }).click();
  await expect(win.locator('.live-state')).toHaveText('Paused');
  await win.getByRole('button', { name: 'Resume' }).click();
  await expect(win.locator('.live-state')).toHaveText('Taking notes');
  await win.waitForTimeout(1500);
  await win.getByRole('button', { name: 'Stop', exact: true }).click();

  await expect(
    win.getByText(
      'Your meeting audio is saved. It will be transcribed as soon as the speech engine is ready.',
    ),
  ).toBeVisible();
  const audioRoot = join(l.dataDir, 'audio');
  const [meetingDir] = readdirSync(audioRoot);
  for (const channel of process.platform === 'darwin' ? ['mic'] : ['mic', 'system']) {
    const file = join(audioRoot, meetingDir!, `${channel}.pcm`);
    expect(existsSync(file)).toBe(true);
    // 16 kHz, 16-bit: more than a second of real audio was written.
    expect(statSync(file).size).toBeGreaterThan(32_000);
  }
});

test('a crash mid-meeting is detected and the notes can be recovered', async () => {
  l = await launch();
  await onboard(l.win);
  await l.win.getByRole('button', { name: /Try a sample meeting/ }).click();
  await expect(l.win.locator('.transcript-live')).toContainText('firewall', { timeout: 20_000 });
  const dataDir = l.dataDir;
  // Simulate a crash: kill the process without any shutdown. Windows terminates processes
  // asynchronously, and a second instance defers to one that is still alive, so wait for the
  // exit (and a moment for its child processes) before relaunching.
  const proc = l.app.process();
  const exited = new Promise((r) => proc.once('exit', r));
  proc.kill('SIGKILL');
  await exited;
  await leftoverProcessesGone(proc.pid);

  l = await launch({ dataDir });
  const { win } = l;
  await expect(win.getByText('was interrupted before it finished', { exact: false })).toBeVisible();
  await win.getByRole('button', { name: 'Recover notes' }).click();
  await expect(win.getByRole('heading', { name: 'TL;DR' })).toBeVisible({ timeout: 20_000 });
  await win.getByRole('tab', { name: /Transcript/ }).click();
  await expect(win.locator('.segment').first()).toContainText('Good morning everyone');
});
