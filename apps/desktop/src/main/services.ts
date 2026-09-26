import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  answerQuestion,
  AccessDeniedError,
  isValidEmail,
  type Principal,
} from '@meeting-assistant/core';
import { openDatabase, type Db } from './db/database';
import { NotFoundError, Repo, LOCAL_USER } from './db/repo';
import { SecretStore, type Encryptor } from './secrets';
import { SettingsService } from './settings';
import { Processor } from './processing/processor';
import { audioFiles, CaptureSession, discardAudio, type Transcriber } from './capture/session';
import { transcribeSavedAudio } from './capture/offline';
import { ScreenWatcher, type ScreenSource } from './capture/screen';
import {
  downloadModel,
  DownloadCancelled,
  emptyStatus,
  modelsReady,
  type Fetcher,
} from './transcription/models';
import { MailAppProvider, MockEmailProvider, type EmailProvider } from './email/providers';
import { loadSampleData, removeSampleData } from './demo';
import type { Env } from './env';
import { log } from './log';
import type { ArgsOf, Channel, Results } from '../shared/ipc';
import type {
  AppEvent,
  CaptureStatus,
  DetectedMeeting,
  ModelStatus,
  PermissionKind,
  PermissionStatus,
  StartCaptureOptions,
} from '../shared/types';

export interface ShellLike {
  openExternal(url: string): Promise<void>;
  copyText(text: string): void;
  showItemInFolder(path: string): void;
  notify(title: string, body: string, onClick?: () => void): void;
  appVersion: string;
  osVersion: string;
}

export interface PermissionsLike {
  status(): PermissionStatus;
  request(kind: PermissionKind, probe: () => Promise<boolean>): Promise<PermissionStatus>;
  openSettings(kind: PermissionKind): Promise<void>;
}

export interface CaptureBackend {
  startLive(opts: { mic: boolean; micDeviceId: string | null; system: boolean }): Promise<void>;
  startDemo(): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  /** Start failed or lost sources again, without stopping the meeting. */
  retry(): Promise<void>;
  probeSystemAudio(): Promise<boolean>;
}

export interface ServicesDeps {
  env: Env;
  dataDir: string;
  now: () => Date;
  encryptor: Encryptor | null;
  shell: ShellLike;
  permissions: PermissionsLike;
  createBackend: (session: CaptureSession) => CaptureBackend;
  /** Returns null when the speech engine is not downloaded. */
  createTranscriber: () => Transcriber | null;
  fetcher: Fetcher;
  emit: (e: AppEvent) => void;
  timeZone?: () => string;
  detected?: () => DetectedMeeting | null;
  checkUpdates?: () => Promise<Results['app:checkUpdates']>;
  logPath?: () => string | null;
  onSettingsChanged?: () => void;
  /** Screen access for reading slides and noticing the meeting window close. */
  screenSource?: ScreenSource;
  /** Titles of the app's own windows, which are never treated as meetings. */
  ownTitles?: () => string[];
}

type Handlers = { [C in Channel]: (...args: ArgsOf<C>) => Promise<Results[C]> | Results[C] };

/** Everything the app does, independent of Electron's windows and menus. */
export class Services {
  readonly db: Db;
  readonly repo: Repo;
  readonly secrets: SecretStore;
  readonly settings: SettingsService;
  readonly processor: Processor;
  readonly session: CaptureSession;
  readonly backend: CaptureBackend;
  private screen: ScreenWatcher | null = null;
  private email: EmailProvider;
  private modelStatus: ModelStatus;
  private download: AbortController | null = null;
  private user: Principal;
  /** Set while quitting: new background work waits for the next launch. */
  private closing = false;
  readonly audioRoot: string;
  readonly modelsRoot: string;

  constructor(private readonly deps: ServicesDeps) {
    this.audioRoot = join(deps.dataDir, 'audio');
    this.modelsRoot = join(deps.dataDir, 'models');
    this.db = openDatabase(join(deps.dataDir, 'meetings.db'));
    this.repo = new Repo(this.db, deps.now);
    this.secrets = new SecretStore(this.repo, deps.encryptor);
    this.settings = new SettingsService(this.repo, this.secrets, deps.env.claudeApiKey);
    const profile = this.settings.get().profile;
    this.user = this.repo.ensureLocalUser(profile.name, profile.email || null);
    this.email =
      deps.env.emailMode === 'mock'
        ? new MockEmailProvider(join(deps.dataDir, 'test-outbox'))
        : new MailAppProvider({
            openExternal: (u) => deps.shell.openExternal(u),
            copyText: (t) => deps.shell.copyText(t),
            platform: process.platform,
          });
    this.modelStatus = emptyStatus(this.settings.get().transcription.model, this.modelsRoot);

    this.processor = new Processor({
      aiOverride: deps.env.aiOverride,
      repo: this.repo,
      settings: this.settings,
      principal: () => this.principal(),
      now: deps.now,
      onProgress: (meetingId, info) => deps.emit({ type: 'processing', meetingId, info }),
      onDone: (meetingId, ok) => {
        deps.emit({ type: 'meetings-changed' });
        deps.emit({ type: 'tasks-changed' });
        if (ok && this.settings.get().notifications) {
          const title = this.safeTitle(meetingId);
          if (title)
            deps.shell.notify('Meeting summary ready', title, () =>
              deps.emit({ type: 'navigate', to: `/meetings/${meetingId}` }),
            );
        }
      },
      discardAudio: (id) => discardAudio(this.audioRoot, id),
    });

    this.session = new CaptureSession({
      repo: this.repo,
      principal: () => this.principal(),
      audioRoot: this.audioRoot,
      now: deps.now,
      timeZone: deps.timeZone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone),
      createTranscriber: () =>
        modelsReady(this.modelsRoot, this.settings.get().transcription.model)
          ? deps.createTranscriber()
          : null,
      onStatus: (status) => deps.emit({ type: 'capture', status }),
      onFinished: (meetingId, info) => void this.afterCapture(meetingId, info),
    });
    this.backend = deps.createBackend(this.session);
  }

  principal(): Principal {
    this.user = this.repo.principal(LOCAL_USER);
    return this.user;
  }

  private safeTitle(meetingId: string): string | null {
    try {
      return this.repo.meetingMeta(this.principal(), meetingId).title;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ lifecycle

  /** Recover from crashes, resume unfinished work, and apply retention. */
  async startup(): Promise<{ interrupted: string[] }> {
    const p = this.principal();
    const interrupted = this.repo.interruptedMeetings(p);
    for (const id of interrupted) {
      this.repo.setStatus(p, id, 'interrupted', { stage: null });
      log.warn('meeting_interrupted_found', { meetingId: id });
    }
    for (const id of this.repo.processingMeetings(p)) this.processOrWait(id);
    this.applyRetention();
    return { interrupted };
  }

  applyRetention(): void {
    const p = this.principal();
    const { keepMeetingsDays, deleteAudioAfterProcessing } = this.settings.get().privacy;
    for (const id of this.repo.meetingsOlderThan(p, keepMeetingsDays)) {
      this.repo.deleteMeeting(p, id);
      discardAudio(this.audioRoot, id);
    }
    if (deleteAudioAfterProcessing && existsSync(this.audioRoot)) {
      const keep = new Set([
        ...this.repo.interruptedMeetings(p),
        ...this.repo.processingMeetings(p),
        this.session.id ?? '',
      ]);
      for (const m of this.repo.listMeetings(p))
        if (m.status === 'interrupted' || m.status === 'failed') keep.add(m.id);
      for (const dir of readdirSync(this.audioRoot))
        if (!keep.has(dir)) rmSync(join(this.audioRoot, dir), { recursive: true, force: true });
    }
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    if (this.session.isActive) {
      await this.backend.stop().catch(() => undefined);
      await this.session.stop();
    }
    this.download?.abort();
    // Unfinished analysis stays queued in the database and resumes next launch.
    this.processor.halt();
    await Promise.race([this.processor.idle(), new Promise((r) => setTimeout(r, 8000))]);
    this.db.close();
  }

  private async afterCapture(
    meetingId: string,
    info: { transcribed: boolean; hasAudio: boolean },
  ): Promise<void> {
    this.deps.emit({ type: 'meetings-changed' });
    // When quitting, the meeting stays "processing" and is picked up on the next launch.
    if (this.closing) return;
    if (info.transcribed || !info.hasAudio) this.processor.enqueue(meetingId);
    else this.processOrWait(meetingId);
  }

  /** Transcribe saved audio first if the speech engine was not available during the meeting. */
  private processOrWait(meetingId: string): void {
    if (this.closing) return;
    const p = this.principal();
    const files = audioFiles(this.audioRoot, meetingId);
    const hasAudio = Boolean(files.mic || files.system);
    const needsTranscription = hasAudio && this.repo.segments(p, meetingId).length === 0;
    if (!needsTranscription) {
      this.processor.enqueue(meetingId);
      return;
    }
    if (!modelsReady(this.modelsRoot, this.settings.get().transcription.model)) {
      this.repo.setStatus(p, meetingId, 'processing', { stage: 'waiting-for-speech-engine' });
      this.deps.emit({
        type: 'processing',
        meetingId,
        info: {
          stage: 'waiting-for-speech-engine',
          label: 'Waiting for the speech engine to finish downloading…',
          error: null,
          retryable: false,
        },
      });
      return;
    }
    const transcriber = this.deps.createTranscriber();
    if (!transcriber) return;
    this.deps.emit({
      type: 'processing',
      meetingId,
      info: { stage: 'transcribing', label: 'Transcribing…', error: null, retryable: false },
    });
    transcribeSavedAudio({
      repo: this.repo,
      principal: p,
      meetingId,
      audioRoot: this.audioRoot,
      transcriber,
    })
      .then(() => this.processor.enqueue(meetingId))
      .catch((err: Error) => {
        log.error('offline_transcription_failed', { meetingId, error: err });
        if (this.closing) return;
        try {
          this.repo.setStatus(p, meetingId, 'failed', {
            stage: null,
            error: 'The meeting audio could not be transcribed. You can try again.',
          });
        } catch {
          return;
        }
        this.deps.emit({
          type: 'processing',
          meetingId,
          info: {
            stage: 'failed',
            label: 'Transcription failed',
            error: 'The meeting audio could not be transcribed. You can try again.',
            retryable: true,
          },
        });
        this.deps.emit({ type: 'meetings-changed' });
      });
  }

  private waitingForEngine(): string[] {
    const p = this.principal();
    return this.repo
      .listMeetings(p)
      .filter((m) => m.status === 'processing' && !this.processor.status(m.id))
      .map((m) => m.id);
  }

  // ------------------------------------------------------------------ models

  private setModelStatus(s: Partial<ModelStatus>): ModelStatus {
    this.modelStatus = { ...this.modelStatus, ...s };
    this.deps.emit({ type: 'model', status: this.modelStatus });
    return this.modelStatus;
  }

  private currentModelStatus(): ModelStatus {
    const model = this.settings.get().transcription.model;
    if (this.modelStatus.model !== model && !this.download)
      this.modelStatus = emptyStatus(model, this.modelsRoot);
    else if (!this.download)
      this.modelStatus = { ...emptyStatus(model, this.modelsRoot), error: this.modelStatus.error };
    return this.modelStatus;
  }

  private startDownload(): ModelStatus {
    if (this.download) return this.modelStatus;
    const model = this.settings.get().transcription.model;
    if (modelsReady(this.modelsRoot, model))
      return this.setModelStatus({ ...emptyStatus(model, this.modelsRoot) });
    const ctrl = new AbortController();
    this.download = ctrl;
    this.setModelStatus({ model, downloading: true, error: null, progress: 0 });
    log.info('model_download_started', { model });
    downloadModel({
      root: this.modelsRoot,
      model,
      fetcher: this.deps.fetcher,
      signal: ctrl.signal,
      onProgress: (done, total) => {
        const progress = total ? done / total : 0;
        if (Math.abs(progress - this.modelStatus.progress) >= 0.01 || progress === 1)
          this.setModelStatus({ progress, totalBytes: total });
      },
    })
      .then(() => {
        log.info('model_download_done', { model });
        this.setModelStatus({ ready: true, downloading: false, progress: 1 });
        for (const id of this.waitingForEngine()) this.processOrWait(id);
      })
      .catch((err: Error) => {
        const cancelled = err instanceof DownloadCancelled;
        log.warn('model_download_failed', { model, cancelled, error: err });
        this.setModelStatus({
          downloading: false,
          error: cancelled
            ? null
            : `${err.message.startsWith('The ') || err.message.startsWith('Could') ? err.message : 'The download did not finish. Check your internet connection and try again.'}`,
        });
      })
      .finally(() => {
        this.download = null;
      });
    return this.modelStatus;
  }

  // ------------------------------------------------------------------ capture

  async startCapture(opts: StartCaptureOptions): Promise<CaptureStatus> {
    if (this.session.isActive) return this.session.status();
    const s = this.settings.get();
    const detected = this.deps.detected?.() ?? null;
    const source = opts.source ?? 'live';
    await this.session.start({
      title:
        opts.title ||
        (source === 'demo' ? 'Project Phoenix Weekly (sample)' : detected?.title || undefined),
      platform: opts.platform ?? (source === 'demo' ? 'zoom' : detected?.platform) ?? 'other',
      source,
      mic: true,
      system: s.capture.systemAudio,
      screen: s.capture.screenContext,
    });
    try {
      if (source === 'demo') this.backend.startDemo();
      else
        await this.backend.startLive({
          mic: true,
          micDeviceId: s.capture.micDeviceId,
          system: s.capture.systemAudio,
        });
      if (source === 'live') this.startScreenWatch(s.capture.screenContext);
    } catch (err) {
      log.error('capture_backend_failed', { error: err instanceof Error ? err : String(err) });
      this.session.channelFailed(
        'mic',
        'mic_lost',
        'Audio capture could not start. Try again, or restart the app.',
      );
    }
    return this.session.status();
  }

  private startScreenWatch(readText: boolean): void {
    const source = this.deps.screenSource;
    const meetingId = this.session.id;
    if (!source || !meetingId) return;
    const session = this.session;
    this.screen = new ScreenWatcher(
      source,
      {
        isActive: () => session.isActive && session.id === meetingId,
        isPaused: () => session.status().state === 'paused',
        elapsedMs: () => session.elapsedMs(),
        setScreenState: (s) => session.setScreenState(s),
        screenKeyframe: () => session.screenKeyframe(),
        meetingWindowGone: (gone) => session.meetingWindowGone(gone),
        save: (note) => this.repo.addScreenNote(this.principal(), meetingId, note),
      },
      { readText, ownTitles: this.deps.ownTitles ?? (() => []) },
    );
    this.screen.start();
  }

  async stopCapture(): Promise<CaptureStatus> {
    if (!this.session.isActive) return this.session.status();
    await this.screen?.stop();
    this.screen = null;
    await this.backend.stop().catch(() => undefined);
    return this.session.stop();
  }

  // ------------------------------------------------------------------ handlers

  handlers(): Handlers {
    const p = () => this.principal();
    const me = () => ({ name: this.settings.get().profile.name || 'Me' });
    return {
      'app:info': () => ({
        version: this.deps.shell.appVersion,
        platform: process.platform,
        osVersion: this.deps.shell.osVersion,
        env: this.deps.env.appEnv,
        emailMode: this.deps.env.emailMode,
        dataDir: this.deps.dataDir,
        hasSampleData: this.repo.sampleMeetingIds(p()).length > 0,
        claudeAvailable: Boolean(this.settings.claudeKey()),
        secureStorage: this.secrets.persistent,
      }),
      'app:showLogs': () => {
        const path = this.deps.logPath?.();
        if (path) this.deps.shell.showItemInFolder(path);
      },
      'app:checkUpdates': async () =>
        this.deps.checkUpdates
          ? this.deps.checkUpdates()
          : { state: 'disabled', message: 'Updates are turned off in this build.' },

      'settings:get': () => this.settings.get(),
      'settings:update': (patch) => {
        const before = this.settings.get();
        const next = this.settings.update(patch);
        if (patch.profile)
          this.repo.updateUser(
            LOCAL_USER,
            next.profile.name || 'Me',
            isValidEmail(next.profile.email) ? next.profile.email : null,
          );
        if (patch.transcription?.model && patch.transcription.model !== before.transcription.model)
          this.currentModelStatus();
        if (patch.privacy) this.applyRetention();
        this.deps.onSettingsChanged?.();
        return next;
      },
      'settings:setClaudeKey': (key) => {
        const trimmed = key?.trim() ?? null;
        if (trimmed && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
          return {
            stored: false,
            persistent: this.secrets.persistent,
            message: 'That does not look like a Claude API key. It starts with "sk-ant-".',
          };
        }
        const { persistent } = this.secrets.set('claude-api-key', trimmed);
        this.repo.audit(p(), trimmed ? 'ai_key_saved' : 'ai_key_removed', null, null);
        if (!trimmed) return { stored: false, persistent, message: 'The key was removed.' };
        return {
          stored: true,
          persistent,
          message: persistent
            ? 'Saved securely in your system keychain.'
            : 'Saved for this session only, because this computer has no secure keychain.',
        };
      },

      'permissions:get': () => this.deps.permissions.status(),
      'permissions:request': (kind) =>
        this.deps.permissions.request(kind, () => this.backend.probeSystemAudio()),
      'permissions:openSettings': (kind) => this.deps.permissions.openSettings(kind),

      'models:status': () => this.currentModelStatus(),
      'models:download': () => this.startDownload(),
      'models:cancel': () => {
        this.download?.abort();
        return this.modelStatus;
      },

      'capture:start': (opts) => this.startCapture(opts),
      'capture:pause': async () => {
        await this.backend.pause().catch(() => undefined);
        return this.session.pause();
      },
      'capture:resume': async () => {
        await this.backend.resume().catch(() => undefined);
        return this.session.resume();
      },
      'capture:stop': () => this.stopCapture(),
      'capture:retryAudio': async () => {
        await this.backend.retry().catch(() => undefined);
        return this.session.status();
      },
      'capture:status': () => this.session.status(),
      'detection:current': () => this.deps.detected?.() ?? null,

      'meetings:list': () => this.repo.listMeetings(p()),
      'meetings:get': (id) => {
        const d = this.repo.detail(p(), id);
        const files = audioFiles(this.audioRoot, id);
        const processing =
          this.processor.status(id) ??
          (d.summary.status === 'failed'
            ? {
                stage: 'failed',
                label: 'Processing failed',
                error: this.failure(id),
                retryable: true,
              }
            : d.summary.status === 'processing'
              ? {
                  stage: 'waiting-for-speech-engine',
                  label: 'Waiting for the speech engine to finish downloading…',
                  error: null,
                  retryable: false,
                }
              : null);
        return { ...d, processing, hasAudio: Boolean(files.mic || files.system) };
      },
      'meetings:rename': (id, title) => {
        this.repo.rename(p(), id, title.trim());
        this.deps.emit({ type: 'meetings-changed' });
      },
      'meetings:renameSpeaker': (id, speakerId, name) => {
        this.repo.renameSpeaker(p(), id, speakerId, name);
        // Owners in the notes come from speaker names, so refresh the notes.
        if (this.repo.detail(p(), id).notes)
          this.processor.enqueue(id, { mode: 'basic', force: true });
        this.deps.emit({ type: 'meetings-changed' });
      },
      'meetings:setParticipants': (id, people) => {
        this.repo.setParticipants(
          p(),
          id,
          people.map((x) => ({
            name: x.name.trim(),
            email: x.email?.trim().toLowerCase() || null,
            role: x.role ?? 'required',
          })),
        );
        if (this.repo.detail(p(), id).notes) this.processor.enqueue(id, { force: true });
      },
      'meetings:analyze': (id, mode) => {
        this.repo.meetingMeta(p(), id);
        this.processor.enqueue(id, { mode, force: true });
      },
      'meetings:delete': async (id) => {
        if (this.session.id === id) await this.stopCapture();
        this.repo.deleteMeeting(p(), id);
        discardAudio(this.audioRoot, id);
        this.deps.emit({ type: 'meetings-changed' });
        this.deps.emit({ type: 'tasks-changed' });
      },
      'meetings:deleteTranscript': (id) => {
        this.repo.deleteTranscript(p(), id);
        discardAudio(this.audioRoot, id);
        this.deps.emit({ type: 'meetings-changed' });
      },
      'meetings:recover': (id) => {
        this.repo.setStatus(p(), id, 'processing', { stage: 'queued', error: null });
        this.processOrWait(id);
        this.deps.emit({ type: 'meetings-changed' });
      },

      'tasks:list': (filter) => this.repo.listTasks(p(), filter, me()),
      'tasks:update': (meetingId, taskId, patch) => {
        const row = this.repo.updateTask(p(), meetingId, taskId, patch);
        this.deps.emit({ type: 'tasks-changed' });
        return row;
      },
      'tasks:add': (meetingId, task) => {
        const row = this.repo.addTask(p(), meetingId, task);
        this.deps.emit({ type: 'tasks-changed' });
        return row;
      },

      'email:get': (id) => this.repo.emailDraft(p(), id),
      'email:update': (id, patch) => this.repo.updateEmailDraft(p(), id, patch),
      'email:open': async (id) => {
        const draft = this.repo.emailDraft(p(), id);
        if (!draft) throw new NotFoundError('There is no email draft for this meeting yet.');
        const result = await this.email.createDraft(draft);
        this.repo.setEmailStatus(p(), id, result.status);
        log.info('email_draft_opened', {
          meetingId: id,
          provider: this.email.id,
          status: result.status,
        });
        return result;
      },
      'email:copy': (id) => {
        const draft = this.repo.emailDraft(p(), id);
        if (!draft) throw new NotFoundError('There is no email draft for this meeting yet.');
        this.deps.shell.copyText(`Subject: ${draft.subject}\n\n${draft.body}`);
        return { status: draft.status, message: 'Copied. Paste it into any email.' };
      },

      'search:query': (query) => {
        const q = query.trim();
        if (!q) return { query: q, hits: [], answer: null };
        const hits = this.repo.search(p(), q);
        const isQuestion =
          /\?\s*$/.test(q) ||
          /^(?:what|who|when|where|why|how|did|do|does|is|are|which|list|show me|tell me|any)\b/i.test(
            q,
          );
        const answer = isQuestion ? answerQuestion(q, this.repo.memory(p(), q), me()) : null;
        return { query: q, hits, answer };
      },

      'data:deleteAll': async () => {
        if (this.session.isActive) await this.stopCapture();
        await this.processor.idle();
        this.repo.deleteAll(p());
        rmSync(this.audioRoot, { recursive: true, force: true });
        rmSync(join(this.deps.dataDir, 'test-outbox'), { recursive: true, force: true });
        this.deps.emit({ type: 'meetings-changed' });
        this.deps.emit({ type: 'tasks-changed' });
      },
      'data:loadSamples': async () => {
        await loadSampleData(this.repo, p(), this.settings, this.deps.now);
        this.deps.emit({ type: 'meetings-changed' });
        this.deps.emit({ type: 'tasks-changed' });
      },
      'data:removeSamples': () => {
        removeSampleData(this.repo, p(), this.settings);
        this.deps.emit({ type: 'meetings-changed' });
        this.deps.emit({ type: 'tasks-changed' });
      },
    };
  }

  private failure(id: string): string {
    const row = this.db.prepare('SELECT error FROM meetings WHERE id = ?').get(id) as
      { error: string | null } | undefined;
    return row?.error ?? 'Meeting processing failed.';
  }
}

/** Turn any error into a message that is safe and useful to show. */
export function userMessage(err: unknown): { message: string; code: string } {
  if (err instanceof AccessDeniedError) return { message: err.message, code: 'forbidden' };
  if (err instanceof NotFoundError) return { message: err.message, code: 'not_found' };
  if (err instanceof Error && err.name === 'ZodError')
    return { message: 'That request was not valid.', code: 'invalid' };
  return {
    message:
      'Something went wrong. Please try again. If it keeps happening, the log file has details.',
    code: 'internal',
  };
}
