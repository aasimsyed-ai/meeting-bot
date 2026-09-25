import type { ModelPaths } from './models';
import type { EngineSegment, SpeakerLabel } from './engine';

/** Messages between the main process and the transcription utility process. */
export type ToWorker =
  | { type: 'init'; paths: ModelPaths; numThreads: number }
  | { type: 'audio'; channel: 'mic' | 'system'; samples: Float32Array }
  | { type: 'flush'; id: number }
  | { type: 'finalize'; id: number };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'segment'; segment: EngineSegment }
  | { type: 'flushed'; id: number }
  | { type: 'finalized'; id: number; labels: SpeakerLabel[] };
