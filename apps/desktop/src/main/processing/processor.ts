import {
  analyzeMeeting,
  AiError,
  RulesExtractor,
  STAGE_LABELS,
  type Extractor,
  type Principal,
  type RawExtraction,
  type Stage,
} from '@meeting-assistant/core';
import { ClaudeExtractor } from '@meeting-assistant/core/claude';
import type { Repo } from '../db/repo';
import type { SettingsService } from '../settings';
import type { ProcessingInfo } from '../../shared/types';
import { log } from '../log';

export interface ProcessorDeps {
  repo: Repo;
  settings: SettingsService;
  principal: () => Principal;
  now: () => Date;
  onProgress: (meetingId: string, info: ProcessingInfo | null) => void;
  onDone: (meetingId: string, ok: boolean) => void;
  /** Deletes raw audio for a meeting when retention says so. */
  discardAudio: (meetingId: string) => void;
  /** Test hook: replace the extractor. */
  extractorOverride?: () => Extractor;
}

type Mode = 'basic' | 'claude';

/**
 * Runs meeting analysis one job at a time. Jobs are keyed by transcript and
 * engine, so pressing Stop twice or restarting the app never duplicates
 * notes, tasks or emails.
 */
export class Processor {
  private queue: { meetingId: string; mode: Mode; force: boolean }[] = [];
  private running = false;
  private halted = false;
  private readonly progress = new Map<string, ProcessingInfo>();

  constructor(private readonly deps: ProcessorDeps) {}

  status(meetingId: string): ProcessingInfo | null {
    return this.progress.get(meetingId) ?? null;
  }

  isBusy(): boolean {
    return this.running || this.queue.length > 0;
  }

  enqueue(meetingId: string, opts: { mode?: Mode; force?: boolean } = {}): void {
    const mode = opts.mode ?? this.deps.settings.get().ai.mode;
    if (this.halted || this.queue.some((q) => q.meetingId === meetingId)) return;
    this.queue.push({ meetingId, mode, force: Boolean(opts.force) });
    this.setProgress(meetingId, {
      stage: 'queued',
      label: 'Waiting to start…',
      error: null,
      retryable: false,
    });
    void this.pump();
  }

  /** Stop starting new jobs (app is quitting). Unstarted jobs resume on next launch. */
  halt(): void {
    this.halted = true;
    this.queue = [];
  }

  /** Resolves when the queue is empty (used by tests and shutdown). */
  async idle(): Promise<void> {
    while (this.isBusy()) await new Promise((r) => setTimeout(r, 20));
  }

  private setProgress(meetingId: string, info: ProcessingInfo | null) {
    if (info) this.progress.set(meetingId, info);
    else this.progress.delete(meetingId);
    this.deps.onProgress(meetingId, info);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.halted) {
        const job = this.queue.shift()!;
        await this.run(job.meetingId, job.mode, job.force);
      }
    } finally {
      this.running = false;
    }
  }

  private extractor(mode: Mode): { extractor: Extractor; fallback: Extractor | undefined } {
    if (this.deps.extractorOverride)
      return { extractor: this.deps.extractorOverride(), fallback: new RulesExtractor() };
    const key = this.deps.settings.claudeKey();
    if (mode === 'claude' && key) {
      const repo = this.deps.repo;
      return {
        extractor: new ClaudeExtractor({
          apiKey: key,
          cache: {
            get: async (k) => {
              const v = repo.cacheGet(k);
              return v ? (JSON.parse(v) as RawExtraction) : undefined;
            },
            set: async (k, v) => repo.cacheSet(k, JSON.stringify(v)),
          },
        }),
        fallback: new RulesExtractor(),
      };
    }
    return { extractor: new RulesExtractor(), fallback: undefined };
  }

  private async run(meetingId: string, mode: Mode, force: boolean): Promise<void> {
    const { repo, settings } = this.deps;
    const p = this.deps.principal();
    const started = Date.now();
    let jobKey = '';
    try {
      const meta = repo.meetingMeta(p, meetingId);
      const hash = repo.transcriptHash(p, meetingId);
      const { extractor, fallback } = this.extractor(mode);
      jobKey = `analyze:${meetingId}:${hash}:${extractor.kind}:${extractor.promptVersion}${force ? `:${Date.now()}` : ''}`;
      if (!repo.enqueueJob(meetingId, 'analyze', jobKey) && repo.job(jobKey)?.status === 'done') {
        log.info('processing_skipped_duplicate', { meetingId });
        repo.setStatus(p, meetingId, 'ready', { stage: null, error: null });
        this.setProgress(meetingId, null);
        this.deps.onDone(meetingId, true);
        return;
      }
      repo.setJob(jobKey, 'running');
      repo.setStatus(p, meetingId, 'processing', { stage: 'preparing', error: null });

      const profile = settings.get().profile;
      const segments = repo.segments(p, meetingId);
      const result = await analyzeMeeting(
        {
          meeting: {
            id: meetingId,
            title: meta.title,
            startedAt: meta.startedAt,
            timeZone: meta.timeZone ?? undefined,
            platform: meta.platform,
            participants: meta.participants,
            user: {
              name: profile.name || meta.ownerName || 'Me',
              email: profile.email || meta.ownerEmail,
            },
          },
          segments,
          screen: repo.screenNotes(p, meetingId),
        },
        {
          extractor,
          fallback,
          now: this.deps.now,
          onStage: (stage: Stage) => {
            this.setProgress(meetingId, {
              stage,
              label: STAGE_LABELS[stage],
              error: null,
              retryable: false,
            });
            repo.setStatus(p, meetingId, 'processing', { stage });
          },
        },
      );
      repo.saveAnalysis(p, meetingId, result, hash);
      repo.setJob(jobKey, 'done');
      repo.setStatus(p, meetingId, 'ready', { stage: null, error: null });
      if (settings.get().privacy.deleteAudioAfterProcessing) this.deps.discardAudio(meetingId);
      log.info('processing_done', {
        meetingId,
        engine: result.notes.engine.kind,
        fallback: result.usedFallback,
        primaryError: result.primaryError?.code ?? null,
        ms: Date.now() - started,
        segments: segments.length,
        tasks: result.notes.actionItems.length,
      });
      this.setProgress(meetingId, null);
      this.deps.onDone(meetingId, true);
    } catch (err) {
      const aiErr = err instanceof AiError ? err : null;
      const message =
        aiErr?.userMessage ??
        'Meeting processing failed. Your transcript is saved, so you can try again.';
      log.error('processing_failed', {
        meetingId,
        error: err instanceof Error ? err : String(err),
        ms: Date.now() - started,
      });
      if (jobKey) repo.setJob(jobKey, 'failed', err instanceof Error ? err.message : String(err));
      try {
        repo.setStatus(p, meetingId, 'failed', { stage: null, error: message });
      } catch {
        // The meeting may have been deleted while processing.
      }
      this.setProgress(meetingId, {
        stage: 'failed',
        label: 'Processing failed',
        error: message,
        retryable: true,
      });
      this.deps.onDone(meetingId, false);
    }
  }
}
