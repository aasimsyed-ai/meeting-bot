import { autoUpdater } from 'electron-updater';
import type { AppEvent } from '../shared/types';
import { log } from './log';

/**
 * Update checks through GitHub Releases (electron-updater). Only active in
 * packaged production builds. macOS auto-update requires a signed and
 * notarized app; unsigned builds only report that an update exists.
 */
export function setupUpdater(opts: { enabled: boolean; emit: (e: AppEvent) => void }) {
  let state: 'disabled' | 'checking' | 'up-to-date' | 'available' = opts.enabled
    ? 'up-to-date'
    : 'disabled';
  if (opts.enabled) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    autoUpdater.on('update-available', (info) => {
      state = 'available';
      opts.emit({ type: 'update', state: 'available', version: info.version });
    });
    autoUpdater.on('update-downloaded', (info) =>
      opts.emit({ type: 'update', state: 'downloaded', version: info.version }),
    );
    autoUpdater.on('update-not-available', () => (state = 'up-to-date'));
    autoUpdater.on('error', (err) => log.warn('update_check_failed', { error: err }));
    setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 30_000);
    setInterval(
      () => void autoUpdater.checkForUpdates().catch(() => undefined),
      6 * 60 * 60 * 1000,
    );
  }
  return {
    async check(): Promise<{ state: typeof state; message: string }> {
      if (!opts.enabled)
        return { state: 'disabled', message: 'Automatic updates are off in this build.' };
      state = 'checking';
      try {
        const r = await autoUpdater.checkForUpdates();
        const newer = r?.isUpdateAvailable;
        state = newer ? 'available' : 'up-to-date';
        return {
          state,
          message: newer
            ? `Version ${r!.updateInfo.version} is downloading. It installs when you quit the app.`
            : 'You have the latest version.',
        };
      } catch {
        state = 'up-to-date';
        return { state, message: 'Could not check for updates right now.' };
      }
    },
  };
}
