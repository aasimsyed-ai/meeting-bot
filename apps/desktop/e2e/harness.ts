import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import electronBinary from 'electron';

/** The capture harness (tests/capture): scenarios, synthesized audio, and a fake meeting app. */
export const HARNESS_DIR = resolve(__dirname, '../../../tests/capture');

export interface Scenario {
  id: string;
  windowTitle: string;
  user: { name: string; email: string };
  lines: { speaker: string; channel: 'mic' | 'meeting'; text: string }[];
  expected: {
    decisions: { match: string; status?: string }[];
    tasks: { match: string; owner?: string; weekday?: string; knownIssue?: string }[];
    questions?: string[];
    screen?: string[];
    notTasks?: string[];
    notDecisions?: string[];
    changedRequirement?: string;
  };
}

export function loadScenario(id: string): Scenario {
  return JSON.parse(readFileSync(join(HARNESS_DIR, 'scenarios', `${id}.json`), 'utf8'));
}

export interface FakeMeeting {
  /** The meeting starts: audio plays and slides change. */
  start(): void;
  finished: Promise<void>;
  windowClosed: Promise<void>;
  output: string[];
  kill(): void;
}

/**
 * Launch the fake meeting app (a separate process, like a real meeting app). It shows its
 * window right away and waits for start() before anyone speaks.
 */
export async function openFakeMeeting(id: string, audioRoot: string): Promise<FakeMeeting> {
  const audioDir = join(audioRoot, id);
  if (!existsSync(join(audioDir, 'meeting.wav')))
    throw new Error(`No synthesized audio in ${audioDir}; run tests/capture/run.sh`);
  const go = join(audioDir, '.go');
  rmSync(go, { force: true });
  // In Node, the electron package's default export is the path to its binary.
  const electron = electronBinary as unknown as string;
  const args = [
    join(HARNESS_DIR, 'fake-meeting', 'main.cjs'),
    join(HARNESS_DIR, 'scenarios', `${id}.json`),
    audioDir,
    go,
  ];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  const child: ChildProcess = spawn(electron, args, {
    env: { ...process.env, FAKE_MEETING_MIC_SINK: process.env.FAKE_MEETING_MIC_SINK ?? 'Mic_feed' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  const waitFor = (marker: string) =>
    new Promise<void>((res, rej) => {
      const check = (d: Buffer) => {
        if (String(d).includes(marker)) res();
      };
      child.stdout!.on('data', check);
      child.once('exit', () => rej(new Error(`fake meeting exited before ${marker}`)));
    });
  child.stdout!.on('data', (d) => output.push(String(d)));
  child.stderr!.on('data', (d) => output.push(String(d)));
  const ready = waitFor('FAKE_MEETING_READY');
  const finished = waitFor('FAKE_MEETING_FINISHED');
  const windowClosed = waitFor('FAKE_MEETING_WINDOW_CLOSED');
  finished.catch(() => undefined);
  windowClosed.catch(() => undefined);
  await ready;
  return {
    start: () => writeFileSync(go, ''),
    finished,
    windowClosed,
    output,
    kill: () => child.kill(),
  };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Weekday name of a yyyy-mm-dd date. */
export function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!;
}
