import { join } from 'node:path';
import type * as Sherpa from 'sherpa-onnx-node';
import type { ModelPaths } from './models';

export const SAMPLE_RATE = 16_000;
const VAD_WINDOW = 512;
const MIN_EMBED_SAMPLES = SAMPLE_RATE * 0.8;
/** Online threshold for live labels (cosine similarity to a voice profile). */
const SAME_SPEAKER = 0.72;
/** Final end-of-meeting clustering threshold (average linkage). */
export const FINAL_SAME_SPEAKER = 0.75;
const MAX_FINAL_SEGMENTS = 400;
const MAX_SPEAKERS = 12;

export interface SpeakerLabel {
  startMs: number;
  speakerKey: string;
}

export interface EngineSegment {
  channel: 'mic' | 'system';
  startMs: number;
  endMs: number;
  text: string;
  speakerKey: string;
}

interface ChannelState {
  vad: Sherpa.Vad;
  /** Samples waiting to fill a VAD window. */
  carry: Float32Array;
}

interface Speaker {
  key: string;
  centroid: Float32Array;
  count: number;
}

async function loadSherpa(): Promise<typeof Sherpa> {
  const mod = (await import('sherpa-onnx-node')) as unknown as {
    default?: typeof Sherpa;
  } & typeof Sherpa;
  return mod.default ?? mod;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return d / (Math.sqrt(na * nb) + 1e-9);
}

/** Speech that the recognizer sometimes produces for noise or silence. */
const NOISE_ONLY = /^[\s.,!?'"-]*$|^(?:um+|uh+|hmm+|mm+|ah+)[.!?]*$/i;

/**
 * On-device speech: voice activity detection per channel, offline
 * recognition per speech segment, and speaker labels from online clustering
 * of speaker embeddings on the meeting-audio channel.
 */
export class SpeechEngine {
  private readonly channels = new Map<string, ChannelState>();
  private readonly speakers: Speaker[] = [];
  private lastSpeaker: string | null = null;
  /** Every meeting-audio segment with its voice embedding, for the final pass. */
  private readonly voices: { startMs: number; samples: number; emb: Float32Array | null }[] = [];

  private constructor(
    private readonly sherpa: typeof Sherpa,
    private readonly paths: ModelPaths,
    private readonly recognizer: Sherpa.OfflineRecognizer,
    private readonly embedder: Sherpa.SpeakerEmbeddingExtractor | null,
    private readonly numThreads: number,
  ) {}

  static async create(
    paths: ModelPaths,
    opts: { numThreads?: number; speakerLabels?: boolean } = {},
  ): Promise<SpeechEngine> {
    const sherpa = await loadSherpa();
    const numThreads = opts.numThreads ?? 2;
    const d = paths.asrDir;
    const modelConfig =
      paths.engine === 'moonshine'
        ? {
            moonshine: {
              preprocessor: join(d, 'preprocess.onnx'),
              encoder: join(d, 'encode.int8.onnx'),
              uncachedDecoder: join(d, 'uncached_decode.int8.onnx'),
              cachedDecoder: join(d, 'cached_decode.int8.onnx'),
            },
            tokens: join(d, 'tokens.txt'),
          }
        : {
            transducer: {
              encoder: join(d, 'encoder.int8.onnx'),
              decoder: join(d, 'decoder.int8.onnx'),
              joiner: join(d, 'joiner.int8.onnx'),
            },
            modelType: 'nemo_transducer',
            tokens: join(d, 'tokens.txt'),
          };
    const recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: { ...modelConfig, numThreads, provider: 'cpu', debug: 0 },
    });
    const embedder =
      opts.speakerLabels === false
        ? null
        : new sherpa.SpeakerEmbeddingExtractor({
            model: paths.speaker,
            numThreads: 1,
            provider: 'cpu',
            debug: 0,
          });
    return new SpeechEngine(sherpa, paths, recognizer, embedder, numThreads);
  }

  private channel(name: 'mic' | 'system'): ChannelState {
    let ch = this.channels.get(name);
    if (!ch) {
      const vad = new this.sherpa.Vad(
        {
          sileroVad: {
            model: this.paths.vad,
            threshold: 0.5,
            minSpeechDuration: 0.25,
            minSilenceDuration: 0.5,
            maxSpeechDuration: 20,
            windowSize: VAD_WINDOW,
          },
          sampleRate: SAMPLE_RATE,
          numThreads: 1,
          provider: 'cpu',
          debug: false,
        },
        120,
      );
      ch = { vad, carry: new Float32Array(0) };
      this.channels.set(name, ch);
    }
    return ch;
  }

  /** Feed 16 kHz mono audio; returns any segments that finished. */
  push(channel: 'mic' | 'system', samples: Float32Array): EngineSegment[] {
    const ch = this.channel(channel);
    const all = new Float32Array(ch.carry.length + samples.length);
    all.set(ch.carry);
    all.set(samples, ch.carry.length);
    let i = 0;
    for (; i + VAD_WINDOW <= all.length; i += VAD_WINDOW)
      ch.vad.acceptWaveform(all.subarray(i, i + VAD_WINDOW));
    ch.carry = all.slice(i);
    return this.drain(channel, ch);
  }

  /** Finish any speech still buffered (end of meeting or pause). */
  flush(): EngineSegment[] {
    const out: EngineSegment[] = [];
    for (const [name, ch] of this.channels) {
      if (ch.carry.length) {
        const padded = new Float32Array(VAD_WINDOW);
        padded.set(ch.carry);
        ch.vad.acceptWaveform(padded);
        ch.carry = new Float32Array(0);
      }
      ch.vad.flush();
      out.push(...this.drain(name as 'mic' | 'system', ch));
    }
    return out.sort((a, b) => a.startMs - b.startMs);
  }

  private drain(channel: 'mic' | 'system', ch: ChannelState): EngineSegment[] {
    const out: EngineSegment[] = [];
    while (!ch.vad.isEmpty()) {
      const seg = ch.vad.front();
      ch.vad.pop();
      const text = this.recognize(seg.samples);
      if (!text || NOISE_ONLY.test(text)) continue;
      const startMs = Math.round((seg.start / SAMPLE_RATE) * 1000);
      out.push({
        channel,
        startMs,
        endMs: Math.round(((seg.start + seg.samples.length) / SAMPLE_RATE) * 1000),
        text,
        speakerKey: channel === 'mic' ? 'mic' : this.identify(seg.samples, startMs),
      });
    }
    return out;
  }

  private recognize(samples: Float32Array): string {
    const stream = this.recognizer.createStream();
    stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
    this.recognizer.decode(stream);
    return this.recognizer.getResult(stream).text.trim();
  }

  private embed(samples: Float32Array): Float32Array {
    const stream = this.embedder!.createStream();
    stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
    stream.inputFinished();
    return this.embedder!.compute(stream);
  }

  /** Assign a live "spk-N" key by comparing a voice embedding with known voices. */
  identify(samples: Float32Array, startMs = 0): string {
    if (!this.embedder) return 'spk-1';
    if (samples.length < MIN_EMBED_SAMPLES) {
      this.voices.push({ startMs, samples: samples.length, emb: null });
      return this.lastSpeaker ?? this.newSpeaker(null);
    }
    const emb = this.embed(samples);
    this.voices.push({ startMs, samples: samples.length, emb });
    let best: Speaker | null = null;
    let bestScore = -1;
    for (const s of this.speakers) {
      const score = cosine(s.centroid, emb);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (best && (bestScore >= SAME_SPEAKER || this.speakers.length >= MAX_SPEAKERS)) {
      // Running mean keeps the voice profile stable over the meeting.
      for (let i = 0; i < best.centroid.length; i++)
        best.centroid[i] = (best.centroid[i]! * best.count + emb[i]!) / (best.count + 1);
      best.count++;
      this.lastSpeaker = best.key;
      return best.key;
    }
    // A profile created for a very short first utterance takes the first real voice.
    const placeholder = this.speakers.find((s) => s.count === 0);
    if (placeholder) {
      placeholder.centroid = Float32Array.from(emb);
      placeholder.count = 1;
      this.lastSpeaker = placeholder.key;
      return placeholder.key;
    }
    return this.newSpeaker(emb);
  }

  private newSpeaker(emb: Float32Array | null): string {
    const key = `spk-${this.speakers.length + 1}`;
    if (emb) this.speakers.push({ key, centroid: Float32Array.from(emb), count: 1 });
    else
      this.speakers.push({ key, centroid: new Float32Array(this.embedder?.dim ?? 256), count: 0 });
    this.lastSpeaker = key;
    return key;
  }

  /**
   * Final speaker labels for the whole meeting: average-linkage clustering of
   * all voice embeddings, which is more reliable than live assignment.
   * Short segments take the label of the segment before them.
   */
  finalizeSpeakers(threshold = FINAL_SAME_SPEAKER): SpeakerLabel[] {
    if (!this.embedder || this.voices.length === 0) return [];
    const ordered = [...this.voices].sort((a, b) => a.startMs - b.startMs);
    // Cluster the longest segments; attach the rest to the nearest cluster.
    const withEmb = ordered.filter((v) => v.emb).sort((a, b) => b.samples - a.samples);
    const core = withEmb.slice(0, MAX_FINAL_SEGMENTS);
    const n = core.length;
    const sim: number[][] = core.map((a) => core.map((b) => cosine(a.emb!, b.emb!)));
    let clusters: { members: number[]; alive: boolean }[] = core.map((_, i) => ({
      members: [i],
      alive: true,
    }));
    for (;;) {
      let best = -Infinity;
      let bi = -1;
      let bj = -1;
      for (let i = 0; i < n; i++) {
        if (!clusters[i]!.alive) continue;
        for (let j = i + 1; j < n; j++) {
          if (clusters[j]!.alive && sim[i]![j]! > best) {
            best = sim[i]![j]!;
            bi = i;
            bj = j;
          }
        }
      }
      if (bi < 0 || best < threshold) break;
      const a = clusters[bi]!;
      const b = clusters[bj]!;
      // Lance-Williams update for average linkage.
      for (let k = 0; k < n; k++) {
        if (k === bi || k === bj || !clusters[k]!.alive) continue;
        const v =
          (a.members.length * sim[bi]![k]! + b.members.length * sim[bj]![k]!) /
          (a.members.length + b.members.length);
        sim[bi]![k] = v;
        sim[k]![bi] = v;
      }
      a.members.push(...b.members);
      b.alive = false;
    }
    clusters = clusters.filter((c) => c.alive);
    const clusterOf = new Map<(typeof core)[number], number>();
    clusters.forEach((c, ci) => c.members.forEach((m) => clusterOf.set(core[m]!, ci)));
    const centroids = clusters.map((c) => {
      const v = new Float32Array(core[0]!.emb!.length);
      for (const m of c.members)
        for (let d = 0; d < v.length; d++) v[d]! += core[m]!.emb![d]! / c.members.length;
      return v;
    });
    for (const v of withEmb.slice(MAX_FINAL_SEGMENTS)) {
      let best = 0;
      let bestScore = -Infinity;
      centroids.forEach((c, ci) => {
        const sc = cosine(c, v.emb!);
        if (sc > bestScore) {
          bestScore = sc;
          best = ci;
        }
      });
      clusterOf.set(v, best);
    }
    // Number speakers by first appearance: spk-1, spk-2, ...
    const keyOf = new Map<number, string>();
    let prev: string | null = null;
    return ordered.map((v) => {
      const c = clusterOf.get(v);
      let key: string;
      if (c === undefined) key = prev ?? 'spk-1';
      else {
        if (!keyOf.has(c)) keyOf.set(c, `spk-${keyOf.size + 1}`);
        key = keyOf.get(c)!;
      }
      prev = key;
      return { startMs: v.startMs, speakerKey: key };
    });
  }

  get threads(): number {
    return this.numThreads;
  }
}
