import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fakeInstallModels,
  FakeTranscriber,
  makeHarness,
  waitFor,
  tick,
  type Harness,
} from './helpers';
import { TEST_ENV } from './helpers';
import type { CaptureStatus } from '../src/shared/types';

let h: Harness;
afterEach(async () => h?.cleanup());

const call = <T>(name: string, ...args: unknown[]): Promise<T> =>
  Promise.resolve(
    (h.services.handlers() as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(
      ...args,
    ),
  ) as Promise<T>;

describe('choosing the notes engine (free by default)', () => {
  async function runSample(): Promise<{
    engine: string;
    warnings: string[];
    owners: (string | null)[];
  }> {
    const started = await call<CaptureStatus>('capture:start', { source: 'demo' });
    const id = started.meetingId!;
    await call<CaptureStatus>('capture:stop');
    await waitFor(() =>
      h.events.some((e) => e.type === 'processing' && e.meetingId === id && e.info === null),
    );
    const d = await call<{
      notes: {
        engine: { kind: string };
        warnings: string[];
        actionItems: { owner: string | null }[];
      };
    }>('meetings:get', id);
    return {
      engine: d.notes.engine.kind,
      warnings: d.notes.warnings,
      owners: d.notes.actionItems.map((a) => a.owner),
    };
  }

  it('runs the full AI path with the mock provider, no network or key', async () => {
    h = makeHarness({ env: { ...TEST_ENV, aiOverride: { provider: 'mock' } } });
    const r = await runSample();
    expect(r.engine).toBe('mock');
    expect(r.owners).toEqual(['David Wilson', 'Bob Smith']);
  });

  it('falls back to the offline engine when the local AI server is not running', async () => {
    h = makeHarness();
    await call('settings:update', {
      ai: { mode: 'local', localUrl: 'http://127.0.0.1:1/v1', localModel: 'llama3.1:8b' },
    });
    const r = await runSample();
    expect(r.engine).toBe('rules');
    expect(r.warnings.join(' ')).toMatch(/made on this device instead/);
    expect(r.owners).toEqual(['David Wilson', 'Bob Smith']);
  });

  it('never needs a Claude key: choosing Claude without one uses the offline engine', async () => {
    h = makeHarness();
    await call('settings:update', { ai: { mode: 'claude' } });
    const r = await runSample();
    expect(r.engine).toBe('rules');
    expect(r.warnings.join(' ')).toMatch(/requires provider credentials/);
  });
});

describe('sample meeting end to end (no microphone)', () => {
  it('captures, stops, analyzes and drafts an email', async () => {
    h = makeHarness();
    const started = await call<CaptureStatus>('capture:start', { source: 'demo' });
    expect(started.state).toBe('capturing');
    expect(h.backend().calls).toEqual(['startDemo']);
    const id = started.meetingId!;
    const stopped = await call<CaptureStatus>('capture:stop');
    expect(stopped.state).toBe('idle');
    await waitFor(() =>
      h.events.some((e) => e.type === 'processing' && e.meetingId === id && e.info === null),
    );
    const detail = await call<{
      summary: { status: string; isSample: boolean };
      notes: {
        actionItems: { owner: string | null; task: string }[];
        decisions: { text: string; status: string }[];
      };
    }>('meetings:get', id);
    expect(detail.summary).toMatchObject({ status: 'ready', isSample: true });
    expect(detail.notes.decisions.find((d) => d.status === 'confirmed')?.text).toMatch(/monday/i);
    expect(detail.notes.actionItems.map((a) => a.owner)).toEqual(['David Wilson', 'Bob Smith']);
    const stages = h.events
      .filter((e) => e.type === 'processing' && e.meetingId === id && e.info)
      .map((e) => (e.type === 'processing' ? e.info!.stage : ''));
    expect(stages).toEqual(
      expect.arrayContaining(['preparing', 'analyzing', 'checking', 'drafting']),
    );
  });

  it('clicking Start twice creates one meeting', async () => {
    h = makeHarness();
    const [a, b] = await Promise.all([
      call<CaptureStatus>('capture:start', { source: 'demo' }),
      call<CaptureStatus>('capture:start', { source: 'demo' }),
    ]);
    expect(a.meetingId).toBe(b.meetingId);
    await call('capture:stop');
    await call('capture:stop');
    expect((await call<unknown[]>('meetings:list')).length).toBe(1);
  });

  it('pause and resume stop the clock and are reported', async () => {
    h = makeHarness();
    await call('capture:start', { source: 'demo' });
    const p = await call<CaptureStatus>('capture:pause');
    expect(p.state).toBe('paused');
    const e1 = p.elapsedMs;
    await tick(60);
    expect((await call<CaptureStatus>('capture:status')).elapsedMs).toBe(e1);
    expect((await call<CaptureStatus>('capture:resume')).state).toBe('capturing');
    expect(h.backend().calls).toEqual(['startDemo', 'pause', 'resume']);
  });
});

describe('live capture', () => {
  it('saves audio and transcript lines as they arrive, then processes', async () => {
    h = makeHarness({
      transcriber: () =>
        new FakeTranscriber({
          lines: [
            {
              channel: 'system',
              startMs: 1000,
              endMs: 3000,
              text: "I'll send the budget report to Carol by Friday.",
              speakerKey: 'spk-1',
            },
            {
              channel: 'mic',
              startMs: 3500,
              endMs: 5000,
              text: 'Great, thanks.',
              speakerKey: 'mic',
            },
          ],
        }),
    });
    fakeInstallModels(h.dir);
    const s = await call<CaptureStatus>('capture:start', {});
    expect(h.backend().calls).toEqual(['startLive']);
    const loud = new Float32Array(1600).fill(0.2);
    for (let i = 0; i < 10; i++) {
      h.services.session.ingest('mic', loud);
      h.services.session.ingest('system', loud);
    }
    await waitFor(() => h.transcribers[0]!.started);
    h.services.session.ingest('system', loud);
    const status = h.services.session.status();
    expect(status.mic.receiving).toBe(true);
    expect(status.system.level).toBeGreaterThan(0);
    const audioDir = join(h.dir, 'audio', s.meetingId!);
    expect(readFileSync(join(audioDir, 'mic.pcm')).length).toBe(10 * 1600 * 2);
    await call('capture:stop');
    await waitFor(() =>
      h.events.some(
        (e) => e.type === 'processing' && e.meetingId === s.meetingId && e.info === null,
      ),
    );
    const d = await call<{
      segments: { speaker: string; text: string }[];
      notes: { actionItems: { owner: string | null; deadline: { date: string } | null }[] };
    }>('meetings:get', s.meetingId);
    expect(d.segments.map((x) => x.speaker)).toEqual(['Speaker 1', 'You']);
    // "by Friday" said on a Friday is ambiguous: next Friday, flagged for review.
    expect(d.notes.actionItems[0]).toMatchObject({
      owner: 'Speaker 1',
      needsReview: true,
      deadline: { date: '2026-10-02', needsReview: true },
    });
    // Raw audio is deleted after processing by default.
    expect(existsSync(audioDir)).toBe(false);
  });

  it('records audio when the speech engine is missing, and says so', async () => {
    h = makeHarness();
    const s = await call<CaptureStatus>('capture:start', {});
    expect(s.problems.map((p) => p.code)).toContain('models_missing');
    h.services.session.ingest('mic', new Float32Array(1600).fill(0.1));
    await call('capture:stop');
    await tick(50);
    const d = await call<{ summary: { status: string }; processing: { stage: string } }>(
      'meetings:get',
      s.meetingId,
    );
    expect(d.summary.status).toBe('processing');
    expect(d.processing.stage).toBe('waiting-for-speech-engine');
    expect(existsSync(join(h.dir, 'audio', s.meetingId!, 'mic.pcm'))).toBe(true);
  });

  it('reports lost audio instead of pretending everything is fine', async () => {
    h = makeHarness();
    fakeInstallModels(h.dir);
    await call('capture:start', {});
    h.services.session.ingest('system', new Float32Array(1600).fill(0.2));
    h.services.session.channelEnded('system');
    const st = h.services.session.status();
    expect(st.system.receiving).toBe(false);
    expect(st.problems.find((p) => p.code === 'system_audio_lost')?.message).toBe(
      'Meeting audio is no longer being captured.',
    );
    h.services.session.channelFailed(
      'mic',
      'mic_denied',
      'Microphone access is off, so your own voice is not being captured.',
    );
    expect(h.services.session.status().mic.enabled).toBe(false);
  });

  it('says when meeting audio never arrived, rather than that it was lost', async () => {
    h = makeHarness();
    fakeInstallModels(h.dir);
    await call('capture:start', {});
    h.services.session.channelEnded('system');
    const st = h.services.session.status();
    expect(st.system.problem).toMatch(/^No meeting audio is coming through/);
    expect(st.problems.find((p) => p.code === 'system_audio_lost')?.message).toMatch(
      /^No meeting audio is coming through/,
    );
  });

  it('keeps recording audio when live transcription crashes', async () => {
    h = makeHarness();
    fakeInstallModels(h.dir);
    await call('capture:start', {});
    await waitFor(() => h.transcribers[0]?.started === true);
    h.transcribers[0]!.crash('boom');
    expect(h.services.session.status().problems.map((p) => p.code)).toContain('transcriber_failed');
    h.services.session.ingest('mic', new Float32Array(1600).fill(0.1));
    expect(h.transcribers[0]!.pushed.mic).toBe(0);
  });

  it('never claims to hear the meeting when no audio is arriving', async () => {
    h = makeHarness();
    fakeInstallModels(h.dir);
    const session = h.services.session;
    await call('capture:start', {});
    expect(session.status().hearing).toBe('starting');
    session.channelFailed('mic', 'mic_denied', 'Microphone access is off.');
    session.channelEnded('system');
    expect(session.status().state).toBe('capturing');
    expect(session.status().hearing).toBe('none');

    // Case E: access allowed afterwards, then "Try again" without stopping the meeting.
    const after = await call<CaptureStatus>('capture:retryAudio');
    expect(h.backend().calls).toContain('retry');
    expect(after.mic.enabled).toBe(true);
    expect(after.problems.map((p) => p.code)).not.toContain('mic_denied');
    session.ingest('mic', new Float32Array(1600).fill(0.1));
    expect(session.status().hearing).toBe('partial');
    session.ingest('system', new Float32Array(1600).fill(0.1));
    expect(session.status().hearing).toBe('ok');
    expect(existsSync(join(h.dir, 'audio', after.meetingId!, 'mic.pcm'))).toBe(true);
  });

  it('clears the notice when an unplugged source comes back', async () => {
    h = makeHarness();
    fakeInstallModels(h.dir);
    const session = h.services.session;
    await call('capture:start', {});
    session.ingest('mic', new Float32Array(1600).fill(0.1));
    session.channelEnded('mic');
    expect(session.status().problems.map((p) => p.code)).toContain('mic_lost');
    expect(session.failedChannels()).toEqual(['mic']);
    session.channelStarted('mic');
    session.ingest('mic', new Float32Array(1600).fill(0.1));
    expect(session.status().problems.map((p) => p.code)).not.toContain('mic_lost');
    expect(session.failedChannels()).toEqual([]);
  });

  it('notices a microphone that only sends silence (muted or access removed)', async () => {
    h = makeHarness();
    fakeInstallModels(h.dir);
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      const session = h.services.session;
      await call('capture:start', {});
      session.ingest('mic', new Float32Array(1600).fill(0.1));
      session.ingest('system', new Float32Array(1600).fill(0.1));
      for (let i = 0; i < 32; i++) {
        vi.advanceTimersByTime(1000);
        session.ingest('mic', new Float32Array(1600));
        session.ingest('system', new Float32Array(1600).fill(0.1));
      }
      const st = session.status();
      expect(st.problems.find((p) => p.code === 'mic_muted')?.message).toMatch(/sent no sound/);
      expect(st.hearing).toBe('partial');
      session.ingest('mic', new Float32Array(1600).fill(0.1));
      expect(session.status().problems.map((p) => p.code)).not.toContain('mic_muted');
    } finally {
      vi.useRealTimers();
    }
  });

  it('suggests stopping when the meeting window closes, but never stops by itself', async () => {
    h = makeHarness();
    fakeInstallModels(h.dir);
    await call('capture:start', {});
    h.services.session.meetingWindowGone(true);
    const st = h.services.session.status();
    expect(st.state).toBe('capturing');
    expect(st.problems.find((p) => p.code === 'meeting_ended')?.action?.kind).toBe('stop');
    h.services.session.meetingWindowGone(false);
    expect(h.services.session.status().problems).toEqual([]);
  });
});

describe('crash recovery and retention', () => {
  it('marks meetings left in capture as interrupted and recovers them', async () => {
    h = makeHarness();
    const s = await call<CaptureStatus>('capture:start', { source: 'demo' });
    // Simulate a crash: close without stopping, then start a new app instance on the same data.
    h.services.db.close();
    const crashedDir = h.dir;
    const h2 = makeHarness({ dir: crashedDir });
    h = h2;
    const { interrupted } = await h2.services.startup();
    expect(interrupted).toEqual([s.meetingId]);
    const handlers = h2.services.handlers() as unknown as Record<
      string,
      (...a: unknown[]) => unknown
    >;
    expect((handlers['meetings:list']!() as { status: string }[])[0]!.status).toBe('interrupted');
    handlers['meetings:recover']!(s.meetingId);
    await waitFor(
      () => (handlers['meetings:list']!() as { status: string }[])[0]!.status === 'ready',
    );
    const d = handlers['meetings:get']!(s.meetingId) as { segments: unknown[]; notes: unknown };
    expect(d.segments.length).toBeGreaterThan(10);
    expect(d.notes).toBeTruthy();
  });

  it('quitting mid-meeting saves it and finishes it on the next launch (regression)', async () => {
    h = makeHarness();
    fakeInstallModels(h.dir);
    const s = await call<CaptureStatus>('capture:start', {});
    await waitFor(() => h.transcribers[0]?.started === true);
    h.transcribers[0]!.crash('boom');
    h.services.session.ingest('mic', new Float32Array(1600).fill(0.1));
    await h.services.shutdown();
    const h2 = makeHarness({ dir: h.dir });
    h = h2;
    await h2.services.startup();
    const handlers = h2.services.handlers() as unknown as Record<
      string,
      (...a: unknown[]) => unknown
    >;
    await waitFor(
      () =>
        (handlers['meetings:list']!() as { id: string; status: string }[]).find(
          (m) => m.id === s.meetingId,
        )?.status === 'ready',
    );
  });

  it('deletes all data on request', async () => {
    h = makeHarness();
    await call('data:loadSamples');
    expect((await call<unknown[]>('meetings:list')).length).toBe(16);
    await call('data:deleteAll', 'DELETE');
    expect(await call('meetings:list')).toEqual([]);
    expect(await call('tasks:list', { scope: 'all', status: 'all' })).toEqual([]);
  });
});

describe('sample data, tasks, search and email', () => {
  it('loads clearly marked samples and removes them again', async () => {
    h = makeHarness();
    await call('data:loadSamples');
    await call('data:loadSamples');
    const list = await call<{ isSample: boolean }[]>('meetings:list');
    expect(list).toHaveLength(16);
    expect(list.every((m) => m.isSample)).toBe(true);
    expect((await call<{ profile: { name: string } }>('settings:get')).profile.name).toBe(
      'Alice Johnson',
    );
    await call('data:removeSamples');
    expect(await call('meetings:list')).toEqual([]);
    expect((await call<{ profile: { name: string } }>('settings:get')).profile.name).toBe('');
  });

  it('answers questions from meeting memory with sources', async () => {
    h = makeHarness();
    await call('data:loadSamples');
    const r = await call<{
      hits: unknown[];
      answer: { found: boolean; items: { meetingTitle: string; text: string }[] };
    }>('search:query', 'What did we decide about deployment?');
    expect(r.answer.found).toBe(true);
    expect(
      r.answer.items.some(
        (i) => i.meetingTitle === 'Project Phoenix Weekly' && /monday/i.test(i.text),
      ),
    ).toBe(true);
    const mine = await call<{ answer: { items: { owner: string }[] } }>(
      'search:query',
      'What tasks were assigned to me?',
    );
    expect(mine.answer.items.every((i) => i.owner === 'Alice Johnson')).toBe(true);
    const plain = await call<{ hits: unknown[]; answer: null }>('search:query', 'firewall');
    expect(plain.answer).toBeNull();
    expect(plain.hits.length).toBeGreaterThan(0);
  });

  it('never claims an email was sent in test mode', async () => {
    h = makeHarness();
    await call('data:loadSamples');
    const id = 'sample_client-kickoff';
    const draft = await call<{ to: { email: string; external: boolean }[] }>('email:get', id);
    expect(draft.to.find((r) => r.email === 'eva.brown@globex.example.test')?.external).toBe(true);
    const res = await call<{ status: string; message: string }>('email:open', id);
    expect(res.status).toBe('mock_sent');
    expect(res.message).toMatch(/No email was sent/);
    const outbox = readdirSync(join(h.dir, 'test-outbox'));
    expect(outbox).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(h.dir, 'test-outbox', outbox[0]!), 'utf8')).note).toBe(
      'MOCK: not sent',
    );
    expect(h.opened).toEqual([]);
  });

  it('refuses keys that do not look like Claude keys, and stores real ones encrypted', async () => {
    h = makeHarness();
    const bad = await call<{ stored: boolean }>('settings:setClaudeKey', 'hello');
    expect(bad.stored).toBe(false);
    const key = 'sk-ant-' + 'a'.repeat(40);
    const ok = await call<{ stored: boolean; persistent: boolean }>('settings:setClaudeKey', key);
    expect(ok).toMatchObject({ stored: true, persistent: true });
    const raw = (
      h.services.db
        .prepare("SELECT value FROM settings WHERE key = 'secret:claude-api-key'")
        .get() as { value: string }
    ).value;
    expect(raw).not.toContain(key);
    expect((await call<{ ai: { hasClaudeKey: boolean } }>('settings:get')).ai.hasClaudeKey).toBe(
      true,
    );
  });
});
