import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Services, type CaptureBackend, type ServicesDeps } from '../src/main/services';
import type { SpeechSegment, Transcriber } from '../src/main/capture/session';
import type { CaptureSession } from '../src/main/capture/session';
import type { Encryptor } from '../src/main/secrets';
import type { AppEvent, PermissionStatus } from '../src/shared/types';
import type { Env } from '../src/main/env';
import { phoenixWeekly } from '@meeting-assistant/core/fixtures';

export const TEST_ENV: Env = {
  appEnv: 'test',
  dataDir: null,
  emailMode: 'mock',
  fakePermissions: true,
  fixedNow: null,
  demoSpeed: 1000,
  claudeApiKey: null,
  testMeetingAudio: null,
  aiOverride: null,
};

/** Reversible fake of the OS keychain (base64 with a marker). */
export const fakeEncryptor = (available = true): Encryptor => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
  decryptString: (b) => {
    const s = b.toString();
    if (!s.startsWith('enc:')) throw new Error('bad');
    return Buffer.from(s.slice(4), 'base64').toString();
  },
});

/** Emits one transcript line per flush for each channel that received audio. */
export class FakeTranscriber implements Transcriber {
  private seg: (s: SpeechSegment) => void = () => undefined;
  private fail: (m: string) => void = () => undefined;
  pushed = { mic: 0, system: 0 };
  started = false;
  stopped = false;
  constructor(private readonly opts: { failStart?: boolean; lines?: SpeechSegment[] } = {}) {}
  onSegment(cb: (s: SpeechSegment) => void) {
    this.seg = cb;
  }
  onFailure(cb: (m: string) => void) {
    this.fail = cb;
  }
  async start() {
    if (this.opts.failStart) throw new Error('The speech engine could not start.');
    this.started = true;
  }
  push(channel: 'mic' | 'system', samples: Float32Array) {
    this.pushed[channel] += samples.length;
  }
  async flush() {
    for (const l of this.opts.lines ?? []) this.seg(l);
  }
  async stop() {
    this.stopped = true;
  }
  crash(message: string) {
    this.fail(message);
  }
}

export class FakeBackend implements CaptureBackend {
  calls: string[] = [];
  constructor(private readonly session: CaptureSession) {}
  async startLive() {
    this.calls.push('startLive');
  }
  startDemo() {
    this.calls.push('startDemo');
    for (const s of phoenixWeekly.segments) this.session.ingestSegment(s);
  }
  async pause() {
    this.calls.push('pause');
  }
  async resume() {
    this.calls.push('resume');
  }
  async stop() {
    this.calls.push('stop');
  }
  async probeSystemAudio() {
    return true;
  }
}

export interface Harness {
  services: Services;
  events: AppEvent[];
  dir: string;
  backend: () => FakeBackend;
  transcribers: FakeTranscriber[];
  opened: string[];
  copied: string[];
  cleanup: () => Promise<void>;
}

export function makeHarness(
  over: Partial<ServicesDeps> & { transcriber?: () => FakeTranscriber | null; dir?: string } = {},
): Harness {
  const dir = over.dir ?? mkdtempSync(join(tmpdir(), 'ma-test-'));
  const events: AppEvent[] = [];
  const transcribers: FakeTranscriber[] = [];
  const opened: string[] = [];
  const copied: string[] = [];
  let backend: FakeBackend | null = null;
  const permissions: PermissionStatus = {
    microphone: 'granted',
    screen: 'granted',
    systemAudio: 'granted',
    help: {},
  };
  const services = new Services({
    env: TEST_ENV,
    dataDir: dir,
    now: () => new Date('2026-09-25T16:00:00Z'),
    encryptor: fakeEncryptor(),
    shell: {
      openExternal: async (u) => void opened.push(u),
      copyText: (t) => void copied.push(t),
      showItemInFolder: () => undefined,
      notify: () => undefined,
      appVersion: '0.1.0-test',
      osVersion: 'test',
    },
    permissions: {
      status: () => permissions,
      request: async () => permissions,
      openSettings: async () => undefined,
    },
    createBackend: (session) => (backend = new FakeBackend(session)),
    createTranscriber: () => {
      const t = over.transcriber ? over.transcriber() : new FakeTranscriber();
      if (t) transcribers.push(t);
      return t;
    },
    fetcher: async () => new Response('nope', { status: 404 }),
    emit: (e) => void events.push(e),
    timeZone: () => 'America/New_York',
    ...over,
  });
  return {
    services,
    events,
    dir,
    backend: () => backend!,
    transcribers,
    opened,
    copied,
    cleanup: async () => {
      await services.shutdown().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(check: () => boolean, timeout = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for condition');
    await tick(10);
  }
}

import { mkdirSync, writeFileSync } from 'node:fs';
import { requiredFiles } from '../src/main/transcription/models';

/** Make the speech models look installed (markers only) so capture uses the transcriber. */
export function fakeInstallModels(
  dataDir: string,
  model: 'moonshine-base-en' = 'moonshine-base-en',
): void {
  const root = join(dataDir, 'models');
  mkdirSync(root, { recursive: true });
  for (const f of requiredFiles(model)) {
    if (f.kind === 'archive') mkdirSync(join(root, f.dir!), { recursive: true });
    else writeFileSync(join(root, f.fileName!), 'x');
    writeFileSync(join(root, `.${f.id}.installed`), f.sha256);
  }
}
