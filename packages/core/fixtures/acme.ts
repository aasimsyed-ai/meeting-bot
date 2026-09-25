import type { MeetingContext, Participant, TranscriptSegment } from '../src/types.ts';
import { words } from '../src/text.ts';

/**
 * Acme Demo Corporation: a synthetic organization for tests and demo mode.
 * All addresses use reserved test domains and must never receive real email.
 */
export const ACME_DOMAIN = 'acme.example.test';

export interface Person {
  key: string;
  name: string;
  email: string;
  title: string;
  external?: boolean;
}

const person = (
  key: string,
  name: string,
  title: string,
  domain = ACME_DOMAIN,
  external = false,
): Person => ({
  key,
  name,
  title,
  external,
  email: `${name.toLowerCase().replace(/\s+/g, '.')}@${domain}`,
});

export const PEOPLE = {
  alice: person('alice', 'Alice Johnson', 'Organizer'),
  bob: person('bob', 'Bob Smith', 'Engineer'),
  charlie: person('charlie', 'Charlie Davis', 'Project Manager'),
  david: person('david', 'David Wilson', 'Security Engineer'),
  eva: person('eva', 'Eva Brown', 'External Client', 'globex.example.test', true),
  frank: person('frank', 'Frank Miller', 'Unauthorized Test User'),
  grace: person('grace', 'Grace Lee', 'Designer'),
  henry: person('henry', 'Henry Park', 'Data Engineer'),
  irene: person('irene', 'Irene Costa', 'Support Lead'),
  jack: person('jack', 'Jack Moore', 'Sales Lead'),
  hana: person('hana', 'Hana Lee', 'Penetration Tester', 'securecheck.example.test', true),
} as const;

export type PersonKey = keyof typeof PEOPLE;

/** The demo user (note taker). */
export const DEMO_USER = { name: PEOPLE.alice.name, email: PEOPLE.alice.email };

export function participants(keys: PersonKey[], organizer: PersonKey = 'alice'): Participant[] {
  return keys.map((k) => ({
    name: PEOPLE[k].name,
    email: PEOPLE[k].email,
    role: k === organizer ? 'organizer' : 'required',
  }));
}

export function meeting(
  id: string,
  title: string,
  startedAt: string,
  keys: PersonKey[],
  extra: Partial<MeetingContext> = {},
): MeetingContext {
  return {
    id,
    title,
    startedAt,
    timeZone: 'America/New_York',
    platform: 'other',
    participants: participants(keys),
    user: DEMO_USER,
    ...extra,
  };
}

/**
 * Build a timed transcript from [speakerKey, text] lines. Timing follows a
 * natural speaking rate with short pauses, so timestamps look real.
 */
export function script(
  lines: ReadonlyArray<readonly [string, string]>,
  opts: { names?: Record<string, string>; startMs?: number } = {},
): TranscriptSegment[] {
  let t = opts.startMs ?? 3000;
  return lines.map(([key, text], i) => {
    const name = opts.names?.[key] ?? (PEOPLE as Record<string, Person>)[key]?.name ?? key;
    const duration = Math.max(1200, Math.round((words(text).length / 150) * 60000));
    const seg: TranscriptSegment = {
      id: 's' + String(i + 1).padStart(4, '0'),
      startMs: t,
      endMs: t + duration,
      speakerId: key,
      speaker: name,
      text,
      channel: 'import',
    };
    t += duration + 700;
    return seg;
  });
}
