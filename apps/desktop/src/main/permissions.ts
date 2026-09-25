import { desktopCapturer, shell, systemPreferences } from 'electron';
import type { PermissionKind, PermissionState, PermissionStatus } from '../shared/types';
import { log } from './log';

/** macOS 14.2 added the Core Audio taps API used to hear meeting audio. */
export function macSupportsSystemAudio(version = process.getSystemVersion()): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 14 || (major === 14 && minor >= 2);
}

const SETTINGS_LINKS: Record<string, Partial<Record<PermissionKind, string>>> = {
  darwin: {
    microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    systemAudio: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture',
  },
  win32: {
    microphone: 'ms-settings:privacy-microphone',
    systemAudio: 'ms-settings:sound',
  },
};

export class Permissions {
  /** macOS gives no API for system-audio status, so we remember whether audio ever arrived. */
  private systemAudioSeen: boolean | null = null;

  constructor(private readonly fake: boolean) {}

  markSystemAudio(ok: boolean): void {
    this.systemAudioSeen = ok;
  }

  status(): PermissionStatus {
    if (this.fake)
      return { microphone: 'granted', screen: 'granted', systemAudio: 'granted', help: {} };
    const help: PermissionStatus['help'] = {};
    const platform = process.platform;
    let microphone: PermissionState = 'granted';
    let screen: PermissionState = 'granted';
    let systemAudio: PermissionState = 'granted';

    if (platform === 'darwin' || platform === 'win32') {
      microphone = map(systemPreferences.getMediaAccessStatus('microphone'));
    }
    if (platform === 'darwin') {
      screen = map(systemPreferences.getMediaAccessStatus('screen'));
      systemAudio = !macSupportsSystemAudio()
        ? 'unsupported'
        : this.systemAudioSeen === null
          ? 'not-determined'
          : this.systemAudioSeen
            ? 'granted'
            : 'denied';
    }
    if (platform === 'linux') systemAudio = 'unknown';

    if (microphone === 'denied' || microphone === 'restricted') {
      help.microphone =
        platform === 'darwin'
          ? 'Microphone access is off. Open System Settings, then Privacy & Security, then Microphone, and turn on Meeting Assistant.'
          : 'Microphone access is off. Open Settings, then Privacy & security, then Microphone, and turn on "Let desktop apps access your microphone".';
    }
    if (platform === 'darwin' && screen !== 'granted') {
      help.screen =
        'Screen access lets the app see which meeting you are in and read shared slides. Open System Settings, then Privacy & Security, then Screen & System Audio Recording, and turn on Meeting Assistant.';
    }
    if (systemAudio === 'unsupported')
      help.systemAudio =
        'Hearing meeting audio needs macOS 14.2 or later. Notes will use your microphone only.';
    else if (platform === 'darwin' && systemAudio !== 'granted')
      help.systemAudio =
        'To hear the meeting, allow Meeting Assistant under System Settings, then Privacy & Security, then Screen & System Audio Recording.';
    else if (platform === 'linux')
      help.systemAudio =
        'Meeting audio on Linux needs PulseAudio or PipeWire. If it is not available, notes use your microphone.';
    return { microphone, screen, systemAudio, help };
  }

  async request(
    kind: PermissionKind,
    probeSystemAudio: () => Promise<boolean>,
  ): Promise<PermissionStatus> {
    if (this.fake) return this.status();
    try {
      if (kind === 'microphone' && process.platform === 'darwin') {
        await systemPreferences.askForMediaAccess('microphone');
      } else if (kind === 'screen' && process.platform === 'darwin') {
        // Listing windows makes macOS show its permission prompt the first time.
        await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1, height: 1 },
        });
      } else if (kind === 'systemAudio') {
        this.systemAudioSeen = await probeSystemAudio();
      }
    } catch (err) {
      log.warn('permission_request_failed', {
        kind,
        error: err instanceof Error ? err : String(err),
      });
    }
    return this.status();
  }

  async openSettings(kind: PermissionKind): Promise<void> {
    const link = SETTINGS_LINKS[process.platform]?.[kind];
    if (link) await shell.openExternal(link);
  }
}

function map(s: string): PermissionState {
  if (s === 'granted' || s === 'denied' || s === 'restricted' || s === 'not-determined') return s;
  return 'unknown';
}
