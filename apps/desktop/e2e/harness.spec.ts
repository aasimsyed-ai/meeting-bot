import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installModels, launch, onboard, shot, type Launched } from './app';
import {
  loadScenario,
  openFakeMeeting,
  weekdayOf,
  type FakeMeeting,
  type Scenario,
} from './harness';

/**
 * The capture harness: a real user flow against a fake meeting app, through the real OS
 * audio and window paths (no fake devices, no injected audio):
 *   fake meeting window (meeting-style title, slides) ──► detection card, screen reading
 *   remote voices ──► system speaker ──► Chromium loopback ──► speech engine
 *   user's voice ──► virtual microphone ──► getUserMedia ──► speech engine
 * Linux only for now (PulseAudio virtual devices; see tests/capture/README.md).
 * Run with tests/capture/run.sh.
 */
const models = process.env.MEETING_ASSISTANT_TEST_MODELS;
const audioRoot = process.env.MEETING_ASSISTANT_HARNESS_AUDIO;
test.skip(
  process.env.MEETING_ASSISTANT_HARNESS !== '1' || !models || !audioRoot,
  'capture harness: run tests/capture/run.sh',
);

let l: Launched | null = null;
let meeting: FakeMeeting | null = null;
test.afterEach(async () => {
  meeting?.kill();
  await l?.app.close().catch(() => undefined);
});

type Findings = Record<string, unknown>;

/** Findings written next to the synthesized audio, for docs/test-results.md. */
function record(id: string, findings: Findings) {
  const dir = join(audioRoot!, 'results');
  mkdirSync(dir, { recursive: true });
  const repeat = test.info().repeatEachIndex;
  writeFileSync(
    join(dir, `${id}${repeat ? `-${repeat}` : ''}.json`),
    JSON.stringify(findings, null, 2),
  );
}

const pactl = (...args: string[]) => execFileSync('pactl', args, { encoding: 'utf8' }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Name each remote voice the way a user would: find one of their lines, rename its label. */
async function nameSpeakers(win: Page, sc: Scenario, findings: Findings) {
  const renamed: Record<string, string> = {};
  const problems: string[] = [];
  const remote = [
    ...new Set(sc.lines.filter((x) => x.channel === 'meeting').map((x) => x.speaker)),
  ];
  for (const person of remote) {
    let label: string | null = null;
    for (const line of sc.lines.filter((x) => x.speaker === person)) {
      const words = line.text.replace(/[^\w\s']/g, '').split(/\s+/);
      const probe = new RegExp(words.slice(1, 4).join('\\s+'), 'i');
      const seg = win.locator('.segment', { hasText: probe }).first();
      if (await seg.count()) {
        label = (await seg.locator('.who').innerText()).trim();
        break;
      }
    }
    if (!label) {
      problems.push(`no transcript line found for ${person}`);
      continue;
    }
    if (Object.values(renamed).includes(label) || remote.includes(label)) {
      problems.push(`${person} shares a speaker label with someone else (${label})`);
      continue;
    }
    renamed[person] = label;
    await win
      .locator('section[aria-labelledby="speakers"] .chip', { hasText: label })
      .first()
      .click();
    await win.getByLabel(`Name for ${label}`).fill(person);
    await win.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(win.getByText('Speaker renamed', { exact: false }).first()).toBeVisible();
  }
  findings.renamed = renamed;
  findings.speakerProblems = problems;
  expect.soft(problems, 'every remote voice has its own label').toEqual([]);
}

/** The whole user flow for one scenario. `during` runs while the meeting plays. */
async function runScenario(
  id: string,
  opts: { during?: (win: Page) => Promise<void>; shots?: boolean } = {},
): Promise<{ sc: Scenario; win: Page; findings: Findings }> {
  const sc = loadScenario(id);
  const dataDir = mkdtempSync(join(tmpdir(), 'ma-harness-'));
  installModels(dataDir, models!);
  l = await launch({
    dataDir,
    env: {
      // Real devices and real permissions: no Chromium fake devices.
      MEETING_ASSISTANT_FAKE_PERMISSIONS: '',
      MEETING_ASSISTANT_TEST_DETECTION: '1',
    },
  });
  const { win } = l;
  const findings: Findings = { scenario: sc.id };

  // 1. Open the app and set it up as a new user.
  await onboard(win, sc.user.name, sc.user.email);

  // 2. Join the meeting: the meeting window opens; the app notices it.
  meeting = await openFakeMeeting(sc.id, audioRoot!);
  const card = win.locator('.card', { hasText: 'Microsoft Teams meeting detected' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  findings.detected = await card.innerText();
  await card.getByRole('button', { name: 'Take notes' }).click();

  // 3. Taking notes: obvious state, both audio sources, and the screen.
  const you = win.locator('.meter', { hasText: 'You' });
  const other = win.locator('.meter', { hasText: 'Meeting audio' });
  await expect(you).toContainText('Listening', { timeout: 15_000 });
  await expect(win.locator('.live-state')).toHaveText('Taking notes', { timeout: 15_000 });
  meeting.start();
  await expect(other).toContainText('Listening', { timeout: 15_000 });
  await expect(win.locator('.meter', { hasText: 'Screen' })).toContainText(/Reading slides/, {
    timeout: 15_000,
  });
  if (opts.during) await opts.during(win);
  await meeting.finished;
  // The user comes back to the app (it may have been minimized during the meeting).
  await l.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Meeting Assistant');
    w?.restore();
    w?.focus();
  });
  if (opts.shots) await shot(win, '10-harness-live');

  // 4. The meeting ends: its window closes and the app suggests stopping.
  await meeting.windowClosed;
  const ended = win.locator('.notice', { hasText: 'The meeting window has closed' });
  await expect(ended).toBeVisible({ timeout: 40_000 });
  await ended.getByRole('button', { name: 'Stop' }).click();

  // 5. Notes arrive.
  await expect(win.getByRole('heading', { name: 'TL;DR' })).toBeVisible({ timeout: 120_000 });

  // 6. Transcript and slides; remote voices are numbered until the user names them.
  await win.getByRole('tab', { name: /Transcript/ }).click();
  findings.transcript = await win.locator('.card[class="card"] .segment').allInnerTexts();
  const onScreen = win.locator('section[aria-labelledby="on-screen"]');
  findings.screen = (await onScreen.count()) ? await onScreen.innerText() : null;
  for (const text of sc.expected.screen ?? []) await expect.soft(onScreen).toContainText(text);
  await nameSpeakers(win, sc, findings);
  if (opts.shots) await shot(win, '11-harness-transcript');

  // 7. Summary: decisions, tasks, owners, dates.
  await win.getByRole('tab', { name: 'Summary' }).click();
  findings.tldr = await win.locator('section', { hasText: 'TL;DR' }).first().innerText();
  const decisions = win.locator('section[aria-labelledby="decisions"]');
  findings.decisions = await decisions.innerText();
  for (const d of sc.expected.decisions) {
    await expect.soft(decisions, `decision ${d.match}`).toContainText(new RegExp(d.match, 'i'));
    if (d.status === 'confirmed')
      await expect
        .soft(decisions, `decision ${d.match} is confirmed, not "discussed"`)
        .not.toContainText(/No decisions were confirmed/);
  }
  const rows = win.locator('section[aria-labelledby="actions"] tbody tr');
  const tasks: { task: string; owner: string; due: string }[] = [];
  for (let i = 0; i < (await rows.count()); i++) {
    const r = rows.nth(i);
    tasks.push({
      task: await r.getByLabel('Task').inputValue(),
      owner: await r.getByLabel('Owner').inputValue(),
      due: await r.getByLabel('Due date').inputValue(),
    });
  }
  findings.tasks = tasks.map((t) => ({ ...t, weekday: t.due ? weekdayOf(t.due) : null }));
  const known: string[] = [];
  for (const e of sc.expected.tasks) {
    const t = tasks.find((x) => new RegExp(e.match, 'i').test(x.task));
    if (e.knownIssue) {
      // A known, logged problem: record whether it still happens, without failing the run.
      known.push(`${t ? 'FIXED?' : 'still happens'}: ${e.knownIssue}`);
      continue;
    }
    expect.soft(t, `task ${e.match}`).toBeTruthy();
    if (!t) continue;
    if (e.owner) expect.soft(t.owner, `owner of ${e.match}`).toBe(e.owner);
    if (e.weekday) expect.soft(t.due && weekdayOf(t.due), `due day of ${e.match}`).toBe(e.weekday);
  }
  findings.knownIssues = known;
  expect
    .soft(tasks.length, 'no invented tasks')
    .toBe(sc.expected.tasks.filter((e) => !e.knownIssue).length);
  if (opts.shots) await shot(win, '12-harness-notes');

  // 8. Review the follow-up email (never sent in tests).
  await win.getByRole('button', { name: 'Review email' }).click();
  const dialog = win.getByRole('dialog');
  const body = await dialog.getByLabel('Message').inputValue();
  findings.email = body;
  expect.soft(body).not.toMatch(/Speaker \d/);
  for (const e of sc.expected.tasks.filter((x) => !x.knownIssue))
    expect.soft(body, `email mentions ${e.match}`).toMatch(new RegExp(e.match, 'i'));
  if (opts.shots) await shot(win, '13-harness-email');
  await dialog.getByRole('button', { name: 'Close' }).click();
  try {
    findings.sent = readdirSync(join(l.dataDir, 'test-outbox')).length;
  } catch {
    findings.sent = 0;
  }
  findings.log = l.logs
    .join('')
    .split('\n')
    .filter((x) => /capture_|screen_|audiotee|transcriber|warn|error/i.test(x))
    .slice(-60);
  record(sc.id, findings);
  return { sc, win, findings };
}

test('deployment standup: real capture to notes, owners, dates, slides and email', async () => {
  test.setTimeout(300_000);
  const { findings } = await runScenario('deployment-standup', { shots: true });
  expect.soft(findings.sent).toBe(0);
});

test('device changes mid-meeting: minimized, microphone unplugged and back, headphones', async () => {
  test.setTimeout(300_000);
  const events: string[] = [];
  const at = Date.now();
  const note = (e: string) => events.push(`${((Date.now() - at) / 1000).toFixed(1)}s ${e}`);
  const micModule = () =>
    pactl('list', 'short', 'modules')
      .split('\n')
      .find((x) => x.includes('source_name=virtual_mic'))
      ?.split('\t')[0];
  // Which devices the app's recordings are attached to right now.
  const recordingSources = () => {
    const names = new Map(
      pactl('list', 'short', 'sources')
        .split('\n')
        .map((x) => x.split('\t'))
        .map((c) => [c[0]!, c[1]!] as const),
    );
    return (
      pactl('list', 'short', 'source-outputs')
        .split('\n')
        .filter(Boolean)
        .map((x) => names.get(x.split('\t')[1]!) ?? '?')
        .join(', ') || 'nothing'
    );
  };
  const { findings } = await runScenario('device-changes', {
    during: async (win) => {
      const t0 = Date.now();
      const until = (ms: number) => sleep(Math.max(0, ms - (Date.now() - t0)));
      await until(3_000);
      await l!.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === 'Meeting Assistant')
          ?.minimize(),
      );
      note('app window minimized');
      await until(8_000);
      pactl('unload-module', micModule()!);
      note('microphone unplugged');
      await sleep(2_500);
      // What the system did with the app's recording, and what the app shows.
      note(`app records from: ${recordingSources()}`);
      note(`headline: ${await win.locator('.live-state').innerText()}`);
      note(
        `you meter: ${(await win.locator('.meter', { hasText: 'You' }).innerText()).replace(/\n/g, ' ')}`,
      );
      const notices = await win.locator('.notice').allInnerTexts();
      note(`notices: ${notices.map((n) => n.split('\n')[0]).join(' | ') || 'none'}`);
      await until(12_000);
      pactl(
        'load-module',
        'module-remap-source',
        'master=mic_feed.monitor',
        'source_name=virtual_mic',
        'source_properties=device.description=Virtual_microphone',
      );
      pactl('set-default-source', 'virtual_mic');
      note('microphone plugged back in');
      await sleep(2_000);
      note(`app records from: ${recordingSources()}`);
      await until(19_000);
      pactl(
        'load-module',
        'module-null-sink',
        'sink_name=headphones',
        'sink_properties=device.description=Headphones',
      );
      pactl('set-default-sink', 'headphones');
      // Like the OS moving what the speakers play to newly connected headphones. (Only the
      // speakers: the virtual microphone's feed is a separate device.)
      const speakers = pactl('list', 'short', 'sinks')
        .split('\n')
        .find((x) => x.split('\t')[1] === 'meeting_out')!
        .split('\t')[0];
      for (const input of pactl('list', 'short', 'sink-inputs').split('\n').filter(Boolean))
        if (input.split('\t')[1] === speakers)
          pactl('move-sink-input', input.split('\t')[0]!, 'headphones');
      note('speakers switched to headphones');
      await sleep(3_000);
      note(`app records from: ${recordingSources()}`);
      note(
        `meeting meter: ${(await win.locator('.meter', { hasText: 'Meeting audio' }).innerText()).replace(/\n/g, ' ')}`,
      );
    },
  });
  // Put the virtual devices back for the next run.
  try {
    pactl('set-default-sink', 'meeting_out');
    const hp = pactl('list', 'short', 'modules')
      .split('\n')
      .find((x) => x.includes('sink_name=headphones'))
      ?.split('\t')[0];
    if (hp) pactl('unload-module', hp);
  } catch {
    // best effort
  }
  findings.events = events;
  record('device-changes', findings);
  // What must survive the changes: the user's words after the microphone came back, and
  // the remote voices after the switch to headphones.
  const transcript = (findings.transcript as string[]).join('\n');
  expect.soft(transcript, 'user heard again after re-plugging').toMatch(/help center/i);
  expect
    .soft(transcript, 'remote voices heard after switching to headphones')
    .toMatch(/launching on the fifteenth|fifteenth works/i);
});
