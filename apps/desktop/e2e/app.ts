import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Launched {
  app: ElectronApplication;
  win: Page;
  dataDir: string;
  logs: string[];
}

/** Launch the built app in test mode with its own empty data folder. */
export async function launch(
  opts: { dataDir?: string; env?: Record<string, string> } = {},
): Promise<Launched> {
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'ma-e2e-'));
  // MEETING_ASSISTANT_E2E_EXECUTABLE runs the same tests against a packaged app.
  const executablePath = process.env.MEETING_ASSISTANT_E2E_EXECUTABLE || undefined;
  const args = executablePath ? [] : ['.'];
  if (process.platform === 'linux') args.push('--no-sandbox');
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args,
    cwd: join(__dirname, '..'),
    env: {
      ...process.env,
      MEETING_ASSISTANT_ENV: 'test',
      MEETING_ASSISTANT_DATA_DIR: dataDir,
      MEETING_ASSISTANT_FAKE_PERMISSIONS: '1',
      MEETING_ASSISTANT_DEMO_SPEED: '25',
      ...opts.env,
    },
  });
  const logs: string[] = [];
  app.process().stdout?.on('data', (d) => logs.push(String(d)));
  app.process().stderr?.on('data', (d) => logs.push(String(d)));
  const win = await app.firstWindow();
  win.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await win.waitForLoadState('domcontentloaded');
  return { app, win, dataDir, logs };
}

/** Screenshots for docs, only when UPDATE_SCREENSHOTS=1. */
export async function shot(win: Page, name: string): Promise<void> {
  if (process.env.UPDATE_SCREENSHOTS !== '1') return;
  const dir = join(__dirname, '../../../docs/screenshots');
  mkdirSync(dir, { recursive: true });
  await win.screenshot({ path: join(dir, `${name}.png`) });
}

/** Onboarding with a name and email, skipping the model download. */
export async function onboard(
  win: Page,
  name = 'Alice Johnson',
  email = 'alice.johnson@acme.example.test',
): Promise<void> {
  await win.getByRole('button', { name: 'Get started' }).click();
  await win.getByLabel('Your name').fill(name);
  await win.getByLabel('Work email (optional)').fill(email);
  await win.getByRole('button', { name: 'Continue' }).click();
  await win.getByText('Let it hear your meetings').waitFor();
  await win.getByRole('button', { name: 'Continue' }).click();
  await win.getByText('Download the speech engine').waitFor();
  await win.getByRole('button', { name: /^(Later|Continue)$/ }).click();
  await win.getByRole('button', { name: 'Open Meeting Assistant' }).click();
}

/** Click a main navigation link (the sidebar), not a same-named link on the page. */
export function nav(win: Page, name: string) {
  return win.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true });
}

/** Run axe-core inside the Electron window (the Playwright wrapper cannot open pages in Electron). */
export async function axe(
  win: Page,
): Promise<{ id: string; impact: string | null; help: string; nodes: number }[]> {
  const source = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  await win.evaluate(source);
  return win.evaluate(async () => {
    const w = window as unknown as {
      axe: {
        run: (
          ctx: Document,
          opts: object,
        ) => Promise<{
          violations: { id: string; impact: string | null; help: string; nodes: unknown[] }[];
        }>;
      };
    };
    const r = await w.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
    }));
  });
}
