import type { ScreenNote } from '@meeting-assistant/core';
import type { DetectedMeeting, ScreenHealth } from '../../shared/types';
import { detectFromTitles } from '../detection-rules';
import { log } from '../log';

/** A small grayscale thumbnail used only to notice that the picture changed. */
export type Signature = Uint8Array;

export interface ScreenSource {
  /** Open windows, or 'denied' when the OS does not let the app see them. */
  listWindows(): Promise<{ id: string; title: string }[] | 'denied'>;
  /**
   * One still picture of a window: a tiny signature to notice changes, and the full
   * picture as a PNG, fetched only when it is going to be read.
   */
  grab(id: string): Promise<{ signature: Signature; png: () => Promise<Buffer | null> } | null>;
  /** Text in a PNG, read on this computer. */
  readText(png: Buffer): Promise<string>;
  /** Free the text reader when a meeting ends. */
  release?(): Promise<void>;
}

export interface ScreenTarget {
  isActive(): boolean;
  isPaused(): boolean;
  elapsedMs(): number;
  setScreenState(state: ScreenHealth['state']): void;
  screenKeyframe(): void;
  meetingWindowGone(gone: boolean): void;
  save(note: ScreenNote): void;
}

/** Size of the grayscale thumbnail used to notice changes (a 16 x 9 grid of 8 px cells). */
export const SIG_W = 128;
export const SIG_H = 72;
const CELL = 8;
const COLS = SIG_W / CELL;
const ROWS = SIG_H / CELL;
/** A cell that moved less than this between two looks is holding still. */
const STILL = 0.012;
/** A cell that differs this much from the last picture read has new content. */
const NEW_CONTENT = 0.025;
/** New content must cover at least this many settled cells (a cursor blink is not a slide). */
const MIN_CELLS = 3;
/** How long the meeting window can be missing before the app suggests stopping. */
const GONE_MS = 15_000;
const MAX_TEXT = 2000;

/** Mean absolute difference of two signatures, 0 (same) to 1. */
export function frameDiff(a: Signature, b: Signature): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length / 255;
}

/** Per-cell mean difference (0 to 1) of two SIG_W x SIG_H signatures. */
export function cellDiffs(a: Signature, b: Signature): Float32Array {
  const out = new Float32Array(COLS * ROWS);
  if (a.length !== SIG_W * SIG_H || b.length !== a.length) return out.fill(1);
  for (let y = 0; y < SIG_H; y++)
    for (let x = 0; x < SIG_W; x++) {
      const i = y * SIG_W + x;
      out[Math.floor(y / CELL) * COLS + Math.floor(x / CELL)]! += Math.abs(a[i]! - b[i]!);
    }
  for (let c = 0; c < out.length; c++) out[c] = out[c]! / (CELL * CELL * 255);
  return out;
}

/**
 * Should this picture be read? Only when part of it has new content since the last
 * picture read, and that part has settled (not mid-animation or mid-scroll). Parts that
 * never hold still, like webcam tiles, are ignored, so a slide next to live video is
 * still read.
 */
export function isNewKeyframe(
  previous: Signature | null,
  now: Signature,
  lastRead: Signature | null,
): boolean {
  if (!previous) return false;
  const still = cellDiffs(previous, now);
  if (!lastRead) return [...still].filter((d) => d < STILL).length >= still.length / 2;
  const fresh = cellDiffs(lastRead, now);
  let changed = 0;
  for (let c = 0; c < fresh.length; c++)
    if (fresh[c]! > NEW_CONTENT && still[c]! < STILL) changed++;
  return changed >= MIN_CELLS;
}

/** Grayscale signature from a BGRA bitmap (what Electron's NativeImage.toBitmap returns). */
export function signatureFromBgra(bitmap: Buffer | Uint8Array): Signature {
  const out = new Uint8Array(Math.floor(bitmap.length / 4));
  for (let i = 0; i < out.length; i++) {
    const b = bitmap[i * 4]!;
    const g = bitmap[i * 4 + 1]!;
    const r = bitmap[i * 4 + 2]!;
    out[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return out;
}

/** Tidy text read from the screen: keep lines that look like words, cap the length. */
export function cleanScreenText(raw: string): string {
  return (
    raw
      .split('\n')
      // Collapse spaces and drop stray symbols the reader sees at line ends (a cursor, a border).
      .map((l) =>
        l
          .replace(/\s+/g, ' ')
          .replace(/(?:\s+[^\p{L}\p{N}\s]{1,2})+$/u, '')
          .trim(),
      )
      .filter((l) => l.length >= 3 && /[A-Za-z]{2}/.test(l))
      .join('\n')
      .slice(0, MAX_TEXT)
  );
}

const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]+/g) ?? []);

/** True when two screen texts are nearly the same (the same slide read twice). */
export function sameText(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return x.size === y.size;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / (x.size + y.size - common) >= 0.8;
}

/**
 * Watches the meeting window while notes are being taken:
 * - reads the text of a slide or shared screen once it changes and holds still
 *   (a few pictures per meeting, never video, pictures are never saved);
 * - notices when the meeting window closes, so the app can suggest stopping.
 * Everything runs on this computer.
 */
export class ScreenWatcher {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private meeting: DetectedMeeting | null = null;
  private seen = false;
  private lastSeenAt = 0;
  private previous: Signature | null = null;
  private lastRead: Signature | null = null;
  private lastText = '';
  private readonly source: ScreenSource;
  private readonly target: ScreenTarget;
  private readonly opts: {
    readText: boolean;
    ownTitles: () => string[];
    now?: () => number;
  };

  constructor(
    source: ScreenSource,
    target: ScreenTarget,
    opts: { readText: boolean; ownTitles: () => string[]; now?: () => number },
  ) {
    this.source = source;
    this.target = target;
    this.opts = opts;
  }

  start(intervalMs = 3000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.source.release?.().catch(() => undefined);
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  /** One look at the screen. Public for tests. */
  async tick(): Promise<void> {
    if (this.busy || !this.target.isActive()) return;
    this.busy = true;
    try {
      const windows = await this.source.listWindows();
      if (windows === 'denied') {
        if (this.opts.readText) this.target.setScreenState('denied');
        return;
      }
      const own = new Set(this.opts.ownTitles());
      const titles = windows.map((w) => w.title);
      // Prefer the window we were already watching, if it is still there.
      const same = this.meeting && titles.includes(this.meeting.windowTitle);
      const found = same ? this.meeting : detectFromTitles(titles, (t) => own.has(t));
      if (found) {
        if (found.windowTitle !== this.meeting?.windowTitle) {
          this.previous = null;
          log.info('screen_meeting_window', { platform: found.platform });
        }
        this.meeting = found;
        this.seen = true;
        this.lastSeenAt = this.now();
        this.target.meetingWindowGone(false);
      } else if (this.seen && this.now() - this.lastSeenAt > GONE_MS) {
        this.target.meetingWindowGone(true);
      }
      if (!this.opts.readText) return;
      this.target.setScreenState(found ? 'reading' : 'looking');
      if (!found || this.target.isPaused()) return;
      const id = windows.find((w) => w.title === found.windowTitle)!.id;
      await this.look(id, found.windowTitle);
    } catch (err) {
      log.warn('screen_watch_failed', { error: err instanceof Error ? err : String(err) });
    } finally {
      this.busy = false;
    }
  }

  private async look(id: string, windowTitle: string): Promise<void> {
    const shot = await this.source.grab(id);
    if (!shot) return;
    const previous = this.previous;
    this.previous = shot.signature;
    if (!isNewKeyframe(previous, shot.signature, this.lastRead)) return;
    this.lastRead = shot.signature;
    const png = await shot.png();
    if (!png) return;
    const text = cleanScreenText(await this.source.readText(png));
    if (!text || sameText(text, this.lastText)) return;
    this.lastText = text;
    this.target.save({ atMs: this.target.elapsedMs(), text, windowTitle });
    this.target.screenKeyframe();
    log.info('screen_text_saved', { chars: text.length });
  }
}
