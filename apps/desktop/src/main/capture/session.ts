import { closeSync, existsSync, mkdirSync, openSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform, Principal, TranscriptSegment } from '@meeting-assistant/core';
import { PLATFORM_LABELS, segmentId } from '@meeting-assistant/core';
import type { Repo } from '../db/repo';
import type {
  CaptureProblem,
  CaptureSource,
  CaptureStatus,
  ChannelHealth,
  Hearing,
  ProblemCode,
  ScreenHealth,
} from '../../shared/types';
import type { CaptureChannelName } from '../../shared/ipc';
import { log } from '../log';
import { labelFor } from './labels';

export const SAMPLE_RATE = 16_000;
const NO_AUDIO_MS = 4_000;
const SILENCE_MS = 180_000;
/** A microphone that sends only digital zeros this long is muted or cut off by the system. */
const MUTED_MS = 30_000;

/** A finished piece of speech from the speech engine. */
export interface SpeechSegment {
  channel: CaptureChannelName;
  startMs: number;
  endMs: number;
  text: string;
  /** "mic" for the microphone, "spk-1".. for voices in meeting audio. */
  speakerKey: string;
}

export interface Transcriber {
  /** Resolves when ready; rejects with a plain-language error. */
  start(): Promise<void>;
  push(channel: CaptureChannelName, samples: Float32Array): void;
  /** Transcribe whatever is buffered. */
  flush(): Promise<void>;
  stop(): Promise<void>;
  onSegment(cb: (s: SpeechSegment) => void): void;
  onFailure(cb: (message: string) => void): void;
  /** Optional end-of-meeting speaker relabeling for meeting-audio segments. */
  finalizeSpeakers?(): Promise<{ startMs: number; speakerKey: string }[]>;
}

export interface SessionDeps {
  repo: Repo;
  principal: () => Principal;
  audioRoot: string;
  now: () => Date;
  timeZone: () => string;
  createTranscriber: () => Transcriber | null;
  onStatus: (s: CaptureStatus) => void;
  onFinished: (meetingId: string, info: { transcribed: boolean; hasAudio: boolean }) => void;
}

interface ChannelState extends ChannelHealth {
  lastAudioAt: number;
  lastLoudAt: number;
  lastNonZeroAt: number;
  samples: number;
  fd: number | null;
  startedAt: number;
}

const emptyChannel = (): ChannelState => ({
  enabled: false,
  receiving: false,
  level: 0,
  problem: null,
  lastAudioAt: 0,
  lastLoudAt: 0,
  lastNonZeroAt: 0,
  samples: 0,
  fd: null,
  startedAt: 0,
});

/**
 * One meeting capture. Transcript lines are saved the moment they exist and
 * raw audio is appended to disk continuously, so a crash loses seconds, not
 * the meeting.
 */
export class CaptureSession {
  private state: CaptureStatus['state'] = 'idle';
  private source: CaptureSource = 'live';
  private meetingId: string | null = null;
  private title = '';
  private platform: Platform = 'other';
  private startedAt: Date | null = null;
  private activeMs = 0;
  private resumedAt: number | null = null;
  private mic = emptyChannel();
  private system = emptyChannel();
  private screenFrames = 0;
  private screenEnabled = false;
  private screenState: ScreenHealth['state'] = 'off';
  private problems = new Map<ProblemCode, CaptureProblem>();
  private transcriber: Transcriber | null = null;
  private transcriberReady = false;
  private transcriberFailed = false;
  private segmentsCount = 0;
  private lastLines: CaptureStatus['lastLines'] = [];
  private speakerLabels = new Map<string, string>();
  /** Audio that arrived while the speech engine was still loading. */
  private pending: { channel: CaptureChannelName; samples: Float32Array }[] = [];
  private pendingSamples = 0;
  private healthTimer: NodeJS.Timeout | null = null;
  private emitTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: SessionDeps) {}

  get id(): string | null {
    return this.meetingId;
  }

  get isActive(): boolean {
    return this.state !== 'idle';
  }

  status(): CaptureStatus {
    const pub = (c: ChannelState): ChannelHealth => ({
      enabled: c.enabled,
      receiving: c.receiving,
      level: c.level,
      problem: c.problem,
    });
    return {
      state: this.state,
      source: this.source,
      meetingId: this.meetingId,
      title: this.title,
      platform: this.platform,
      startedAt: this.startedAt?.toISOString() ?? null,
      elapsedMs: this.elapsed(),
      mic: pub(this.mic),
      system: pub(this.system),
      hearing: this.hearing(),
      screen: {
        enabled: this.screenEnabled,
        state: this.screenEnabled ? this.screenState : 'off',
        keyframes: this.screenFrames,
      },
      segmentsCount: this.segmentsCount,
      lastLines: this.lastLines,
      problems: [...this.problems.values()],
    };
  }

  /** What the app can honestly say about the audio it is getting right now. */
  private hearing(): Hearing {
    if (this.source !== 'live' || this.state === 'idle') return 'ok';
    const channels = [this.mic, this.system];
    const wanted = channels.filter((c) => c.enabled || c.problem);
    const live = channels.filter((c) => c.enabled && c.receiving);
    if (live.length === 0) {
      const grace =
        channels.some((c) => c.enabled) &&
        !channels.some((c) => c.problem) &&
        Date.now() - Math.max(this.mic.startedAt, this.system.startedAt) < NO_AUDIO_MS;
      return grace ? 'starting' : 'none';
    }
    return live.length < wanted.length || this.problems.has('mic_muted') ? 'partial' : 'ok';
  }

  elapsedMs(): number {
    return this.elapsed();
  }

  private elapsed(): number {
    return this.activeMs + (this.resumedAt !== null ? Date.now() - this.resumedAt : 0);
  }

  private emit(immediate = false): void {
    if (immediate) {
      if (this.emitTimer) clearTimeout(this.emitTimer);
      this.emitTimer = null;
      this.deps.onStatus(this.status());
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.deps.onStatus(this.status());
    }, 250);
  }

  // ------------------------------------------------------------------ lifecycle

  /**
   * Start a meeting. Calling start while already capturing returns the
   * current meeting instead of creating a second one.
   */
  async start(opts: {
    title?: string;
    platform?: Platform;
    source?: CaptureSource;
    mic: boolean;
    system: boolean;
    screen: boolean;
  }): Promise<CaptureStatus> {
    if (this.state !== 'idle') return this.status();
    this.state = 'starting';
    this.source = opts.source ?? 'live';
    this.platform = opts.platform ?? 'other';
    this.startedAt = this.deps.now();
    this.title =
      opts.title?.trim() || defaultTitle(this.platform, this.startedAt, this.deps.timeZone());
    this.problems.clear();
    this.mic = { ...emptyChannel(), enabled: opts.mic && this.source === 'live' };
    this.system = { ...emptyChannel(), enabled: opts.system && this.source === 'live' };
    this.screenEnabled = opts.screen && this.source === 'live';
    this.screenState = 'looking';
    this.screenFrames = 0;
    this.segmentsCount = 0;
    this.lastLines = [];
    this.speakerLabels.clear();
    this.activeMs = 0;
    this.resumedAt = Date.now();
    this.transcriberFailed = false;
    this.transcriberReady = false;
    this.pending = [];
    this.pendingSamples = 0;

    this.meetingId = this.deps.repo.createMeeting(this.deps.principal(), {
      title: this.title,
      platform: this.platform,
      startedAt: this.startedAt.toISOString(),
      timeZone: this.deps.timeZone(),
      source: this.source,
    });
    log.info('capture_started', {
      meetingId: this.meetingId,
      source: this.source,
      platform: this.platform,
      mic: this.mic.enabled,
      system: this.system.enabled,
    });

    if (this.source === 'live') {
      mkdirSync(this.audioDir(), { recursive: true });
      for (const [name, ch] of [
        ['mic', this.mic],
        ['system', this.system],
      ] as const) {
        if (ch.enabled) {
          ch.fd = openSync(join(this.audioDir(), `${name}.pcm`), 'a', 0o600);
          ch.startedAt = Date.now();
        }
      }
      this.transcriber = this.deps.createTranscriber();
      if (!this.transcriber) {
        this.problem(
          'models_missing',
          'The speech engine is not downloaded yet. Your audio is being saved and will be transcribed when it is ready.',
          {
            label: 'Download now',
            kind: 'download_models',
          },
        );
      } else {
        this.transcriber.onSegment((s) => this.onSpeech(s));
        this.transcriber.onFailure((m) => this.onTranscriberFailure(m));
        this.transcriber.start().then(
          () => {
            this.transcriberReady = true;
            for (const p of this.pending) this.transcriber?.push(p.channel, p.samples);
            this.pending = [];
            this.pendingSamples = 0;
          },
          (err: Error) => this.onTranscriberFailure(err.message),
        );
      }
    }
    this.state = 'capturing';
    this.healthTimer = setInterval(() => this.checkHealth(), 1000);
    this.emit(true);
    return this.status();
  }

  pause(reason?: 'asleep'): CaptureStatus {
    if (this.state !== 'capturing') return this.status();
    this.activeMs = this.elapsed();
    this.resumedAt = null;
    this.state = 'paused';
    if (reason === 'asleep')
      this.problem('asleep', 'Notes were paused while your computer was asleep.', {
        label: 'Resume',
        kind: 'resume',
      });
    if (this.meetingId) this.deps.repo.setStatus(this.deps.principal(), this.meetingId, 'paused');
    this.emit(true);
    return this.status();
  }

  resume(): CaptureStatus {
    if (this.state !== 'paused') return this.status();
    this.resumedAt = Date.now();
    this.state = 'capturing';
    this.problems.delete('asleep');
    const now = Date.now();
    for (const ch of [this.mic, this.system]) if (ch.enabled) ch.lastAudioAt = now;
    if (this.meetingId)
      this.deps.repo.setStatus(this.deps.principal(), this.meetingId, 'capturing');
    this.emit(true);
    return this.status();
  }

  /** Stop capturing, finish transcription, and hand the meeting to processing. */
  async stop(): Promise<CaptureStatus> {
    if (this.state === 'idle' || this.state === 'stopping') return this.status();
    this.activeMs = this.elapsed();
    this.resumedAt = null;
    this.state = 'stopping';
    this.emit(true);
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
    const meetingId = this.meetingId!;
    let transcribed = true;
    if (this.transcriber) {
      try {
        if (this.transcriberReady && !this.transcriberFailed) {
          await this.transcriber.flush();
          const labels = (await this.transcriber.finalizeSpeakers?.()) ?? [];
          if (labels.length)
            this.deps.repo.relabelSpeakers(this.deps.principal(), meetingId, labels);
        }
      } catch (err) {
        log.warn('transcriber_flush_failed', {
          meetingId,
          error: err instanceof Error ? err : String(err),
        });
      }
      await this.transcriber.stop().catch(() => undefined);
    }
    if (
      this.source === 'live' &&
      (!this.transcriber || this.transcriberFailed || !this.transcriberReady)
    )
      transcribed = false;
    for (const ch of [this.mic, this.system]) {
      if (ch.fd !== null) closeSync(ch.fd);
      ch.fd = null;
    }
    const hasAudio = this.source === 'live' && (this.mic.samples > 0 || this.system.samples > 0);
    this.deps.repo.setStatus(this.deps.principal(), meetingId, 'processing', {
      endedAt: this.deps.now().toISOString(),
      durationMs: this.activeMs,
      stage: transcribed ? 'queued' : 'waiting-for-speech-engine',
    });
    log.info('capture_stopped', {
      meetingId,
      ms: this.activeMs,
      segments: this.segmentsCount,
      transcribed,
      hasAudio,
    });
    this.transcriber = null;
    this.state = 'idle';
    const final = this.status();
    this.meetingId = null;
    this.emit(true);
    this.deps.onFinished(meetingId, { transcribed, hasAudio });
    return { ...final, state: 'idle' };
  }

  // ------------------------------------------------------------------ input

  /** Audio from the capture window or AudioTee: 16 kHz mono float samples. */
  ingest(channel: CaptureChannelName, samples: Float32Array): void {
    const ch = channel === 'mic' ? this.mic : this.system;
    if (this.state !== 'capturing' || !ch.enabled || samples.length === 0) return;
    const now = Date.now();
    ch.lastAudioAt = now;
    if (!ch.receiving) {
      ch.receiving = true;
      ch.problem = null;
      this.problems.delete(channel === 'mic' ? 'mic_lost' : 'system_audio_lost');
    }
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
    if (sum > 0) {
      ch.lastNonZeroAt = now;
      if (channel === 'mic' && this.problems.delete('mic_muted')) this.emit(true);
    }
    const rms = Math.sqrt(sum / samples.length);
    const db = 20 * Math.log10(rms + 1e-9);
    const level = Math.max(0, Math.min(1, (db + 60) / 60));
    ch.level = ch.level * 0.6 + level * 0.4;
    if (level > 0.25) {
      ch.lastLoudAt = now;
      if (channel === 'system') this.problems.delete('silence');
    }
    if (ch.fd !== null) {
      const pcm = Buffer.alloc(samples.length * 2);
      for (let i = 0; i < samples.length; i++)
        pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767))), i * 2);
      try {
        writeSync(ch.fd, pcm);
      } catch (err) {
        log.error('audio_write_failed', {
          channel,
          error: err instanceof Error ? err : String(err),
        });
      }
    }
    ch.samples += samples.length;
    if (this.transcriber && !this.transcriberFailed) {
      if (this.transcriberReady) this.transcriber.push(channel, samples);
      else if (this.pendingSamples < SAMPLE_RATE * 120) {
        this.pending.push({ channel, samples });
        this.pendingSamples += samples.length;
      }
    }
    this.emit();
  }

  /** Transcript lines that arrive without audio (demo meetings). */
  ingestSegment(s: {
    speakerId: string;
    speaker: string;
    text: string;
    startMs: number;
    endMs: number;
  }): void {
    if (this.state !== 'capturing' || !this.meetingId) return;
    this.speakerLabels.set(s.speakerId, s.speaker);
    this.saveSegment({
      speakerId: s.speakerId,
      speaker: s.speaker,
      text: s.text,
      startMs: s.startMs,
      endMs: s.endMs,
      channel: 'import',
    });
  }

  screenKeyframe(): void {
    this.screenFrames++;
    this.emit();
  }

  setScreenState(state: ScreenHealth['state']): void {
    if (!this.screenEnabled || state === this.screenState) return;
    this.screenState = state;
    if (state === 'denied')
      this.problem(
        'screen_denied',
        'Slides and shared screens are not being read, because screen access is off. Audio notes are not affected.',
        { label: 'Open screen settings', kind: 'open_screen_settings' },
      );
    else this.problems.delete('screen_denied');
    this.emit(true);
  }

  /** Meeting-window watcher: the meeting seems to be over. Never stops by itself. */
  meetingWindowGone(gone: boolean): void {
    if (this.state !== 'capturing' && this.state !== 'paused') return;
    if (gone === this.problems.has('meeting_ended')) return;
    if (gone)
      this.problem(
        'meeting_ended',
        'The meeting window has closed. If the meeting is over, stop taking notes.',
        { label: 'Stop', kind: 'stop' },
      );
    else this.problems.delete('meeting_ended');
    this.emit(true);
  }

  /** A source came back (after an unplug, a device change or a retry). */
  channelStarted(channel: CaptureChannelName): void {
    const ch = channel === 'mic' ? this.mic : this.system;
    if (this.source !== 'live' || this.state === 'idle' || this.state === 'stopping') return;
    // A source that failed earlier was still wanted; one the user turned off was not.
    if (!ch.enabled && !ch.problem) return;
    ch.enabled = true;
    this.ensureFile(channel);
    ch.problem = null;
    ch.lastAudioAt = Date.now();
    ch.startedAt = Date.now();
    for (const code of channelCodes(channel)) this.problems.delete(code);
    this.emit(true);
  }

  /** Turn a failed source back on so it can be retried without stopping the meeting. */
  reopen(channel: CaptureChannelName): boolean {
    if (this.source !== 'live' || (this.state !== 'capturing' && this.state !== 'paused'))
      return false;
    const ch = channel === 'mic' ? this.mic : this.system;
    if (ch.enabled && ch.receiving) return false;
    ch.enabled = true;
    ch.receiving = false;
    ch.problem = null;
    ch.startedAt = Date.now();
    ch.lastAudioAt = 0;
    this.ensureFile(channel);
    for (const code of channelCodes(channel)) this.problems.delete(code);
    this.emit(true);
    return true;
  }

  private ensureFile(channel: CaptureChannelName): void {
    const ch = channel === 'mic' ? this.mic : this.system;
    if (ch.fd !== null) return;
    mkdirSync(this.audioDir(), { recursive: true });
    ch.fd = openSync(join(this.audioDir(), `${channel}.pcm`), 'a', 0o600);
  }

  /** Sources worth retrying: ones the user wanted that failed or went quiet. */
  failedChannels(): CaptureChannelName[] {
    return (['mic', 'system'] as const).filter((n) => {
      const ch = n === 'mic' ? this.mic : this.system;
      return !ch.receiving && ch.problem !== null;
    });
  }

  /** Report a capture failure in plain language (from the capture window, AudioTee, permissions). */
  channelFailed(
    channel: CaptureChannelName,
    code: ProblemCode,
    message: string,
    action?: CaptureProblem['action'],
  ): void {
    const ch = channel === 'mic' ? this.mic : this.system;
    ch.enabled = false;
    ch.receiving = false;
    ch.problem = message;
    this.problem(code, message, action);
    log.warn('capture_channel_failed', { channel, code });
    if (!this.mic.enabled && !this.system.enabled && this.source === 'live') {
      log.warn('capture_no_audio_sources', { meetingId: this.meetingId });
    }
    this.emit(true);
  }

  channelEnded(channel: CaptureChannelName): void {
    const ch = channel === 'mic' ? this.mic : this.system;
    if (!ch.enabled) return;
    ch.receiving = false;
    const never = ch.samples === 0;
    const msg =
      channel === 'mic'
        ? never
          ? 'No sound is coming from your microphone.'
          : 'Your microphone stopped sending audio.'
        : never
          ? 'No meeting audio is coming through. Check that the meeting sound is on and that Meeting Assistant is allowed to capture it.'
          : 'Meeting audio is no longer being captured.';
    ch.problem = msg;
    this.problem(channel === 'mic' ? 'mic_lost' : 'system_audio_lost', msg, {
      label: 'Check sound settings',
      kind: channel === 'mic' ? 'open_mic_settings' : 'open_audio_settings',
    });
    this.emit(true);
  }

  private problem(code: ProblemCode, message: string, action?: CaptureProblem['action']) {
    this.problems.set(code, { code, message, ...(action ? { action } : {}) });
  }

  private checkHealth(): void {
    if (this.state !== 'capturing' || this.source !== 'live') return;
    const now = Date.now();
    for (const [name, ch] of [
      ['mic', this.mic],
      ['system', this.system],
    ] as const) {
      if (!ch.enabled) continue;
      const since = now - (ch.lastAudioAt || ch.startedAt);
      if (since > NO_AUDIO_MS && (ch.receiving || now - ch.startedAt > NO_AUDIO_MS)) {
        if (ch.receiving || !this.problems.has(name === 'mic' ? 'mic_lost' : 'system_audio_lost'))
          this.channelEnded(name);
        ch.level = 0;
      }
    }
    if (
      this.mic.enabled &&
      this.mic.receiving &&
      now - (this.mic.lastNonZeroAt || this.mic.startedAt) > MUTED_MS &&
      !this.problems.has('mic_muted')
    ) {
      this.problem(
        'mic_muted',
        'Your microphone has sent no sound for a while. If you are talking, it may be muted or its access turned off.',
        { label: 'Open microphone settings', kind: 'open_mic_settings' },
      );
    }
    if (
      this.system.enabled &&
      this.system.receiving &&
      now - (this.system.lastLoudAt || this.system.startedAt) > SILENCE_MS &&
      !this.problems.has('silence')
    ) {
      this.problem(
        'silence',
        "We haven't heard any meeting audio for a few minutes. Check that the meeting's sound is on.",
      );
    }
    this.emit();
  }

  // ------------------------------------------------------------------ transcript

  private onSpeech(s: SpeechSegment): void {
    if (!this.meetingId) return;
    const label = labelFor(s.speakerKey, this.speakerLabels);
    this.saveSegment({
      speakerId: s.speakerKey,
      speaker: label,
      text: s.text,
      startMs: s.startMs,
      endMs: s.endMs,
      channel: s.channel,
    });
  }

  private saveSegment(s: Omit<TranscriptSegment, 'id'>): void {
    if (!this.meetingId) return;
    const text = s.text.trim();
    if (!text) return;
    this.segmentsCount++;
    const seg: TranscriptSegment = { ...s, text, id: segmentId(this.segmentsCount) };
    try {
      this.deps.repo.appendSegments(this.deps.principal(), this.meetingId, [seg]);
    } catch (err) {
      log.error('segment_save_failed', {
        meetingId: this.meetingId,
        error: err instanceof Error ? err : String(err),
      });
    }
    this.lastLines = [
      ...this.lastLines,
      { speaker: seg.speaker, text: seg.text, startMs: seg.startMs },
    ].slice(-6);
    this.emit();
  }

  private onTranscriberFailure(message: string): void {
    if (this.transcriberFailed) return;
    this.transcriberFailed = true;
    log.error('transcriber_failed', { meetingId: this.meetingId, error: message });
    this.problem(
      'transcriber_failed',
      'Live transcription stopped. Your audio is still being saved and will be transcribed after the meeting.',
    );
    this.emit(true);
  }

  audioDir(meetingId = this.meetingId): string {
    return join(this.deps.audioRoot, meetingId ?? 'unknown');
  }
}

function channelCodes(channel: CaptureChannelName): ProblemCode[] {
  return channel === 'mic'
    ? ['mic_denied', 'mic_lost', 'mic_muted']
    : ['system_audio_unavailable', 'system_audio_lost'];
}

export function audioFiles(
  audioRoot: string,
  meetingId: string,
): { mic: string | null; system: string | null } {
  const dir = join(audioRoot, meetingId);
  const f = (n: string) => (existsSync(join(dir, `${n}.pcm`)) ? join(dir, `${n}.pcm`) : null);
  return { mic: f('mic'), system: f('system') };
}

export function discardAudio(audioRoot: string, meetingId: string): void {
  rmSync(join(audioRoot, meetingId), { recursive: true, force: true });
}

export function defaultTitle(platform: Platform, at: Date, timeZone: string): string {
  const when = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(at);
  return platform === 'other'
    ? `Meeting, ${when}`
    : `${PLATFORM_LABELS[platform]} meeting, ${when}`;
}
