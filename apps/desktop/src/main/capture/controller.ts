import {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session as electronSession,
  type IpcMainEvent,
} from 'electron';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { phoenixWeekly } from '@meeting-assistant/core/fixtures';
import type { CaptureSession } from './session';
import {
  CAPTURE_CHANNELS,
  type CaptureChannelName,
  type CaptureWindowCommand,
  type CaptureWindowEvent,
} from '../../shared/ipc';
import { macSupportsSystemAudio, type Permissions } from '../permissions';
import { log } from '../log';

const CAPTURE_PARTITION = 'capture';

interface AudioTeeLike {
  on(event: 'data', l: (c: { data: Buffer }) => void): unknown;
  on(event: 'error', l: (e: Error) => void): unknown;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Connects operating-system audio to a CaptureSession:
 * - microphone: a hidden capture window using getUserMedia (all platforms)
 * - meeting audio on Windows/Linux: Chromium loopback via getDisplayMedia
 * - meeting audio on macOS 14.2+: AudioTee (Core Audio taps)
 * Nothing here records video; the display stream's video track is stopped at once.
 */
export class CaptureController {
  private win: BrowserWindow | null = null;
  private audiotee: AudioTeeLike | null = null;
  private demoTimers: NodeJS.Timeout[] = [];
  private listening = false;

  constructor(
    private readonly session: CaptureSession,
    private readonly permissions: Permissions,
    private readonly opts: {
      preloadDir: string;
      rendererUrl: string | null;
      rendererDir: string;
      demoSpeed: number;
      audioteeBinary: () => string | undefined;
      /** Test only: stream this 16 kHz WAV as meeting audio instead of the OS source. */
      testMeetingAudio?: string | null;
    },
  ) {}

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    ipcMain.on(
      CAPTURE_CHANNELS.audio,
      (e: IpcMainEvent, channel: CaptureChannelName, data: ArrayBuffer) => {
        if (!this.win || e.sender !== this.win.webContents) return;
        if (
          (channel !== 'mic' && channel !== 'system') ||
          !(data instanceof ArrayBuffer) ||
          data.byteLength > 64_000
        )
          return;
        this.session.ingest(channel, new Float32Array(data));
      },
    );
    ipcMain.on(CAPTURE_CHANNELS.event, (e: IpcMainEvent, evt: CaptureWindowEvent) => {
      if (!this.win || e.sender !== this.win.webContents) return;
      this.onWindowEvent(evt);
    });
  }

  private onWindowEvent(evt: CaptureWindowEvent): void {
    if (evt.type === 'failed') {
      log.warn('capture_window_failed', { channel: evt.channel, reason: evt.reason });
      if (evt.channel === 'mic') {
        const denied = evt.reason === 'denied';
        this.session.channelFailed(
          'mic',
          denied ? 'mic_denied' : 'mic_lost',
          denied
            ? 'Microphone access is off, so your own voice is not being captured.'
            : evt.reason === 'not_found'
              ? 'No microphone was found. Notes will use meeting audio only.'
              : 'The microphone could not be started.',
          { label: 'Open microphone settings', kind: 'open_mic_settings' },
        );
      } else {
        this.session.channelFailed(
          'system',
          'system_audio_unavailable',
          process.platform === 'linux'
            ? 'Meeting audio could not be captured. It needs PulseAudio or PipeWire. Notes will use your microphone.'
            : 'Meeting audio could not be captured. Notes will use your microphone only.',
          { label: 'Check sound settings', kind: 'open_audio_settings' },
        );
      }
    } else if (evt.type === 'ended') {
      this.session.channelEnded(evt.channel);
    } else if (evt.type === 'started' && evt.channel === 'system') {
      this.permissions.markSystemAudio(true);
    }
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.listen();
    const ses = electronSession.fromPartition(CAPTURE_PARTITION);
    ses.setPermissionRequestHandler((_wc, permission, cb) =>
      cb(permission === 'media' || permission === 'display-capture'),
    );
    ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');
    // Windows and Linux: give getDisplayMedia the primary screen with loopback audio.
    ses.setDisplayMediaRequestHandler(
      (_req, cb) => {
        desktopCapturer
          .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
          .then((sources) => cb(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
          .catch(() => cb({}));
      },
      { useSystemPicker: false },
    );
    this.win = new BrowserWindow({
      show: false,
      width: 320,
      height: 200,
      skipTaskbar: true,
      webPreferences: {
        partition: CAPTURE_PARTITION,
        preload: join(this.opts.preloadDir, 'capture.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.win.webContents.on('will-navigate', (e) => e.preventDefault());
    if (this.opts.rendererUrl) await this.win.loadURL(`${this.opts.rendererUrl}/capture.html`);
    else await this.win.loadFile(join(this.opts.rendererDir, 'capture.html'));
    return this.win;
  }

  private async command(cmd: CaptureWindowCommand, gesture = false): Promise<void> {
    const win = await this.ensureWindow();
    // Start runs as a user gesture so screen-audio capture is allowed.
    await win.webContents.executeJavaScript(
      `window.__capture && window.__capture.run(${JSON.stringify(cmd)})`,
      gesture,
    );
  }

  async startLive(opts: {
    mic: boolean;
    micDeviceId: string | null;
    system: boolean;
  }): Promise<void> {
    if (this.opts.testMeetingAudio) {
      await this.command(
        { type: 'start', mic: opts.mic, micDeviceId: opts.micDeviceId, system: false },
        true,
      );
      this.streamTestAudio(this.opts.testMeetingAudio);
      return;
    }
    const useAudioTee = opts.system && process.platform === 'darwin';
    if (opts.system && process.platform === 'darwin' && !macSupportsSystemAudio()) {
      this.session.channelFailed(
        'system',
        'system_audio_unavailable',
        'Hearing meeting audio needs macOS 14.2 or later. Notes will use your microphone only.',
      );
    }
    await this.command(
      {
        type: 'start',
        mic: opts.mic,
        micDeviceId: opts.micDeviceId,
        system: opts.system && !useAudioTee,
      },
      true,
    );
    if (useAudioTee && macSupportsSystemAudio()) await this.startAudioTee();
  }

  private async startAudioTee(): Promise<void> {
    try {
      const { AudioTee } = (await import('audiotee')) as unknown as {
        AudioTee: new (o: Record<string, unknown>) => AudioTeeLike;
      };
      const tee = new AudioTee({
        sampleRate: 16000,
        chunkDurationMs: 100,
        binaryPath: this.opts.audioteeBinary(),
      });
      let first = true;
      tee.on('data', (chunk) => {
        if (first) {
          first = false;
          this.permissions.markSystemAudio(true);
        }
        const n = Math.floor(chunk.data.length / 2);
        const f = new Float32Array(n);
        for (let i = 0; i < n; i++) f[i] = chunk.data.readInt16LE(i * 2) / 32768;
        this.session.ingest('system', f);
      });
      tee.on('error', (err) => {
        log.error('audiotee_error', { error: err });
        this.session.channelEnded('system');
      });
      await tee.start();
      this.audiotee = tee;
    } catch (err) {
      log.error('audiotee_start_failed', { error: err instanceof Error ? err : String(err) });
      this.permissions.markSystemAudio(false);
      this.session.channelFailed(
        'system',
        'system_audio_unavailable',
        'Meeting audio could not be captured. Allow Meeting Assistant under System Settings, Privacy & Security, Screen & System Audio Recording.',
        { label: 'Open settings', kind: 'open_audio_settings' },
      );
    }
  }

  /** Probe used by onboarding to trigger the macOS system-audio prompt. */
  async probeSystemAudio(): Promise<boolean> {
    if (process.platform !== 'darwin' || !macSupportsSystemAudio())
      return process.platform !== 'darwin';
    try {
      const { AudioTee } = (await import('audiotee')) as unknown as {
        AudioTee: new (o: Record<string, unknown>) => AudioTeeLike;
      };
      const tee = new AudioTee({
        sampleRate: 16000,
        chunkDurationMs: 100,
        binaryPath: this.opts.audioteeBinary(),
      });
      const ok = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 4000);
        tee.on('data', () => {
          clearTimeout(t);
          resolve(true);
        });
        tee.on('error', () => resolve(false));
        tee.start().catch(() => resolve(false));
      });
      await tee.stop().catch(() => undefined);
      return ok;
    } catch {
      return false;
    }
  }

  /** Test only: feed a WAV file as meeting audio, in real time, through the normal session path. */
  private streamTestAudio(file: string): void {
    const buf = readFileSync(file);
    const dataAt = buf.indexOf('data') + 8;
    const samples = new Float32Array((buf.length - dataAt) / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(dataAt + i * 2) / 32768;
    let pos = 0;
    const step = () => {
      if (pos >= samples.length) return;
      this.session.ingest('system', samples.slice(pos, pos + 1600));
      pos += 1600;
      this.demoTimers.push(setTimeout(step, 100 / this.opts.demoSpeed));
    };
    step();
  }

  /** Plays the Project Phoenix sample meeting through the real pipeline, clearly labelled as a sample. */
  startDemo(): void {
    const speed = this.opts.demoSpeed;
    const segs = phoenixWeekly.segments;
    const t0 = segs[0]!.startMs;
    for (const s of segs) {
      this.demoTimers.push(
        setTimeout(
          () =>
            this.session.ingestSegment({
              speakerId: s.speakerId,
              speaker: s.speaker,
              text: s.text,
              startMs: s.startMs,
              endMs: s.endMs,
            }),
          (s.startMs - t0) / speed + 300,
        ),
      );
    }
  }

  async pause(): Promise<void> {
    if (this.win) await this.command({ type: 'pause' });
  }

  async resume(): Promise<void> {
    if (this.win) await this.command({ type: 'resume' });
  }

  async stop(): Promise<void> {
    for (const t of this.demoTimers) clearTimeout(t);
    this.demoTimers = [];
    if (this.audiotee) {
      await this.audiotee.stop().catch(() => undefined);
      this.audiotee = null;
    }
    if (this.win && !this.win.isDestroyed()) {
      await this.command({ type: 'stop' }).catch(() => undefined);
    }
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
