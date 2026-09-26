import { describe, expect, it } from 'vitest';
import {
  ScreenWatcher,
  cleanScreenText,
  frameDiff,
  sameText,
  isNewKeyframe,
  signatureFromBgra,
  SIG_H,
  SIG_W,
  type ScreenSource,
  type ScreenTarget,
} from '../src/main/capture/screen';
import type { ScreenHealth } from '../src/shared/types';
import type { ScreenNote } from '@meeting-assistant/core';

const TEAMS = 'Project Phoenix standup | Meeting | Microsoft Teams';

let frame = 0;
/**
 * A pretend window picture: a white slide whose text lines depend on `slide`, and
 * optionally a webcam tile in the corner that changes every time.
 */
function picture(slide: number, video = false): Uint8Array {
  const p = new Uint8Array(SIG_W * SIG_H).fill(30);
  for (let y = 8; y < 56; y++) for (let x = 8; x < 104; x++) p[y * SIG_W + x] = 250;
  // Three lines of "text": dark dashes whose pattern depends on the slide.
  for (const row of [16, 28, 40])
    for (let x = 12; x < 100; x++)
      if (((x * 7 + row + slide * 13) >> 2) % 3 === 0) {
        p[row * SIG_W + x] = 20;
        p[(row + 1) * SIG_W + x] = 20;
      }
  if (video) {
    frame++;
    for (let y = 0; y < 24; y++)
      for (let x = 108; x < SIG_W; x++) p[y * SIG_W + x] = (x * 31 + y * 17 + frame * 97) % 256;
  }
  return p;
}

/** A pretend screen: a list of windows and what the meeting window currently shows. */
function fakeScreen() {
  const state = {
    windows: [
      { id: 'w1', title: 'Inbox - Mail' },
      { id: 'w2', title: TEAMS },
    ] as { id: string; title: string }[] | 'denied',
    // What the meeting window shows: a "picture" value and the text on it.
    picture: 10,
    // Something always moving in one corner, like a webcam tile.
    video: false,
    text: 'Project Phoenix\nDeployment Date: Monday\nOwner: Bob',
    reads: 0,
    grabbed: [] as string[],
  };
  const source: ScreenSource = {
    listWindows: async () => state.windows,
    grab: async (id) => {
      state.grabbed.push(id);
      return {
        signature: picture(state.picture, state.video),
        png: async () => Buffer.from(state.text),
      };
    },
    readText: async (png) => {
      state.reads++;
      return png.toString();
    },
  };
  return { state, source };
}

function fakeTarget() {
  const t = {
    active: true,
    paused: false,
    elapsed: 0,
    screen: 'off' as ScreenHealth['state'],
    keyframes: 0,
    gone: false,
    notes: [] as ScreenNote[],
  };
  const target: ScreenTarget = {
    isActive: () => t.active,
    isPaused: () => t.paused,
    elapsedMs: () => t.elapsed,
    setScreenState: (s) => (t.screen = s),
    screenKeyframe: () => t.keyframes++,
    meetingWindowGone: (g) => (t.gone = g),
    save: (n) => t.notes.push(n),
  };
  return { t, target };
}

describe('screen watcher (slides, never video)', () => {
  it('reads a slide once it holds still, and only the meeting window', async () => {
    const { state, source } = fakeScreen();
    const { t, target } = fakeTarget();
    const w = new ScreenWatcher(source, target, { readText: true, ownTitles: () => [] });
    await w.tick(); // first look: nothing to compare with yet
    expect(t.notes).toHaveLength(0);
    expect(t.screen).toBe('reading');
    t.elapsed = 65_000;
    await w.tick(); // same picture twice: it has settled, read it
    expect(t.notes).toEqual([
      {
        atMs: 65_000,
        text: 'Project Phoenix\nDeployment Date: Monday\nOwner: Bob',
        windowTitle: TEAMS,
      },
    ]);
    expect(state.grabbed.every((id) => id === 'w2')).toBe(true);

    // Nothing changed: no more reading.
    await w.tick();
    await w.tick();
    expect(state.reads).toBe(1);

    // Next slide: read after it settles.
    state.picture = 120;
    state.text = 'Rollout plan\nQA sign-off before Monday';
    await w.tick();
    expect(state.reads).toBe(1);
    await w.tick();
    expect(t.notes.map((n) => n.text)).toContain('Rollout plan\nQA sign-off before Monday');
    expect(t.keyframes).toBe(2);
  });

  it('reads a new slide with the same layout, next to live video', async () => {
    const { state, source } = fakeScreen();
    const { t, target } = fakeTarget();
    state.video = true;
    const w = new ScreenWatcher(source, target, { readText: true, ownTitles: () => [] });
    await w.tick();
    await w.tick();
    expect(state.reads).toBe(1);
    await w.tick();
    await w.tick();
    expect(state.reads).toBe(1); // only the video moved
    state.picture = 11; // same template, different words
    state.text = 'Launch plan\nLaunch date: the 15th';
    await w.tick(); // changed
    expect(state.reads).toBe(1);
    await w.tick(); // and settled
    expect(state.reads).toBe(2);
    expect(t.notes.map((n) => n.text)).toContain('Launch plan\nLaunch date: the 15th');
  });

  it('keyframe rule: settled new content only', () => {
    const a = picture(1);
    const b = picture(2);
    expect(isNewKeyframe(null, a, null)).toBe(false);
    expect(isNewKeyframe(a, a, null)).toBe(true); // first settled picture
    expect(isNewKeyframe(a, a, a)).toBe(false); // nothing new
    expect(isNewKeyframe(b, b, a)).toBe(true); // new slide, settled
    expect(isNewKeyframe(a, b, a)).toBe(false); // still changing
  });

  it('does not save the same text twice when only the picture changed', async () => {
    const { state, source } = fakeScreen();
    const { t, target } = fakeTarget();
    const w = new ScreenWatcher(source, target, { readText: true, ownTitles: () => [] });
    await w.tick();
    await w.tick();
    state.picture = 200; // e.g. a video tile moved, the slide text did not change
    await w.tick();
    await w.tick();
    expect(state.reads).toBe(2);
    expect(t.notes).toHaveLength(1);
  });

  it('says why nothing is read: no meeting window, no permission, or paused', async () => {
    const { state, source } = fakeScreen();
    const { t, target } = fakeTarget();
    const w = new ScreenWatcher(source, target, { readText: true, ownTitles: () => [] });
    state.windows = [{ id: 'w1', title: 'Inbox - Mail' }];
    await w.tick();
    expect(t.screen).toBe('looking');
    state.windows = 'denied';
    await w.tick();
    expect(t.screen).toBe('denied');
    state.windows = [{ id: 'w2', title: TEAMS }];
    t.paused = true;
    await w.tick();
    await w.tick();
    expect(state.reads).toBe(0);
  });

  it('never reads the screen when screen reading is off, but still notices the meeting end', async () => {
    const { state, source } = fakeScreen();
    const { t, target } = fakeTarget();
    let now = 0;
    const w = new ScreenWatcher(source, target, {
      readText: false,
      ownTitles: () => [],
      now: () => now,
    });
    await w.tick();
    await w.tick();
    expect(state.grabbed).toEqual([]);
    expect(t.screen).toBe('off');

    state.windows = [{ id: 'w1', title: 'Inbox - Mail' }];
    now = 10_000;
    await w.tick();
    expect(t.gone).toBe(false); // a short gap is not the end
    now = 20_000;
    await w.tick();
    expect(t.gone).toBe(true);
    state.windows = [{ id: 'w2', title: TEAMS }];
    await w.tick();
    expect(t.gone).toBe(false);
  });

  it("ignores the app's own windows", async () => {
    const { state, source } = fakeScreen();
    const { t, target } = fakeTarget();
    state.windows = [{ id: 'w9', title: TEAMS }];
    const w = new ScreenWatcher(source, target, { readText: true, ownTitles: () => [TEAMS] });
    await w.tick();
    expect(t.screen).toBe('looking');
  });

  it('helpers: text cleanup, same-text check, picture difference', () => {
    expect(cleanScreenText('  Project   Phoenix \n|\n ~ \nOwner: Bob _\n')).toBe(
      'Project Phoenix\nOwner: Bob',
    );
    expect(sameText('Deployment Date: Monday', 'Deployment date Monday')).toBe(true);
    expect(sameText('Deployment Date: Monday', 'Rollout plan for Tuesday')).toBe(false);
    expect(frameDiff(new Uint8Array([0, 0]), new Uint8Array([255, 255]))).toBe(1);
    expect(frameDiff(new Uint8Array([9, 9]), new Uint8Array([9, 9]))).toBe(0);
    // BGRA white and black pixels
    expect([...signatureFromBgra(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]))]).toEqual([
      255, 0,
    ]);
  });
});
