import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Single-instance lock with recovery after a crash on Windows.
 *
 * When the main process dies abruptly on Windows, its helper processes (network
 * service, GPU, renderers) can keep running for a long time and keep holding the
 * single-instance lock, so reopening the app silently does nothing. The running
 * instance records its process id; a new launch that cannot get the lock checks
 * whether that process is really gone and, only then, ends the helpers it left
 * behind (children of the dead process that run this same executable).
 */

export interface ProcessInfo {
  pid: number;
  parentPid: number;
  executablePath: string | null;
}

const PID_FILE = 'instance.pid';

/** Helpers left behind by a dead main process. Pure, so it can be unit tested on any OS. */
export function orphanedHelpers(
  processes: ProcessInfo[],
  deadPid: number,
  execPath: string,
  selfPid: number,
): number[] {
  const same = (p: string | null) => !!p && p.toLowerCase() === execPath.toLowerCase();
  return processes
    .filter((p) => p.parentPid === deadPid && p.pid !== selfPid && same(p.executablePath))
    .map((p) => p.pid);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function windowsChildren(parentPid: number): ProcessInfo[] {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid}" | ` +
        'Select-Object ProcessId,ParentProcessId,ExecutablePath | ConvertTo-Json -Compress',
    ],
    { encoding: 'utf8', timeout: 10_000, windowsHide: true },
  ).trim();
  if (!out) return [];
  const rows = [JSON.parse(out)].flat() as {
    ProcessId: number;
    ParentProcessId: number;
    ExecutablePath: string | null;
  }[];
  return rows.map((r) => ({
    pid: r.ProcessId,
    parentPid: r.ParentProcessId,
    executablePath: r.ExecutablePath,
  }));
}

/** Returns true if helpers of a crashed instance were found and ended. */
function cleanUpAfterCrash(dataDir: string, log: (msg: string) => void): boolean {
  let deadPid: number;
  try {
    deadPid = Number(readFileSync(join(dataDir, PID_FILE), 'utf8').trim());
  } catch {
    return false;
  }
  if (!Number.isInteger(deadPid) || deadPid <= 0 || deadPid === process.pid) return false;
  if (isAlive(deadPid)) return false;
  let helpers: number[];
  try {
    helpers = orphanedHelpers(windowsChildren(deadPid), deadPid, process.execPath, process.pid);
  } catch {
    return false;
  }
  if (!helpers.length) return false;
  for (const pid of helpers) {
    try {
      process.kill(pid);
    } catch {
      // Already gone.
    }
  }
  log(`Ended ${helpers.length} helper processes left by a previous session that did not close.`);
  for (let i = 0; i < 40 && helpers.some(isAlive); i++) sleepSync(100);
  return true;
}

/**
 * Takes the single-instance lock. On Windows, recovers once from helpers left
 * behind by a crashed instance. Returns false when another live instance owns it.
 */
export function acquireInstanceLock(
  lock: () => boolean,
  dataDir: string,
  log: (msg: string) => void = () => undefined,
): boolean {
  if (lock()) return recordInstance(dataDir);
  if (process.platform !== 'win32' || !cleanUpAfterCrash(dataDir, log)) return false;
  for (let i = 0; i < 20; i++) {
    if (lock()) return recordInstance(dataDir);
    sleepSync(250);
  }
  return false;
}

function recordInstance(dataDir: string): true {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, PID_FILE), String(process.pid), { mode: 0o600 });
  } catch {
    // Recovery after a crash is best effort; the app works without it.
  }
  return true;
}

/** Called on a clean exit so the next launch has nothing to recover. */
export function releaseInstance(dataDir: string): void {
  rmSync(join(dataDir, PID_FILE), { force: true });
}
