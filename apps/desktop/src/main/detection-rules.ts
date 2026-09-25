import type { Platform } from '@meeting-assistant/core';
import type { DetectedMeeting } from '../shared/types';

/**
 * Window-title patterns for common meeting apps. Detection only suggests
 * taking notes; it never starts capture on its own.
 */
const RULES: {
  platform: Platform;
  test: RegExp;
  title?: (m: RegExpExecArray, raw: string) => string;
}[] = [
  { platform: 'zoom', test: /^zoom (?:meeting|webinar)\b/i },
  { platform: 'zoom', test: /^zoom workplace\s*[-–]\s*(?:meeting|in a meeting)/i },
  {
    platform: 'teams',
    test: /^(?:(.+?)\s*\|\s*)?(?:meeting|call|meeting in|meet now)\b.*\|\s*microsoft teams/i,
    title: (m) => cleanTitle(m[1] ?? ''),
  },
  {
    platform: 'teams',
    test: /^(.+?)\s*\|\s*(?:meeting|call)\s*\|\s*microsoft teams/i,
    title: (m) => cleanTitle(m[1]!),
  },
  { platform: 'teams', test: /^microsoft teams\s*[-–|]\s*(?:meeting|call)\b/i },
  {
    platform: 'meet',
    test: /\bmeet\s*[-–:]\s*(?:([^-–]+?)\s*[-–]\s*)?([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i,
    title: (m) => cleanTitle(m[1] ?? ''),
  },
  {
    platform: 'meet',
    test: /^google meet\b.*[-–]\s*(?:google chrome|microsoft edge|firefox|safari|arc|brave)/i,
  },
  {
    platform: 'slack',
    test: /\bhuddle\b.*\bslack\b|\bslack\b.*\bhuddle\b/i,
    title: (_m, raw) =>
      cleanTitle(
        raw.replace(/\s*[-–|]\s*slack.*$/i, '').replace(/^huddle\s*(?:in|with|:)?\s*/i, ''),
      ),
  },
];

const OTHER = /\b(?:webex meeting|gotomeeting|bluejeans|whereby|jitsi meet|around|amazon chime)\b/i;

function cleanTitle(s: string): string {
  return s.replace(/^[\s|:–-]+|[\s|:–-]+$/g, '').slice(0, 120);
}

export function matchMeetingWindow(windowTitle: string): DetectedMeeting | null {
  const raw = windowTitle.trim();
  if (!raw || raw.length > 300) return null;
  for (const rule of RULES) {
    const m = rule.test.exec(raw);
    if (m) {
      const title = rule.title ? rule.title(m, raw) : '';
      return { platform: rule.platform, title, windowTitle: raw };
    }
  }
  if (OTHER.test(raw)) return { platform: 'other', title: '', windowTitle: raw };
  return null;
}

export function detectFromTitles(
  titles: string[],
  ignore: (t: string) => boolean = () => false,
): DetectedMeeting | null {
  for (const t of titles) {
    if (ignore(t)) continue;
    const m = matchMeetingWindow(t);
    if (m) return m;
  }
  return null;
}
