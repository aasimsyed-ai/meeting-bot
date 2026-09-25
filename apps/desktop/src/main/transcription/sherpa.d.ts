/** The small part of sherpa-onnx-node (Apache-2.0) this app uses. The package ships no types. */
declare module 'sherpa-onnx-node' {
  export interface Wave {
    samples: Float32Array;
    sampleRate: number;
  }
  export interface SpeechSegment {
    start: number;
    samples: Float32Array;
  }
  export class Vad {
    constructor(config: Record<string, unknown>, bufferSizeInSeconds: number);
    acceptWaveform(samples: Float32Array): void;
    isEmpty(): boolean;
    front(): SpeechSegment;
    pop(): void;
    flush(): void;
    reset(): void;
  }
  export interface OfflineStream {
    acceptWaveform(wave: Wave): void;
  }
  export class OfflineRecognizer {
    constructor(config: Record<string, unknown>);
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    getResult(stream: OfflineStream): { text: string; timestamps?: number[]; lang?: string };
  }
  export interface EmbeddingStream {
    acceptWaveform(wave: Wave): void;
    inputFinished(): void;
  }
  export class SpeakerEmbeddingExtractor {
    constructor(config: Record<string, unknown>);
    createStream(): EmbeddingStream;
    isReady(stream: EmbeddingStream): boolean;
    compute(stream: EmbeddingStream): Float32Array;
    dim: number;
  }
  export class OfflineTts {
    constructor(config: Record<string, unknown>);
    generate(req: { text: string; sid: number; speed: number }): Wave;
    sampleRate: number;
  }
  export class LinearResampler {
    constructor(inputSampleRate: number, outputSampleRate: number);
    resample(samples: Float32Array): Float32Array;
    flush(samples: Float32Array): Float32Array;
  }
  export function readWave(path: string): Wave;
  export function writeWave(path: string, wave: Wave): void;
  export const version: string;
}
