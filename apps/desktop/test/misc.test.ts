import {
  mkdtempSync,
  readFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { matchMeetingWindow, detectFromTitles } from '../src/main/detection-rules';
import { MailAppProvider, MockEmailProvider } from '../src/main/email/providers';
import { redact, Logger } from '../src/main/log';
import { readEnv } from '../src/main/env';
import { SecretStore } from '../src/main/secrets';
import { openDatabase } from '../src/main/db/database';
import { Repo } from '../src/main/db/repo';
import { IPC_SCHEMAS } from '../src/shared/ipc';
import { CAPTURE_CHANNELS } from '../src/shared/channels';
import {
  downloadFiles,
  downloadModel,
  isInstalled,
  modelsReady,
  requiredFiles,
  type ModelFile,
} from '../src/main/transcription/models';
import { fakeEncryptor } from './helpers';
import type { EmailDraftRow } from '../src/shared/types';
import { createIpcHandler } from '../src/main/ipc-handler';

describe('meeting detection', () => {
  it.each([
    ['Zoom Meeting', 'zoom'],
    ['Zoom Webinar', 'zoom'],
    ['Weekly sync | Meeting | Microsoft Teams', 'teams'],
    ['Meeting in "General" | Microsoft Teams', 'teams'],
    ['Meet - abc-defg-hij - Google Chrome', 'meet'],
    ['Meet – Project Phoenix – abc-defg-hij - Microsoft Edge', 'meet'],
    ['Huddle in #eng - Acme - Slack', 'slack'],
    ['Webex Meeting', 'other'],
  ])('%s -> %s', (title, platform) => {
    expect(matchMeetingWindow(title)?.platform).toBe(platform);
  });

  it.each([
    'Zoom out - Photos',
    'Microsoft Teams',
    'Slack - general',
    'Google Chrome',
    'meeting notes.docx - Word',
    '',
  ])('ignores %s', (title) => {
    expect(matchMeetingWindow(title)).toBeNull();
  });

  it('extracts a meeting title when the window shows one', () => {
    expect(matchMeetingWindow('Weekly sync | Meeting | Microsoft Teams')?.title).toBe(
      'Weekly sync',
    );
  });

  it("ignores the app's own windows", () => {
    expect(detectFromTitles(['Zoom Meeting'], (t) => t === 'Zoom Meeting')).toBeNull();
  });
});

const draft = (body: string): EmailDraftRow => ({
  subject: 'Meeting Summary — Phoenix',
  body,
  to: [
    { name: 'Bob', email: 'bob@acme.example.test', role: 'required', external: false },
    { name: 'Bad', email: 'not-an-email', role: 'required', external: false },
  ],
  warnings: [],
  status: 'draft',
  updatedAt: '',
});

describe('email providers', () => {
  it('opens a mailto draft with valid recipients only', async () => {
    const opened: string[] = [];
    const p = new MailAppProvider({
      openExternal: async (u) => void opened.push(u),
      copyText: () => undefined,
      platform: 'win32',
    });
    const r = await p.createDraft(draft('Short body'));
    expect(r.status).toBe('opened_in_mail_app');
    expect(r.message).toMatch(/press Send there/);
    expect(opened[0]).toMatch(/^mailto:bob@acme\.example\.test\?subject=/);
    expect(opened[0]).not.toContain('not-an-email');
  });

  it('copies very long bodies instead of truncating them', async () => {
    const opened: string[] = [];
    const copied: string[] = [];
    const p = new MailAppProvider({
      openExternal: async (u) => void opened.push(u),
      copyText: (t) => void copied.push(t),
      platform: 'win32',
    });
    const long = 'x'.repeat(5000);
    const r = await p.createDraft(draft(long));
    expect(r.bodyCopied).toBe(true);
    expect(copied).toEqual([long]);
    expect(opened[0]).not.toContain('body=');
  });

  it('mock provider writes to the outbox and never claims to send', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ma-outbox-'));
    const r = await new MockEmailProvider(dir).createDraft(draft('Hello'));
    expect(r.status).toBe('mock_sent');
    expect(r.message).toMatch(/No email was sent/);
    expect(readdirSync(dir)).toHaveLength(1);
  });
});

describe('logging', () => {
  it('redacts keys, tokens and emails', () => {
    const s = redact(
      'key sk-ant-abcdefghijklmnop token=abc123 Bearer xyz.abc user alice@acme.example.test',
    );
    expect(s).not.toMatch(/sk-ant-abcdef|abc123|xyz\.abc|alice@/);
  });

  it('never writes transcript-like fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ma-log-'));
    const l = new Logger(false);
    l.setDirectory(dir);
    l.info('segment_saved', {
      meetingId: 'm1',
      text: 'the secret plan',
      quote: 'secret',
      body: 'secret',
      count: 3,
    });
    const out = readFileSync(join(dir, 'main.log'), 'utf8');
    expect(out).toContain('segment_saved');
    expect(out).toContain('"count":3');
    expect(out).not.toContain('secret');
  });
});

describe('environments', () => {
  it('forces mock email and no API key in tests', () => {
    const e = readEnv({
      MEETING_ASSISTANT_ENV: 'test',
      EMAIL_MODE: 'real',
      ANTHROPIC_API_KEY: 'sk-ant-x',
    });
    expect(e.emailMode).toBe('mock');
    expect(e.claudeApiKey).toBeNull();
  });

  it('only allows fake permissions in test mode', () => {
    expect(readEnv({ MEETING_ASSISTANT_FAKE_PERMISSIONS: '1' }, true).fakePermissions).toBe(false);
    expect(
      readEnv({ MEETING_ASSISTANT_ENV: 'test', MEETING_ASSISTANT_FAKE_PERMISSIONS: '1' })
        .fakePermissions,
    ).toBe(true);
  });

  it('is production when packaged', () => {
    expect(readEnv({}, true)).toMatchObject({ appEnv: 'production', emailMode: 'mailapp' });
  });
});

describe('secrets', () => {
  it('encrypts with the OS store and never stores plaintext', () => {
    const repo = new Repo(openDatabase(':memory:'));
    const s = new SecretStore(repo, fakeEncryptor(true));
    expect(s.set('k', 'sk-ant-secret')).toEqual({ persistent: true });
    expect(repo.getSetting('secret:k')).not.toContain('sk-ant-secret');
    expect(s.get('k')).toBe('sk-ant-secret');
  });

  it('keeps secrets in memory only when no secure store exists', () => {
    const repo = new Repo(openDatabase(':memory:'));
    const s = new SecretStore(repo, fakeEncryptor(false));
    expect(s.set('k', 'v')).toEqual({ persistent: false });
    expect(repo.getSetting('secret:k')).toBeUndefined();
    expect(s.get('k')).toBe('v');
  });

  it('drops unreadable secrets instead of crashing', () => {
    const repo = new Repo(openDatabase(':memory:'));
    repo.setSetting('secret:k', Buffer.from('garbage').toString('base64'));
    expect(new SecretStore(repo, fakeEncryptor(true)).get('k')).toBeNull();
    expect(repo.getSetting('secret:k')).toBeUndefined();
  });
});

describe('IPC validation', () => {
  it.each([
    ['meetings:get', ['../../etc/passwd']],
    ['meetings:get', ['a'.repeat(200)]],
    ['meetings:rename', ['mtg_1', '']],
    ['capture:start', [{ source: 'hacked' }]],
    ['capture:start', [{ extra: true }]],
    ['settings:update', [{ profile: { name: 'x' }, admin: true }]],
    ['tasks:update', ['m', 't', { deadlineDate: 'next friday' }]],
    ['data:deleteAll', ['yes']],
    ['search:query', ['x'.repeat(600)]],
    ['email:update', ['m', { body: 'x'.repeat(60_000) }]],
  ])('rejects %s %j', (channel, args) => {
    expect(IPC_SCHEMAS[channel as keyof typeof IPC_SCHEMAS].safeParse(args).success).toBe(false);
  });

  it('accepts valid calls', () => {
    expect(IPC_SCHEMAS['capture:start'].safeParse([{ platform: 'zoom' }]).success).toBe(true);
    expect(
      IPC_SCHEMAS['tasks:update'].safeParse([
        'mtg_1',
        'action_x',
        { status: 'completed', deadlineDate: '2026-10-01' },
      ]).success,
    ).toBe(true);
  });
});

describe('IPC entry point', () => {
  const main = { id: 'main-window' };
  const calls: unknown[][] = [];
  const handle = createIpcHandler<{ id: string }>({
    isTrusted: (sender) => sender === main,
    handlers: {
      'meetings:get': (...args: unknown[]) => {
        calls.push(args);
        if (args[0] === 'mtg_boom') throw new Error('SQLITE_CORRUPT at /home/alice/secret.db');
        return { ok: true };
      },
    },
    log: { warn: () => undefined, error: () => undefined },
    userMessage: () => ({ message: 'Something went wrong. Please try again.', code: 'internal' }),
  });

  it('refuses calls from any window other than the main window', async () => {
    expect(await handle({ id: 'capture-window' }, 'meetings:get', ['mtg_1'])).toEqual(
      expect.objectContaining({ __ipcError: true, code: 'forbidden' }),
    );
    expect(calls).toEqual([]);
  });

  it('refuses unknown channels and invalid arguments before any handler runs', async () => {
    expect(await handle(main, 'fs:readFile', ['/etc/passwd'])).toEqual(
      expect.objectContaining({ code: 'invalid' }),
    );
    expect(await handle(main, 'meetings:get', ['../../etc/passwd'])).toEqual(
      expect.objectContaining({ code: 'invalid' }),
    );
    expect(calls).toEqual([]);
  });

  it('runs valid calls and never leaks internal error details', async () => {
    expect(await handle(main, 'meetings:get', ['mtg_1'])).toEqual({ ok: true });
    const failed = (await handle(main, 'meetings:get', ['mtg_boom'])) as { message: string };
    expect(failed.message).not.toMatch(/SQLITE|secret|alice/);
  });
});

describe('preload bridges', () => {
  it('capture preload uses the same channel names as the main process', () => {
    const src = readFileSync(join(__dirname, '../src/preload/capture.ts'), 'utf8');
    expect(src).toContain(`'${CAPTURE_CHANNELS.audio}'`);
    expect(src).toContain(`'${CAPTURE_CHANNELS.event}'`);
  });

  it('built preloads are single files (sandboxed preloads cannot load chunks)', () => {
    const out = join(__dirname, '../out/preload');
    if (!existsSync(out)) return;
    for (const f of readdirSync(out).filter((x) => x.endsWith('.cjs'))) {
      expect(readFileSync(join(out, f), 'utf8')).not.toMatch(/require\("\.\//);
    }
  });
});

describe('speech model download', () => {
  function fakeRelease() {
    const src = mkdtempSync(join(tmpdir(), 'ma-release-'));
    mkdirSync(join(src, 'asr-model'), { recursive: true });
    writeFileSync(join(src, 'asr-model', 'tokens.txt'), 'a b c');
    execFileSync('tar', ['-cjf', join(src, 'asr.tar.bz2'), '-C', src, 'asr-model']);
    const archive = readFileSync(join(src, 'asr.tar.bz2'));
    const vad = Buffer.from('vad model bytes');
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    const files: ModelFile[] = [
      {
        id: 'vad',
        url: 'https://example.test/vad',
        sha256: sha(vad),
        bytes: vad.length,
        kind: 'file',
        fileName: 'vad.onnx',
      },
      {
        id: 'asr',
        url: 'https://example.test/asr',
        sha256: sha(archive),
        bytes: archive.length,
        kind: 'archive',
        dir: 'asr-model',
      },
    ];
    const bodies = new Map([
      ['https://example.test/vad', vad],
      ['https://example.test/asr', archive],
    ]);
    return {
      files,
      fetcher: async (url: string) =>
        new Response(bodies.get(url) ?? null, { status: bodies.has(url) ? 200 : 404 }),
    };
  }

  it('downloads, verifies and installs every file, and skips installed files next time', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ma-models-'));
    const { files, fetcher } = fakeRelease();
    const progress: number[] = [];
    let calls = 0;
    const counting = async (u: string) => (calls++, fetcher(u));
    await downloadFiles({
      root,
      files,
      fetcher: counting,
      signal: new AbortController().signal,
      onProgress: (d, t) => progress.push(d / t),
    });
    expect(files.every((f) => isInstalled(root, f))).toBe(true);
    expect(readFileSync(join(root, 'asr-model', 'tokens.txt'), 'utf8')).toBe('a b c');
    expect(progress.at(-1)).toBe(1);
    await downloadFiles({
      root,
      files,
      fetcher: counting,
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });
    expect(calls).toBe(2);
  });

  it('rejects a tampered download and keeps nothing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ma-models-'));
    const { files } = fakeRelease();
    const evil = async () => new Response('evil!', { status: 200 });
    await expect(
      downloadFiles({
        root,
        files,
        fetcher: evil,
        signal: new AbortController().signal,
        onProgress: () => undefined,
      }),
    ).rejects.toThrow(/integrity check/);
    expect(files.some((f) => isInstalled(root, f))).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it('reports server errors plainly', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ma-models-'));
    const { files } = fakeRelease();
    await expect(
      downloadFiles({
        root,
        files,
        fetcher: async () => new Response(null, { status: 503 }),
        signal: new AbortController().signal,
        onProgress: () => undefined,
      }),
    ).rejects.toThrow(/answered 503/);
  });

  it('can be cancelled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ma-models-'));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      downloadModel({
        root,
        model: 'moonshine-tiny-en',
        fetcher: async () => new Response('x'),
        signal: ctrl.signal,
        onProgress: () => undefined,
      }),
    ).rejects.toThrow(/cancelled/);
  });

  it('pins a SHA-256 for every real model file', () => {
    for (const f of [
      ...requiredFiles('moonshine-base-en'),
      ...requiredFiles('parakeet-v3'),
      ...requiredFiles('moonshine-tiny-en'),
    ]) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.url).toMatch(/^https:\/\/github\.com\/k2-fsa\/sherpa-onnx\/releases\/download\//);
    }
    expect(modelsReady(mkdtempSync(join(tmpdir(), 'ma-empty-')), 'moonshine-base-en')).toBe(false);
  });
});
