import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * One temporary folder for the whole run, removed at the end. Each test's app data
 * goes inside it, and the harness copies about 1 GB of speech models per scenario,
 * so leaving them behind filled the disk after a day of runs.
 */
export default function globalSetup(): () => void {
  const root = mkdtempSync(join(tmpdir(), 'ma-e2e-run-'));
  process.env.MEETING_ASSISTANT_E2E_TMP = root;
  return () => rmSync(root, { recursive: true, force: true });
}
