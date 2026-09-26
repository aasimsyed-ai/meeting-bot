/** IPC channel names shared with the sandboxed preload scripts (kept free of dependencies). */
export const APP_CHANNELS = {
  invoke: 'app:invoke',
  event: 'app:event',
} as const;

export const CAPTURE_CHANNELS = {
  audio: 'capture-window:audio',
  event: 'capture-window:event',
} as const;

export type CaptureChannelName = 'mic' | 'system';

export type CaptureWindowEvent =
  | { type: 'started'; channel: CaptureChannelName; label: string; sampleRate: number }
  | {
      type: 'failed';
      channel: CaptureChannelName;
      reason: 'denied' | 'not_found' | 'unsupported' | 'error';
      detail: string;
    }
  | { type: 'ended'; channel: CaptureChannelName }
  | { type: 'devices-changed' };

/** Test only: sources the capture page treats as refused by the OS or browser. */
export type TestDenied = Partial<Record<CaptureChannelName, boolean>>;

export type CaptureWindowCommand =
  | {
      type: 'start';
      mic: boolean;
      micDeviceId: string | null;
      system: boolean;
      denied?: TestDenied;
    }
  | {
      type: 'restart';
      channel: CaptureChannelName;
      micDeviceId: string | null;
      denied?: TestDenied;
    }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' };
