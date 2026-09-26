import type { CaptureStatus } from './types';

export type HeadlineTone = 'rec' | 'paused' | 'warn' | 'idle';

/**
 * The one line that tells the user whether notes are really being taken. Shared by the live
 * screen, the sidebar and the tray so they never disagree. It only says "Taking notes" when
 * audio is actually arriving.
 */
export function captureHeadline(s: Pick<CaptureStatus, 'state' | 'hearing'>): {
  text: string;
  tone: HeadlineTone;
} {
  switch (s.state) {
    case 'idle':
      return { text: 'Not taking notes', tone: 'idle' };
    case 'stopping':
      return { text: 'Finishing up…', tone: 'paused' };
    case 'paused':
      return { text: 'Paused', tone: 'paused' };
    case 'starting':
      return { text: 'Starting…', tone: 'paused' };
    default:
      if (s.hearing === 'none') return { text: 'Not hearing anything', tone: 'warn' };
      if (s.hearing === 'starting') return { text: 'Starting…', tone: 'paused' };
      return { text: 'Taking notes', tone: 'rec' };
  }
}
