import { expect, test } from '@playwright/test';
import { axe, launch, nav, shot, type Launched } from './app';

let l: Launched;
test.afterEach(async () => {
  await l?.app.close().catch(() => undefined);
});

async function start() {
  l = await launch();
  await l.win.getByRole('button', { name: 'Explore with sample meetings' }).click();
  await expect(
    l.win.getByText('You are looking at sample meetings from Acme Demo Corporation.', {
      exact: false,
    }),
  ).toBeVisible({ timeout: 30_000 });
  return l.win;
}

test('sample tour: meetings, recurring changes, my tasks, external email, speaker names', async () => {
  const win = await start();
  await expect(win.getByRole('heading', { name: /Alice/ })).toBeVisible();

  await nav(win, 'Meetings').click();
  await expect(win.locator('.list-item')).toHaveCount(16);
  await expect(win.locator('.list-item .badge-accent').first()).toHaveText('Sample');
  await shot(win, '10-meetings');

  // Recurring meeting: what changed since last time.
  await win.locator('.list-item', { hasText: 'Platform Sync' }).first().click();
  const changes = win.locator('section[aria-labelledby="changes"]');
  await expect(changes).toContainText('Deadlines that changed');
  await expect(changes).toContainText(/credential/i);
  await expect(changes).toContainText('New decisions');
  await expect(changes).toContainText(/cold storage/i);
  await shot(win, '11-recurring');

  // My tasks belong to the demo user.
  await nav(win, 'Tasks').click();
  await expect(win.locator('tbody input[aria-label="Task"]').first()).toHaveValue(/venue|legal/i);

  // External attendee warning in the client meeting email.
  await nav(win, 'Meetings').click();
  await win.locator('.list-item', { hasText: 'Globex Pilot Kickoff' }).click();
  await expect(win.getByText('External recipients')).toBeVisible();
  await win.getByRole('button', { name: 'Review email' }).click();
  await expect(
    win
      .getByRole('dialog')
      .getByText(/External recipients detected: eva\.brown@globex\.example\.test/),
  ).toBeVisible();
  await win.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  // No-names meeting: owners stay as speaker labels until a person names them.
  await nav(win, 'Meetings').click();
  await win.locator('.list-item', { hasText: 'Weekly Operations Call' }).click();
  const owners = win.locator('section[aria-labelledby="actions"] input[aria-label="Owner"]');
  await expect(owners.first()).toHaveValue(/^Speaker \d$/);
  await win.getByRole('tab', { name: /Transcript/ }).click();
  await win.getByRole('button', { name: /^Speaker 3/ }).click();
  await win.getByLabel('Name for Speaker 3').fill('Priya');
  await win.getByRole('button', { name: 'Save' }).click();
  await expect(win.getByRole('button', { name: /Speaker 3 → Priya/ })).toBeVisible();
  await win.getByRole('tab', { name: 'Summary' }).click();
  await expect(owners.first()).toHaveValue('Priya', { timeout: 15_000 });
});

test('prompt injection in a meeting is shown as a warning and never acted on', async () => {
  const win = await start();
  await nav(win, 'Meetings').click();
  await win.locator('.list-item', { hasText: 'Infrastructure Sync' }).click();
  await expect(
    win.getByText('Some of what was said looked like instructions to an AI.', { exact: false }),
  ).toBeVisible();
  const summary = win.locator('main');
  await expect(summary).not.toContainText('attacker@example.com');
  await expect(
    win.locator('section[aria-labelledby="actions"] input[aria-label="Task"]'),
  ).toHaveCount(2);
});

test('main screens have no serious accessibility problems', async () => {
  const win = await start();
  const check = async (name: string) => {
    const bad = (await axe(win)).filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${name}: ${v.id} (${v.nodes}) ${v.help}`)).toEqual([]);
  };
  await check('home');
  await nav(win, 'Meetings').click();
  await check('meetings');
  await win.locator('.list-item', { hasText: 'Project Phoenix Weekly' }).click();
  await expect(win.getByRole('heading', { name: 'TL;DR' })).toBeVisible();
  await check('meeting');
  await nav(win, 'Tasks').click();
  await check('tasks');
  await nav(win, 'Search').click();
  await check('search');
  await nav(win, 'Settings').click();
  await check('settings');
});

test('keyboard only: reach and start taking notes', async () => {
  const win = await start();
  await nav(win, 'Home').focus();
  for (let i = 0; i < 25; i++) {
    await win.keyboard.press('Tab');
    const label = await win.evaluate(() => document.activeElement?.textContent ?? '');
    if (/Start taking notes/.test(label)) break;
  }
  await win.keyboard.press('Enter');
  await expect(win.locator('.live-state')).toHaveText('Taking notes');
  await win.keyboard.press('Control+Shift+.');
});
