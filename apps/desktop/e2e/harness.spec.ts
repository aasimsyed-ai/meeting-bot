import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installModels, launch, onboard, shot, type Launched } from './app';
import { loadScenario, openFakeMeeting, weekdayOf, type FakeMeeting } from './harness';

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

/** Findings written next to the synthesized audio, for docs/test-results.md. */
function record(id: string, findings: Record<string, unknown>) {
  const dir = join(audioRoot!, 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(findings, null, 2));
}

async function renameSpeakerOf(win: Page, phrase: RegExp, name: string) {
  const seg = win.locator('.segment', { hasText: phrase }).first();
  const label = (await seg.locator('.who').innerText()).trim();
  if (label === name) return label;
  await win
    .locator('section[aria-labelledby="speakers"] .chip', { hasText: label })
    .first()
    .click();
  await win.getByLabel(`Name for ${label}`).fill(name);
  await win.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(win.getByText('Speaker renamed', { exact: false }).first()).toBeVisible();
  return label;
}

test('deployment standup: real capture to notes, owners, dates, slides and email', async () => {
  test.setTimeout(300_000);
  const sc = loadScenario('deployment-standup');
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
  const findings: Record<string, unknown> = { scenario: sc.id };

  // 1. Open the app and set it up as a new user.
  await onboard(win, sc.user.name, sc.user.email);

  // 2. Join the meeting: the meeting window opens; the app notices it.
  meeting = await openFakeMeeting(sc.id, audioRoot!);
  const card = win.locator('.card', { hasText: 'Microsoft Teams meeting detected' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  findings.detected = await card.innerText();
  await card.getByRole('button', { name: 'Take notes' }).click();

  // 3. Taking notes: obvious state, both audio sources, and the screen.
  await expect(win.locator('.live-title')).toHaveValue('Project Phoenix standup');
  const you = win.locator('.meter', { hasText: 'You' });
  const other = win.locator('.meter', { hasText: 'Meeting audio' });
  await expect(you).toContainText('Listening', { timeout: 15_000 });
  await expect(win.locator('.live-state')).toHaveText('Taking notes', { timeout: 15_000 });
  meeting.start();
  await expect(other).toContainText('Listening', { timeout: 15_000 });
  await expect(win.locator('.meter', { hasText: 'Screen' })).toContainText(/Reading slides/, {
    timeout: 15_000,
  });
  // Words appear live as people speak (exact wording is checked in the notes below).
  await expect(win.locator('.transcript-live')).toContainText(/friday/i, { timeout: 60_000 });
  await shot(win, '10-harness-live');
  await meeting.finished;
  await expect(win.locator('.meter', { hasText: 'Screen' })).toContainText(/\(\d+ saved\)/, {
    timeout: 15_000,
  });

  // 4. The meeting ends: its window closes and the app suggests stopping.
  await meeting.windowClosed;
  const ended = win.locator('.notice', { hasText: 'The meeting window has closed' });
  await expect(ended).toBeVisible({ timeout: 40_000 });
  await ended.getByRole('button', { name: 'Stop' }).click();

  // 5. Notes arrive.
  await expect(win.getByRole('heading', { name: 'TL;DR' })).toBeVisible({ timeout: 120_000 });

  // 6. Transcript: who said what. Remote voices are numbered until named.
  await win.getByRole('tab', { name: /Transcript/ }).click();
  const transcript = await win.locator('.segment').allInnerTexts();
  findings.transcript = transcript;
  await expect(win.locator('section[aria-labelledby="on-screen"]')).toContainText(
    'Deployment Date: Monday',
  );
  findings.screen = await win.locator('section[aria-labelledby="on-screen"]').innerText();
  findings.renamed = {
    Bob: await renameSpeakerOf(win, /firewall/i, 'Bob'),
    Alice: await renameSpeakerOf(win, /move the deployment/i, 'Alice'),
  };
  await shot(win, '11-harness-transcript');

  // 7. Summary: decisions, tasks, owners, dates.
  await win.getByRole('tab', { name: 'Summary' }).click();
  const decisions = win.locator('section[aria-labelledby="decisions"]');
  findings.decisions = await decisions.innerText();
  for (const d of sc.expected.decisions)
    await expect.soft(decisions).toContainText(new RegExp(d.match, 'i'));
  const rows = win.locator('section[aria-labelledby="actions"] tbody tr');
  await expect(rows.first()).toBeVisible();
  const tasks = [];
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
  await shot(win, '12-harness-notes');

  // 8. Review the follow-up email (never sent in tests).
  await win.getByRole('button', { name: 'Review email' }).click();
  const dialog = win.getByRole('dialog');
  const body = await dialog.getByLabel('Message').inputValue();
  findings.email = body;
  expect.soft(body).toMatch(/firewall/i);
  expect.soft(body).toMatch(/Bob/);
  expect.soft(body).toMatch(/\bQA\b/);
  expect.soft(body).toMatch(/Decision/i);
  expect.soft(body).toMatch(/monday/i);
  expect.soft(body).not.toMatch(/Speaker \d/);
  await dialog.getByRole('button', { name: 'Close' }).click();

  const outbox = join(l.dataDir, 'test-outbox');
  findings.sent = (() => {
    try {
      return readdirSync(outbox).length;
    } catch {
      return 0;
    }
  })();
  findings.logTail = l.logs
    .join('')
    .split('\n')
    .filter((x) => /capture_|screen_|warn|error/i.test(x))
    .slice(-40);
  record(sc.id, findings);
});
