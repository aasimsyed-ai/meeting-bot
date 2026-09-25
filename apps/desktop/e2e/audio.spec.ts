import { expect, test } from '@playwright/test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, onboard, type Launched } from './app';
import { requiredFiles } from '../src/main/transcription/models';

/**
 * The whole product with real speech: meeting audio -> capture session ->
 * speech engine (utility process) -> speaker clustering -> notes -> UI.
 * Needs models and a synthetic meeting WAV (see test/speech.integration.test.ts).
 */
const models = process.env.MEETING_ASSISTANT_TEST_MODELS;
const wav = process.env.MEETING_ASSISTANT_TEST_WAV;

let l: Launched | null = null;
test.afterEach(async () => {
  await l?.app.close().catch(() => undefined);
});

test.skip(
  !models || !wav || !existsSync(models!),
  'needs MEETING_ASSISTANT_TEST_MODELS and MEETING_ASSISTANT_TEST_WAV',
);

test('meeting audio becomes a transcript with speakers and correct notes', async () => {
  test.setTimeout(240_000);
  const dataDir = mkdtempSync(join(tmpdir(), 'ma-e2e-audio-'));
  const root = join(dataDir, 'models');
  mkdirSync(root, { recursive: true });
  for (const f of requiredFiles('moonshine-base-en')) {
    const name = f.kind === 'archive' ? f.dir! : f.fileName!;
    cpSync(join(models!, name), join(root, name), { recursive: true, dereference: true });
    writeFileSync(join(root, `.${f.id}.installed`), f.sha256);
  }
  l = await launch({
    dataDir,
    env: { MEETING_ASSISTANT_TEST_MEETING_AUDIO: wav!, MEETING_ASSISTANT_DEMO_SPEED: '4' },
  });
  const { win } = l;
  await onboard(win);
  await win.getByRole('button', { name: 'Teams' }).click();
  await win.getByRole('button', { name: 'Start taking notes' }).click();
  await expect(win.locator('.meter', { hasText: 'Meeting audio' })).toContainText('Listening', {
    timeout: 20_000,
  });
  // Live transcript lines appear as people speak.
  await expect(win.locator('.transcript-live')).toContainText(/deploy/i, { timeout: 60_000 });
  await expect(win.locator('.transcript-live')).toContainText(/today/i, { timeout: 90_000 });
  await win.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(win.getByRole('heading', { name: 'TL;DR' })).toBeVisible({ timeout: 60_000 });

  await expect(win.locator('section[aria-labelledby="decisions"]')).toContainText(/monday/i);
  const tasks = win.locator('section[aria-labelledby="actions"]');
  await expect(tasks.locator('input[aria-label="Task"]').first()).toHaveValue(/firewall/i);
  await expect(tasks.locator('input[aria-label="Owner"]').first()).toHaveValue(/^Speaker \d$/);
  await win.getByRole('tab', { name: /Transcript/ }).click();
  const speakerChips = win.locator('section[aria-labelledby="speakers"] .chip');
  expect(await speakerChips.count()).toBeGreaterThanOrEqual(3);
});
