import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launch, nav, onboard, type Launched } from './app';

/**
 * Permission cases from the capture validation plan. CI machines cannot change real OS
 * permissions, so the app's own permission layer refuses access in test mode
 * (MEETING_ASSISTANT_TEST_DENY). That produces the same error the page gets when the OS or
 * browser denies access (NotAllowedError, no screen), so everything after it is the real
 * app code. Real OS prompts: NOT TESTED — REQUIRES REAL DEVICE.
 * Case A (everything allowed) is the capture harness and capture.spec.ts.
 */
let l: Launched | null = null;
test.afterEach(async () => {
  await l?.app.close().catch(() => undefined);
  l = null;
});

async function start(deny: string): Promise<Page> {
  l = await launch({ env: { MEETING_ASSISTANT_TEST_DENY: deny } });
  await onboard(l.win);
  await l.win.getByRole('button', { name: 'Start taking notes' }).click();
  return l.win;
}

const setDenied = (app: ElectronApplication, kind: string, denied: boolean) =>
  app.evaluate(
    (_e, [k, d]) => {
      const set = (globalThis as { __testDeny?: Set<string> }).__testDeny!;
      if (d) set.add(k as string);
      else set.delete(k as string);
    },
    [kind, denied] as const,
  );

const meter = (win: Page, name: string) => win.locator('.meter', { hasText: name });

test('B and E: microphone denied is explained, and "Try again" works once it is allowed', async () => {
  const win = await start('mic');
  const notice = win.locator('.notice', { hasText: 'Microphone access is off' });
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice.getByRole('button', { name: 'Open microphone settings' })).toBeVisible();
  await expect(meter(win, 'You')).toContainText('Not available');

  // E: the user allows access in system settings, then tries again. No restart, no reinstall.
  await setDenied(l!.app, 'mic', false);
  await notice.getByRole('button', { name: 'Try again' }).click();
  await expect(meter(win, 'You')).toContainText('Listening', { timeout: 15_000 });
  await expect(notice).toBeHidden();
});

test('D: meeting audio unavailable is explained with a way to retry', async () => {
  const win = await start('system');
  const notice = win.locator('.notice', { hasText: 'Meeting audio could not be captured' });
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(meter(win, 'Meeting audio')).toContainText('Not available');
  // Still taking notes from the microphone, and it says so.
  await expect(meter(win, 'You')).toContainText('Listening', { timeout: 15_000 });
  await expect(win.locator('.live-state')).toHaveText('Taking notes');
});

test('B+D: with no audio at all, the app never claims to be taking notes', async () => {
  const win = await start('mic,system');
  await expect(win.locator('.live-state')).toHaveText('Not hearing anything', {
    timeout: 15_000,
  });
  await expect(
    win.getByText('No audio is coming in, so nothing is being written down'),
  ).toBeVisible();
  // The sidebar says the same on every other page.
  await nav(win, 'Meetings').click();
  await expect(win.locator('.capture-pill')).toContainText('Not hearing anything');
});

test('C: screen access denied is explained; audio notes carry on', async () => {
  const win = await start('screen');
  await expect(meter(win, 'Screen')).toContainText('Needs permission', { timeout: 15_000 });
  const notice = win.locator('.notice', { hasText: 'screen access is off' });
  await expect(notice.getByRole('button', { name: 'Open screen settings' })).toBeVisible();
  await expect(meter(win, 'You')).toContainText('Listening', { timeout: 15_000 });
  await expect(win.locator('.live-state')).toHaveText('Taking notes');
});

test('F: access taken away during a meeting is detected and shown', async () => {
  const win = await start('');
  await expect(meter(win, 'You')).toContainText('Listening', { timeout: 15_000 });
  await expect(win.locator('.live-state')).toHaveText('Taking notes');
  // The OS takes the microphone and meeting audio away: streams stop without warning.
  await setDenied(l!.app, 'mic', true);
  await setDenied(l!.app, 'system', true);
  await l!.app.evaluate(async ({ BrowserWindow }) => {
    const cap = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('capture.html'),
    );
    await cap!.webContents.executeJavaScript(`window.__capture.run({ type: 'stop' })`);
  });
  await expect(win.locator('.live-state')).toHaveText('Not hearing anything', {
    timeout: 20_000,
  });
  await expect(meter(win, 'You')).not.toContainText('Listening');
  await expect(win.locator('.notice', { hasText: /microphone/i }).first()).toBeVisible();

  // Access comes back: the app gets audio again by itself or with "Try again".
  await setDenied(l!.app, 'mic', false);
  await setDenied(l!.app, 'system', false);
  await win.getByRole('button', { name: 'Try again' }).first().click();
  await expect(win.locator('.live-state')).toHaveText('Taking notes', { timeout: 20_000 });
});
