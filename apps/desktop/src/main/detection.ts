import { desktopCapturer } from 'electron';
import type { DetectedMeeting } from '../shared/types';
import { detectFromTitles } from './detection-rules';
import { log } from './log';

/**
 * Looks at open window titles every few seconds to notice a meeting.
 * On macOS this needs Screen Recording permission; without it, detection
 * quietly does nothing and "Start taking notes" still works.
 */
export class MeetingDetector {
  private timer: NodeJS.Timeout | null = null;
  private current: DetectedMeeting | null = null;
  private busy = false;

  constructor(
    private readonly onChange: (m: DetectedMeeting | null) => void,
    private readonly ownTitles: () => string[],
  ) {}

  get detected(): DetectedMeeting | null {
    return this.current;
  }

  start(intervalMs = 5000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), intervalMs);
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.current) {
      this.current = null;
      this.onChange(null);
    }
  }

  private async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      });
      const own = new Set(this.ownTitles());
      const found = detectFromTitles(
        sources.map((s) => s.name),
        (t) => own.has(t),
      );
      const changed = (found?.windowTitle ?? null) !== (this.current?.windowTitle ?? null);
      this.current = found;
      if (changed) {
        log.info('meeting_detection_changed', { platform: found?.platform ?? null });
        this.onChange(found);
      }
    } catch (err) {
      log.debug('meeting_detection_failed', { error: err instanceof Error ? err : String(err) });
    } finally {
      this.busy = false;
    }
  }
}
