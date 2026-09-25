import { utilityProcess, type UtilityProcess } from 'electron';
import type { SpeechSegment, Transcriber } from '../capture/session';
import type { ModelPaths } from './models';
import type { FromWorker, ToWorker } from './protocol';
import type { SpeakerLabel } from './engine';
import { log } from '../log';

/** Runs the speech engine in an Electron utility process. */
export class UtilityTranscriber implements Transcriber {
  private child: UtilityProcess | null = null;
  private onSeg: (s: SpeechSegment) => void = () => undefined;
  private onFail: (m: string) => void = () => undefined;
  private flushWaiters = new Map<number, () => void>();
  private finalizeWaiters = new Map<number, (labels: SpeakerLabel[]) => void>();
  private nextFlush = 1;
  private stopped = false;
  private ready = false;

  constructor(
    private readonly workerPath: string,
    private readonly paths: ModelPaths,
    private readonly numThreads: number,
  ) {}

  onSegment(cb: (s: SpeechSegment) => void): void {
    this.onSeg = cb;
  }

  onFailure(cb: (message: string) => void): void {
    this.onFail = cb;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = utilityProcess.fork(this.workerPath, [], {
        serviceName: 'Meeting Assistant Speech',
        stdio: 'ignore',
      });
      this.child = child;
      const timer = setTimeout(
        () => reject(new Error('The speech engine took too long to start.')),
        90_000,
      );
      child.on('message', (msg: FromWorker) => {
        if (msg.type === 'ready') {
          this.ready = true;
          clearTimeout(timer);
          resolve();
        } else if (msg.type === 'error') {
          if (!this.ready) {
            clearTimeout(timer);
            reject(
              new Error('The speech engine could not start. Try downloading it again in Settings.'),
            );
          } else this.onFail(msg.message);
          log.error('speech_engine_error', { error: msg.message });
        } else if (msg.type === 'segment') {
          this.onSeg(msg.segment);
        } else if (msg.type === 'flushed') {
          this.flushWaiters.get(msg.id)?.();
          this.flushWaiters.delete(msg.id);
        } else if (msg.type === 'finalized') {
          this.finalizeWaiters.get(msg.id)?.(msg.labels);
          this.finalizeWaiters.delete(msg.id);
        }
      });
      child.on('exit', (code) => {
        for (const w of this.flushWaiters.values()) w();
        this.flushWaiters.clear();
        for (const w of this.finalizeWaiters.values()) w([]);
        this.finalizeWaiters.clear();
        if (!this.stopped) {
          log.error('speech_engine_exited', { code });
          if (this.ready) this.onFail('The speech engine stopped unexpectedly.');
          else {
            clearTimeout(timer);
            reject(new Error('The speech engine stopped while starting.'));
          }
        }
      });
      this.post({ type: 'init', paths: this.paths, numThreads: this.numThreads });
    });
  }

  private post(msg: ToWorker) {
    this.child?.postMessage(msg);
  }

  push(channel: 'mic' | 'system', samples: Float32Array): void {
    if (this.ready && !this.stopped) this.post({ type: 'audio', channel, samples });
  }

  flush(): Promise<void> {
    if (!this.child || this.stopped) return Promise.resolve();
    const id = this.nextFlush++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.flushWaiters.delete(id);
        resolve();
      }, 10 * 60_000);
      this.flushWaiters.set(id, () => {
        clearTimeout(timer);
        resolve();
      });
      this.post({ type: 'flush', id });
    });
  }

  /** Final speaker labels for the meeting (runs after flush). */
  finalizeSpeakers(): Promise<SpeakerLabel[]> {
    if (!this.child || this.stopped) return Promise.resolve([]);
    const id = this.nextFlush++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.finalizeWaiters.delete(id);
        resolve([]);
      }, 60_000);
      this.finalizeWaiters.set(id, (labels) => {
        clearTimeout(timer);
        resolve(labels);
      });
      this.post({ type: 'finalize', id });
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.child?.kill();
    this.child = null;
  }
}
