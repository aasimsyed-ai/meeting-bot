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

/**
 * What to do about a recorded previous instance, given the processes that are running now.
 * Pure, so it can be unit tested on any OS. A recorded process that still runs this app
 * (or whose path cannot be read) counts as a live instance and is never touched.
 */
export function recoveryPlan(
  running: ProcessInfo[],
  recordedPid: number,
  execPath: string,
  selfPid: number,
): { alive: boolean; helpers: number[] } {
  const same = (p: string | null) => !!p && p.toLowerCase() === execPath.toLowerCase();
  const recorded = running.find((p) => p.pid === recordedPid);
  if (recorded && (recorded.executablePath === null || same(recorded.executablePath)))
    return { alive: true, helpers: [] };
  const helpers = running
    .filter((p) => p.parentPid === recordedPid && p.pid !== selfPid && same(p.executablePath))
    .map((p) => p.pid);
  return { alive: false, helpers };
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

/** The recorded process (if it is still running) and its children. */
function windowsProcesses(pid: number): ProcessInfo[] {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ProcessId=${pid} OR ParentProcessId=${pid}" | ` +
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
    log('No record of a previous session; nothing to recover.');
    return false;
  }
  if (!Number.isInteger(deadPid) || deadPid <= 0 || deadPid === process.pid) return false;
  let helpers: number[];
  try {
    const running = windowsProcesses(deadPid);
    const plan = recoveryPlan(running, deadPid, process.execPath, process.pid);
    if (plan.alive) {
      log(`The previous session (process ${deadPid}) is still running.`);
      return false;
    }
    helpers = plan.helpers;
    log(
      `The previous session (process ${deadPid}) has ended; ${running.length} of its processes ` +
        `are still running, ${helpers.length} of them helpers of this app.`,
    );
  } catch (err) {
    log(`Could not list processes left by the previous session: ${String(err)}`);
    return false;
  }
  if (!helpers.length) return false;
  let ended = 0;
  for (const pid of helpers) {
    try {
      process.kill(pid);
      ended++;
    } catch {
      try {
        execFileSync('taskkill', ['/F', '/PID', String(pid)], {
          stdio: 'ignore',
          windowsHide: true,
        });
        ended++;
      } catch {
        // Already gone, or not ours to end.
      }
    }
  }
  log(`Ended ${ended} of ${helpers.length} helper processes left by a previous session.`);
  for (let i = 0; i < 40 && helpers.some(isAlive); i++) sleepSync(100);
  return ended > 0;
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
