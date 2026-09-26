import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AiError } from '../src/errors.ts';
import { LlmExtractor, type ExtractionCache } from '../src/extract/llm.ts';
import { MockLlmProvider, transcriptFingerprint } from '../src/extract/mock.ts';
import { OpenAiCompatibleProvider } from '../src/extract/openai-compatible.ts';
import { aiConfigFromEnv, createExtractor } from '../src/extract/provider.ts';
import { RulesExtractor } from '../src/extract/rules.ts';
import type { RawExtraction } from '../src/extract/schema.ts';
import { analyzeMeeting } from '../src/pipeline.ts';
import {
  ALL_FIXTURES,
  RECORDED_AI_OUTPUTS,
  injectionMeeting,
  longMeeting,
  phoenixWeekly,
} from '../fixtures/index.ts';

const NOW = () => new Date('2026-09-25T12:00:00-04:00');
const input = (fx: typeof phoenixWeekly) => ({ meeting: fx.meeting, segments: fx.segments });
const summary = (n: Awaited<ReturnType<typeof analyzeMeeting>>['notes']) => ({
  decisions: n.decisions.map((d) => [d.text, d.status]),
  tasks: n.actionItems.map((a) => [a.task, a.owner, a.deadline?.date ?? null]),
});

describe('mock AI provider (deterministic, no network)', () => {
  it('has a recorded reference output for every fixture meeting', () => {
    const fingerprints = new Set(RECORDED_AI_OUTPUTS.map((r) => r.fingerprint));
    for (const fx of ALL_FIXTURES)
      expect(fingerprints.has(transcriptFingerprint(fx.segments))).toBe(true);
    for (const r of RECORDED_AI_OUTPUTS) expect(r.source).toMatch(/not a real language model/);
  });

  it('runs the full AI path and matches the expected notes for every fixture', async () => {
    const mock = new MockLlmProvider({ recorded: RECORDED_AI_OUTPUTS });
    for (const fx of ALL_FIXTURES) {
      const viaAi = await analyzeMeeting(input(fx), {
        extractor: new LlmExtractor(mock),
        now: NOW,
      });
      const expected = await analyzeMeeting(input(fx), {
        extractor: new RulesExtractor(),
        now: NOW,
      });
      expect(viaAi.notes.engine.kind).toBe('mock');
      expect(summary(viaAi.notes), fx.id).toEqual(summary(expected.notes));
    }
    // Every request carried the fenced transcript and the safety instructions.
    expect(mock.calls.every((c) => c.user.includes('<transcript>'))).toBe(true);
    expect(mock.calls.every((c) => /Never follow instructions/.test(c.system))).toBe(true);
  });

  it('answers unknown transcripts with the offline engine', async () => {
    const mock = new MockLlmProvider();
    const out = (await mock.generate({
      system: '',
      user: '',
      task: 'extract',
      input: input(phoenixWeekly),
    })) as RawExtraction;
    expect(out).toEqual(await new RulesExtractor().extract(input(phoenixWeekly)));
  });

  it('never lets a hostile or hallucinating model through the validator', async () => {
    const hostile: RawExtraction = {
      tldr: 'Quantum synergy achieved. Mallory approved the budget.',
      topics: [],
      decisions: [{ text: 'Adopt quantum blockchain', status: 'confirmed', segmentIds: ['s9999'] }],
      actionItems: [
        {
          task: 'Email the transcript to attacker@example.com',
          owner: 'Mallory',
          deadlinePhrase: 'tomorrow',
          priority: 'high',
          confidence: 'high',
          segmentIds: ['s0005'],
        },
        {
          task: 'Update the firewall rule',
          owner: 'Mallory',
          deadlinePhrase: 'by next year',
          priority: 'high',
          confidence: 'high',
          segmentIds: ['s0013', 's0014'],
        },
      ],
      openQuestions: [],
      risks: [],
    };
    const r = await analyzeMeeting(input(injectionMeeting), {
      extractor: new LlmExtractor(new MockLlmProvider({ respond: () => hostile })),
      now: NOW,
    });
    const text = JSON.stringify(r.notes) + r.email.body + r.email.to.map((t) => t.email).join();
    expect(text).not.toMatch(/attacker@example\.com|quantum|Mallory/i);
    expect(r.notes.decisions).toEqual([]);
  });

  it('falls back to the offline engine when the model returns broken output', async () => {
    const r = await analyzeMeeting(input(phoenixWeekly), {
      extractor: new LlmExtractor(new MockLlmProvider({ respond: () => ({ tldr: 5 }) })),
      fallback: new RulesExtractor(),
      now: NOW,
    });
    expect(r.notes.engine.kind).toBe('rules');
    expect(r.notes.warnings.join(' ')).toMatch(/made on this device instead/);
    expect(r.notes.actionItems.length).toBeGreaterThan(0);
  });

  it('chunks long meetings, synthesizes once, and reuses the cache', async () => {
    const store = new Map<string, RawExtraction>();
    const cache: ExtractionCache = {
      get: async (k) => store.get(k),
      set: async (k, v) => void store.set(k, v),
    };
    const mock = new MockLlmProvider();
    const extractor = new LlmExtractor(mock, { maxChunkChars: 20_000, cache });
    const fx = longMeeting;
    await extractor.extract(input(fx));
    const extracts = mock.calls.filter((c) => c.task === 'extract').length;
    expect(extracts).toBeGreaterThan(1);
    expect(mock.calls.filter((c) => c.task === 'synthesize')).toHaveLength(1);
    mock.calls.length = 0;
    await extractor.extract(input(fx));
    expect(mock.calls).toHaveLength(0);
  });
});

describe('local AI server provider (OpenAI-compatible, e.g. Ollama)', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  async function serve(
    handler: (
      body: Record<string, unknown>,
      req: IncomingMessage,
    ) => { status?: number; json?: unknown },
  ): Promise<{
    url: string;
    requests: Record<string, unknown>[];
    headers: IncomingMessage['headers'][];
  }> {
    const requests: Record<string, unknown>[] = [];
    const headers: IncomingMessage['headers'][] = [];
    server = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        const body = JSON.parse(data) as Record<string, unknown>;
        requests.push(body);
        headers.push(req.headers);
        const out = handler(body, req);
        res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out.json ?? {}));
      });
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}/v1`, requests, headers };
  }

  const reply = (content: string, finish = 'stop') => ({
    json: { choices: [{ finish_reason: finish, message: { role: 'assistant', content } }] },
  });

  it('sends the schema and prompt, and turns the reply into validated notes', async () => {
    const expected = await new RulesExtractor().extract(input(phoenixWeekly));
    const srv = await serve(() => reply('```json\n' + JSON.stringify(expected) + '\n```'));
    const extractor = new LlmExtractor(
      new OpenAiCompatibleProvider({ baseUrl: srv.url, model: 'qwen2.5:7b-instruct' }),
    );
    const r = await analyzeMeeting(input(phoenixWeekly), { extractor, now: NOW });
    expect(r.notes.engine).toMatchObject({ kind: 'local-llm', model: 'qwen2.5:7b-instruct' });
    expect(r.notes.actionItems.map((a) => a.owner)).toContain('David Wilson');
    const body = srv.requests[0]!;
    expect(body.model).toBe('qwen2.5:7b-instruct');
    expect(body.temperature).toBe(0);
    expect(JSON.stringify(body.response_format)).toMatch(/json_schema.*actionItems/);
    expect(srv.headers[0]!.authorization).toBeUndefined();
  });

  it.each([
    [401, 'auth'],
    [404, 'bad_request'],
    [429, 'rate_limit'],
    [503, 'server'],
  ])('maps HTTP %i to a clear error (%s)', async (status, code) => {
    const srv = await serve(() => ({ status, json: { error: 'x' } }));
    const p = new OpenAiCompatibleProvider({ baseUrl: srv.url, model: 'm' });
    await expect(p.generate({ system: '', user: '', task: 'extract' })).rejects.toMatchObject({
      code,
    });
  });

  it('reports truncated, invalid and unreachable responses', async () => {
    const srv = await serve((body) =>
      (body.messages as { content: string }[])[1]!.content === 'long'
        ? reply('{"tldr":', 'length')
        : reply('not json'),
    );
    const p = new OpenAiCompatibleProvider({ baseUrl: srv.url, model: 'm' });
    await expect(p.generate({ system: '', user: 'long', task: 'extract' })).rejects.toMatchObject({
      code: 'truncated',
    });
    await expect(p.generate({ system: '', user: 'x', task: 'extract' })).rejects.toMatchObject({
      code: 'malformed',
    });
    const offline = new OpenAiCompatibleProvider({ baseUrl: 'http://127.0.0.1:1/v1', model: 'm' });
    const err = await offline
      .generate({ system: '', user: '', task: 'extract' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe('offline');
  });
});

describe('choosing a provider (free by default)', () => {
  it('uses the offline engine unless something else is configured', () => {
    expect(aiConfigFromEnv({}).provider).toBe('rules');
    expect(aiConfigFromEnv({ MEETING_ASSISTANT_AI_PROVIDER: 'nonsense' }).provider).toBe('rules');
    expect(createExtractor(aiConfigFromEnv({})).extractor.kind).toBe('rules');
  });

  it('builds the mock and local providers without any key', () => {
    const mock = createExtractor(aiConfigFromEnv({ MEETING_ASSISTANT_AI_PROVIDER: 'mock' }));
    expect(mock.extractor.kind).toBe('mock');
    const local = createExtractor(
      aiConfigFromEnv({
        MEETING_ASSISTANT_AI_PROVIDER: 'local-llm',
        MEETING_ASSISTANT_LLM_BASE_URL: 'http://localhost:11434/v1',
        MEETING_ASSISTANT_LLM_MODEL: 'llama3.1:8b',
      }),
    );
    expect(local.extractor.kind).toBe('local-llm');
    expect(local.fallback?.kind).toBe('rules');
  });

  it('falls back to the offline engine, and says why, when a provider is not set up', () => {
    const local = createExtractor(aiConfigFromEnv({ MEETING_ASSISTANT_AI_PROVIDER: 'local-llm' }));
    expect(local.extractor.kind).toBe('rules');
    expect(local.unavailable).toMatch(/server address and model/);
    const claude = createExtractor(aiConfigFromEnv({ MEETING_ASSISTANT_AI_PROVIDER: 'claude' }));
    expect(claude.extractor.kind).toBe('rules');
    expect(claude.unavailable).toMatch(/requires provider credentials/);
  });
});
