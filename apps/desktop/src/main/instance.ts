import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Single-instance lock with recovery after a crash on Windows.
 *
 * When the main process dies abruptly on Windows, its helper processes (network
 * service, GPU, renderers) can keep running for a long time and keep holding the
 * single-instance lock, so reopening the app silently does nothing. Windows even
 * keeps listing the dead main process while those helpers hold handles to it.
 *
 * So liveness comes from a heartbeat the app controls: the running instance
 * writes its process id to a file and touches it every 2 seconds. A launch that
 * is refused the lock waits until the heartbeat has been silent for 6 seconds,
 * and only then ends the helpers that instance left behind (its children running
 * this same executable). A live instance keeps beating and is never touched.
 */

export interface ProcessInfo {
  pid: number;
  parentPid: number;
  executablePath: string | null;
  threadCount?: number;
}

const PID_FILE = 'instance.pid';
const HEARTBEAT_MS = 2_000;
const STALE_MS = 6_000;

/** True once a heartbeat has been silent long enough that its instance must be gone. */
export function heartbeatIsStale(lastBeatMs: number, nowMs: number): boolean {
  return nowMs - lastBeatMs > STALE_MS;
}

/** Helpers left by an ended instance: its children that run this app. Pure, for tests. */
export function orphanedHelpers(
  running: ProcessInfo[],
  recordedPid: number,
  execPath: string,
  selfPid: number,
): number[] {
  const same = (p: string | null) => !!p && p.toLowerCase() === execPath.toLowerCase();
  return running
    .filter((p) => p.parentPid === recordedPid && p.pid !== selfPid && same(p.executablePath))
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

/** The recorded process (if still listed) and its children. */
function windowsProcesses(pid: number): ProcessInfo[] {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ProcessId=${pid} OR ParentProcessId=${pid}" | ` +
        'Select-Object ProcessId,ParentProcessId,ExecutablePath,ThreadCount | ConvertTo-Json -Compress',
    ],
    { encoding: 'utf8', timeout: 10_000, windowsHide: true },
  ).trim();
  if (!out) return [];
  const rows = [JSON.parse(out)].flat() as {
    ProcessId: number;
    ParentProcessId: number;
    ExecutablePath: string | null;
    ThreadCount: number | null;
  }[];
  return rows.map((r) => ({
    pid: r.ProcessId,
    parentPid: r.ParentProcessId,
    executablePath: r.ExecutablePath,
    threadCount: r.ThreadCount ?? undefined,
  }));
}

/** Returns true if helpers of a crashed instance were found and ended. */
function cleanUpAfterCrash(dataDir: string, log: (msg: string) => void): boolean {
  const file = join(dataDir, PID_FILE);
  let deadPid: number;
  try {
    deadPid = Number(readFileSync(file, 'utf8').trim());
  } catch {
    log('No record of a previous session; nothing to recover.');
    return false;
  }
  if (!Number.isInteger(deadPid) || deadPid <= 0 || deadPid === process.pid) return false;
  // A live instance touches the file every 2 s. Wait until it has been silent for 6 s.
  const started = Date.now();
  for (;;) {
    let lastBeat: number;
    try {
      lastBeat = statSync(file).mtimeMs;
    } catch {
      return false; // Removed by a clean exit meanwhile.
    }
    if (heartbeatIsStale(lastBeat, Date.now())) break;
    if (Date.now() - started > STALE_MS + HEARTBEAT_MS) {
      log(`The previous session (process ${deadPid}) is still running.`);
      return false;
    }
    sleepSync(500);
  }
  let helpers: number[];
  try {
    const running = windowsProcesses(deadPid);
    helpers = orphanedHelpers(running, deadPid, process.execPath, process.pid);
    log(
      `The previous session (process ${deadPid}) stopped; ${helpers.length} of its helper ` +
        'processes are still running.',
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

let heartbeat: ReturnType<typeof setInterval> | null = null;

function recordInstance(dataDir: string): true {
  const file = join(dataDir, PID_FILE);
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, String(process.pid), { mode: 0o600 });
  } catch {
    // Recovery after a crash is best effort; the app works without it.
    return true;
  }
  if (process.platform === 'win32') {
    heartbeat = setInterval(() => {
      try {
        const now = new Date();
        utimesSync(file, now, now);
      } catch {
        // Best effort.
      }
    }, HEARTBEAT_MS);
    heartbeat.unref();
  }
  return true;
}

/** Called on a clean exit so the next launch has nothing to recover. */
export function releaseInstance(dataDir: string): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  rmSync(join(dataDir, PID_FILE), { force: true });
}
