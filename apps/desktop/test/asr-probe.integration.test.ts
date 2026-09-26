/**
 * Transcription probe: the kinds of words meetings depend on (names, numbers, dates, a URL,
 * acronyms, technical terms), plus background noise and an interruption, spoken by the
 * free synthetic voices and transcribed by each on-device speech model. It measures; it
 * does not fail on a mishearing. Results go to MEETING_ASSISTANT_PROBE_OUT (JSON).
 *
 *   MEETING_ASSISTANT_TEST_MODELS=<dir with the speech models and the TTS model>
 *   MEETING_ASSISTANT_PROBE_OUT=<file.json> pnpm exec vitest run test/asr-probe.integration.test.ts
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SpeechEngine } from '../src/main/transcription/engine';
import { modelPaths } from '../src/main/transcription/models';
import type { ModelId } from '../src/shared/types';

const models = process.env.MEETING_ASSISTANT_TEST_MODELS;
const out = process.env.MEETING_ASSISTANT_PROBE_OUT;
const tts = models && join(models, 'vits-piper-en_US-libritts_r-medium');
const ready = Boolean(models && out && tts && existsSync(tts));

interface Probe {
  kind: string;
  text: string;
  /** Each group must be heard; any spelling in a group counts. */
  expect: string[][];
  noise?: number;
  voice?: number;
  /** Another speaker talking over the start of this line. */
  interruptedBy?: string;
}

const PROBES: Probe[] = [
  {
    kind: 'names',
    text: 'Priya and Jonathan will join the call on Wednesday.',
    expect: [['priya'], ['jonathan'], ['wednesday']],
  },
  {
    kind: 'names',
    text: 'Please send the contract to Mrs. Okafor and Mr. Lindqvist.',
    expect: [['okafor'], ['lindqvist', 'lindquist']],
  },
  {
    kind: 'numbers',
    text: 'The budget is forty two thousand five hundred dollars.',
    expect: [
      ['42,500', '42500', 'forty two thousand five hundred', 'forty-two thousand five hundred'],
    ],
  },
  {
    kind: 'numbers',
    text: 'Page load went from three point two seconds to one point eight.',
    expect: [
      ['3.2', 'three point two'],
      ['1.8', 'one point eight'],
    ],
  },
  {
    kind: 'dates',
    text: 'The deadline is October twelfth.',
    expect: [['october'], ['12', 'twelfth']],
  },
  {
    kind: 'dates',
    text: "Let's meet again on the third of November.",
    expect: [['third', '3rd'], ['november']],
  },
  {
    kind: 'url',
    text: 'The docs are at acme dot com slash help.',
    expect: [['acme'], ['com'], ['help']],
  },
  {
    kind: 'acronyms',
    text: 'The API and the CI pipeline need a QA review.',
    expect: [
      ['api', 'a p i'],
      ['ci', 'c i', 'c.i.'],
      ['qa', 'q a', 'q.a.'],
    ],
  },
  {
    kind: 'acronyms',
    text: 'Our KPI for the MVP is the weekly active users.',
    expect: [
      ['kpi', 'k p i'],
      ['mvp', 'm v p'],
    ],
  },
  {
    kind: 'technical',
    text: 'We need to rotate the TLS certificates on the Kubernetes cluster.',
    expect: [['tls', 't l s'], ['kubernetes'], ['certificate']],
  },
  {
    kind: 'technical',
    text: 'The Postgres migration failed because of a foreign key constraint.',
    expect: [['postgres'], ['migration'], ['foreign key']],
  },
  {
    kind: 'noise',
    text: "Let's ship the update on Thursday.",
    expect: [['ship'], ['update'], ['thursday']],
    noise: 0.04,
  },
  {
    kind: 'noise',
    text: "I'll update the firewall rule by Friday.",
    expect: [['firewall', 'fire wall'], ['friday']],
    noise: 0.04,
  },
  {
    kind: 'interruption',
    text: "I'll send the report to finance by Monday.",
    expect: [['report'], ['finance'], ['monday']],
    interruptedBy: 'Sorry, go ahead.',
  },
];

const MODELS: ModelId[] = ['moonshine-base-en', 'parakeet-v3'];

describe.skipIf(!ready)('transcription probe (measurement)', () => {
  it('measures each model on names, numbers, dates, URLs, acronyms, noise, interruptions', async () => {
    const require = createRequire(__filename);
    const sherpa = require('sherpa-onnx-node');
    const synth = new sherpa.OfflineTts({
      model: {
        vits: {
          model: `${tts}/en_US-libritts_r-medium.onnx`,
          tokens: `${tts}/tokens.txt`,
          dataDir: `${tts}/espeak-ng-data`,
          noiseScale: 0.0001,
          noiseScaleW: 0.0001,
        },
        numThreads: 2,
      },
    });
    const to16k = (s: Float32Array) =>
      new sherpa.LinearResampler(synth.sampleRate, 16000).flush(s) as Float32Array;
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff - 0.5;
    };
    const audio = PROBES.map((p, i) => {
      const main = to16k(
        synth.generate({ text: p.text, sid: [10, 200, 450, 700][i % 4], speed: 1 }).samples,
      );
      const pad = new Float32Array(16000 * 0.6);
      let clip = new Float32Array(pad.length * 2 + main.length);
      clip.set(main, pad.length);
      if (p.interruptedBy) {
        const other = to16k(synth.generate({ text: p.interruptedBy, sid: 88, speed: 1.1 }).samples);
        for (let k = 0; k < other.length && pad.length - 4000 + k < clip.length; k++)
          clip[pad.length - 4000 + k]! += other[k]! * 0.8;
      }
      if (p.noise) clip = clip.map((v) => v + rand() * p.noise!);
      return clip;
    });

    const results: Record<string, unknown>[] = [];
    for (const model of MODELS) {
      const engine = await SpeechEngine.create(modelPaths(models!, model), {
        speakerLabels: false,
      });
      PROBES.forEach((p, i) => {
        const segs = [];
        const a = audio[i]!;
        for (let k = 0; k < a.length; k += 1600)
          segs.push(...engine.push('system', a.subarray(k, k + 1600)));
        segs.push(...engine.flush());
        const heard = segs.map((s) => s.text).join(' ');
        const lower = heard.toLowerCase();
        const missed = p.expect.filter((g) => !g.some((w) => lower.includes(w)));
        results.push({
          model,
          kind: p.kind,
          said: p.text,
          heard,
          ok: missed.length === 0,
          missed: missed.map((g) => g[0]),
        });
      });
    }
    writeFileSync(out!, JSON.stringify(results, null, 2));
    expect(results.length).toBe(PROBES.length * MODELS.length);
  }, 600_000);
});
