import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, onboard, shot, type Launched } from './app';

let l: Launched;
test.afterEach(async () => {
  await l?.app.close().catch(() => undefined);
});

test('first-time user: onboarding -> sample meeting -> notes -> tasks -> email -> search -> ask', async () => {
  l = await launch();
  const { win } = l;
  await shot(win, '01-welcome');

  // Onboarding: explain, ask for permissions, never block.
  await win.getByRole('button', { name: 'Get started' }).click();
  await win.getByLabel('Your name').fill('Alice Johnson');
  await win.getByLabel('Work email (optional)').fill('alice.johnson@acme.example.test');
  await win.getByRole('button', { name: 'Continue' }).click();
  await expect(win.getByText('Let it hear your meetings')).toBeVisible();
  await expect(win.getByText('Allowed').first()).toBeVisible();
  await shot(win, '02-permissions');
  await win.getByRole('button', { name: 'Continue' }).click();
  await expect(win.getByRole('heading', { name: 'Download the speech engine' })).toBeVisible();
  await win.getByRole('button', { name: 'Later' }).click();
  await win.getByRole('button', { name: 'Open Meeting Assistant' }).click();

  // Home: one obvious action.
  await expect(win.getByRole('heading', { name: /Alice/ })).toBeVisible();
  await expect(win.getByRole('button', { name: 'Start taking notes' })).toBeVisible();
  await shot(win, '03-home');

  // Capture a sample meeting (no microphone needed), with a clear indicator.
  await win.getByRole('button', { name: /Try a sample meeting/ }).click();
  await expect(win.locator('.live-state')).toHaveText('Taking notes');
  await expect(win.getByText('Sample meeting: a recorded conversation')).toBeVisible();
  // The live view shows the state; other pages show a persistent indicator.
  await win.getByRole('link', { name: 'Tasks' }).click();
  await expect(win.locator('.capture-pill')).toContainText('Taking notes');
  await win.getByRole('link', { name: 'Home' }).click();
  await expect(win.locator('.transcript-live')).toContainText('firewall', { timeout: 20_000 });
  await shot(win, '04-live');
  await expect(win.locator('.transcript-live')).toContainText("that's all for today", {
    timeout: 20_000,
  });

  // Stop -> processing -> summary.
  await win.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(win.getByRole('heading', { name: 'TL;DR' })).toBeVisible({ timeout: 20_000 });
  await expect(win.locator('.capture-pill')).toHaveCount(0);
  await shot(win, '05-summary');

  // Decisions and tasks, grounded with evidence.
  const decisions = win.locator('section[aria-labelledby="decisions"]');
  await expect(decisions).toContainText(/Monday/);
  const tasks = win.locator('section[aria-labelledby="actions"]');
  await expect(tasks.locator('input[aria-label="Owner"]').first()).toHaveValue('David Wilson');
  await expect(tasks.locator('input[aria-label="Task"]').first()).toHaveValue(/firewall/i);
  await expect(win.locator('section[aria-labelledby="questions"]')).toContainText(/approval/i);

  await decisions.getByRole('button', { name: 'Why?' }).first().click();
  await expect(decisions.locator('.evidence')).toContainText('Monday it is');
  await decisions.getByRole('button', { name: 'Show in transcript' }).click();
  await expect(win.getByRole('tab', { name: /Transcript/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(win.locator('.segment.highlight')).toContainText('Monday');
  await win.getByRole('tab', { name: 'Summary' }).click();

  // Edit a task: set the migration task's due date and mark the firewall task done.
  const migration = tasks.locator('tr', { has: win.locator('input[value*="migration"]') });
  await migration.locator('input[type="date"]').fill('2026-10-02');
  await tasks.getByRole('checkbox').first().click();
  await expect(tasks.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'true');

  // Review the follow-up email: add recipients, see the external warning, "send" in test mode.
  await win.getByRole('button', { name: 'Review email' }).click();
  const dialog = win.getByRole('dialog');
  await expect(dialog.getByLabel('Subject')).toHaveValue(
    /Meeting Summary — Project Phoenix Weekly/,
  );
  await expect(
    dialog.getByText('Test mode: emails are saved to a local test outbox and never sent.'),
  ).toBeVisible();
  await dialog.getByLabel('Add recipient email').fill('bob.smith@acme.example.test');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await dialog.getByLabel('Add recipient email').fill('eva.brown@globex.example.test');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    dialog.getByText(/External recipients detected: eva\.brown@globex\.example\.test/),
  ).toBeVisible();
  await expect(dialog.getByLabel('Message')).toHaveValue(/Key Decisions[\s\S]*Action Items/);
  await shot(win, '06-email');
  await dialog.getByRole('button', { name: 'Save to test outbox' }).click();
  await expect(dialog.getByText('No email was sent.', { exact: false })).toBeVisible();
  const outbox = join(l.dataDir, 'test-outbox');
  const files = readdirSync(outbox);
  expect(files).toHaveLength(1);
  const saved = JSON.parse(readFileSync(join(outbox, files[0]!), 'utf8'));
  expect(saved.to.map((r: { email: string }) => r.email)).toEqual([
    'bob.smith@acme.example.test',
    'eva.brown@globex.example.test',
  ]);
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Tasks page reflects the edits.
  await win.getByRole('link', { name: 'Tasks' }).click();
  await win.getByRole('button', { name: 'Everyone' }).click();
  await expect(win.locator('tbody input[aria-label="Task"]').first()).toHaveValue(/migration/i);
  await expect(win.locator('tbody input[type="date"]').first()).toHaveValue('2026-10-02');
  await win.getByRole('tab', { name: 'Completed' }).click();
  await expect(win.locator('tbody input[aria-label="Task"]').first()).toHaveValue(/firewall/i);
  await shot(win, '07-tasks');

  // Search, then ask a question and open its source.
  await win.getByRole('link', { name: 'Search' }).click();
  await win.getByLabel('Search or ask a question').fill('firewall');
  await win.getByLabel('Search or ask a question').press('Enter');
  await expect(win.getByRole('heading', { name: /match/ })).toBeVisible();
  await expect(win.locator('mark').first()).toHaveText(/firewall/i);
  await win.getByLabel('Search or ask a question').fill('What did we decide about deployment?');
  await win.getByLabel('Search or ask a question').press('Enter');
  const answer = win.locator('section[aria-labelledby="answer-heading"]');
  await expect(answer).toContainText(/Monday/);
  await expect(answer).toContainText('Source: Project Phoenix Weekly (sample)');
  await shot(win, '08-ask');
  await answer.locator('a').first().click();
  await expect(win.getByRole('heading', { name: 'TL;DR' })).toBeVisible();

  expect(l.logs.filter((x) => x.startsWith('pageerror'))).toEqual([]);
});

test('delete a meeting, then delete everything', async () => {
  l = await launch();
  const { win } = l;
  await onboard(win);
  await win.getByRole('button', { name: /Try a sample meeting/ }).click();
  await expect(win.locator('.transcript-live')).toContainText("that's all for today", {
    timeout: 30_000,
  });
  await win.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(win.getByRole('heading', { name: 'TL;DR' })).toBeVisible({ timeout: 20_000 });

  await win.getByRole('button', { name: 'Delete transcript' }).click();
  await win.getByRole('dialog').getByRole('button', { name: 'Delete transcript' }).click();
  await expect(win.getByText('Transcript and audio deleted.')).toBeVisible();
  await expect(win.getByRole('tab', { name: /Transcript/ })).toBeVisible();
  await win
    .locator('section[aria-labelledby="decisions"]')
    .getByRole('button', { name: 'Why?' })
    .first()
    .click();
  await expect(win.getByText('The transcript for this meeting was deleted.')).toBeVisible();

  await win.getByRole('button', { name: 'Delete meeting' }).click();
  await win.getByRole('dialog').getByRole('button', { name: 'Delete meeting' }).click();
  await expect(win.getByRole('heading', { name: 'Meetings', exact: true })).toBeVisible();
  await expect(win.getByText('No meetings yet')).toBeVisible();

  await win.getByRole('link', { name: 'Settings' }).click();
  await win.getByRole('button', { name: 'Add samples' }).click();
  await expect(win.getByRole('button', { name: 'Remove samples' })).toBeVisible({
    timeout: 30_000,
  });
  await win.getByRole('button', { name: 'Delete everything' }).click();
  const dialog = win.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Delete everything' })).toBeDisabled();
  await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
  await dialog.getByRole('button', { name: 'Delete everything' }).click();
  await win.getByRole('link', { name: 'Meetings' }).click();
  await expect(win.getByText('No meetings yet')).toBeVisible();
});
