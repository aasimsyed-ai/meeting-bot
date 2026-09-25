import type { Participant } from '../src/types.ts';
import { ACME_DOMAIN, meeting, PEOPLE, script, type PersonKey } from './acme.ts';
import type { MeetingFixture } from './types.ts';

/** Deterministic PRNG so generated meetings are identical on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Neutral status talk: must never produce tasks, decisions, questions or risks. */
const FILLER = [
  'The numbers are about the same as last month.',
  'We looked at this during the last review as well.',
  'Traffic was steady through the week.',
  'Most of the feedback so far has been positive.',
  "There isn't a lot of change on this one.",
  'The team spent most of the week on testing.',
  'I talked to a few people about it on Tuesday.',
  "It's roughly in line with what we expected.",
  'The dashboard shows a small increase in usage.',
  'We had a good conversation with the partners about it.',
  'That lines up with what support has been hearing.',
  "Overall it's moving in the right direction.",
  'The details are in the shared document.',
  "I don't have much to add there.",
  'Some of the older data is still being cleaned up.',
  'The trend has been fairly flat since August.',
  'Everyone seemed happy with the last demo.',
  "We've seen fewer tickets about this lately.",
  "It took a bit longer than usual, but it's fine now.",
  "There's a lot of interest from the sales side.",
];

const TOPICS = [
  'hiring plan',
  'Q4 roadmap',
  'customer escalations',
  'infrastructure costs',
  'security audit',
  'mobile app release',
  'documentation',
  'team offsite',
];

type Line = readonly [string, string];

/** Items placed at the end of each topic block. */
const EMBEDDED: Line[][] = [
  [['charlie', "I'll post the two backend job openings by Friday."]],
  [
    ['alice', "Let's move the reporting revamp to Q1."],
    ['bob', 'Agreed.'],
  ],
  [
    ['grace', "I'll call the Initech account manager tomorrow."],
    ['charlie', 'Who should own escalations on weekends?'],
    ['alice', 'Not sure yet.'],
  ],
  [
    ['bob', 'We agreed to cap the staging cluster at twenty nodes.'],
    ['henry', "There's a risk the reserved instance discount expires before we renew."],
  ],
  [
    ['david', "I'll send the audit evidence package by October ninth."],
    ['charlie', 'Henry, can you export the access logs for the auditors?'],
    ['henry', "Sure, I'll do it by Monday."],
  ],
  [
    ['bob', "Let's ship the mobile app on October first."],
    ['charlie', 'Sounds good.'],
    [
      'david',
      'Wait, the app store review takes a week, so October first is too tight and puts the release at risk.',
    ],
    ['alice', "Then we'll ship the mobile app on October eighth."],
    ['bob', 'Agreed.'],
  ],
  [
    ['bob', "I'll update the API reference by the end of the month."],
    ['grace', 'Do we need a separate changelog for partners?'],
    ['alice', 'Good question.'],
  ],
  [
    ['alice', "I'll book the venue for the offsite by next Friday."],
    ['henry', 'When is the offsite budget approved?'],
    ['charlie', "I don't know."],
  ],
];

const FIRST = [
  'Maya',
  'Liam',
  'Noah',
  'Emma',
  'Olivia',
  'Lucas',
  'Ava',
  'Ethan',
  'Mia',
  'Leo',
  'Zoe',
  'Omar',
  'Nina',
  'Ravi',
  'Sofia',
];
const LAST = [
  'Chen',
  'Garcia',
  'Patel',
  'Nguyen',
  'Kim',
  'Rossi',
  'Novak',
  'Silva',
  'Haddad',
  'Kowalski',
];

export interface LongMeetingOptions {
  minutes?: number;
  participants?: number;
  seed?: number;
}

export function generateLongMeeting(opts: LongMeetingOptions = {}): MeetingFixture {
  const minutes = opts.minutes ?? 120;
  const total = Math.max(6, opts.participants ?? 6);
  const rand = mulberry32(opts.seed ?? 42);
  const core: PersonKey[] = ['alice', 'bob', 'charlie', 'david', 'grace', 'henry'];
  const extraNames: Record<string, string> = {};
  const extraParticipants: Participant[] = [];
  for (let i = 0; extraParticipants.length < total - core.length; i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`;
    const key = `p${i}`;
    extraNames[key] = name;
    extraParticipants.push({
      name,
      email: `${name.toLowerCase().replace(' ', '.')}@${ACME_DOMAIN}`,
      role: 'optional',
    });
  }
  const speakerKeys = [...core, ...Object.keys(extraNames)];

  // About 11 seconds per filler segment including the pause.
  const fillerPerBlock = Math.max(1, Math.round((minutes * 60) / 11 / TOPICS.length) - 4);
  const lines: Line[] = [];
  TOPICS.forEach((topic, b) => {
    lines.push(['alice', `Okay, let's move on to the ${topic}.`]);
    for (let i = 0; i < fillerPerBlock; i++) {
      const who = speakerKeys[Math.floor(rand() * speakerKeys.length)]!;
      const a = FILLER[Math.floor(rand() * FILLER.length)]!;
      const c = FILLER[Math.floor(rand() * FILLER.length)]!;
      lines.push([
        who,
        i % 5 === 0
          ? `For the ${topic}, ${a.charAt(0).toLowerCase()}${a.slice(1)} ${c}`
          : `${a} ${c}`,
      ]);
    }
    lines.push(...EMBEDDED[b]!);
  });

  const m = meeting(
    'mtg-leadership-offsite-review',
    'Quarterly Leadership Review',
    '2026-09-24T09:00:00-04:00',
    core,
    { platform: 'teams' },
  );
  m.participants.push(...extraParticipants);
  const names: Record<string, string> = { ...extraNames };
  for (const k of core) names[k] = PEOPLE[k].name;

  return {
    id:
      minutes === 120 && total === 6 ? 'long-leadership-review' : `generated-${minutes}m-${total}p`,
    category: 'long',
    description: `Generated ${minutes}-minute meeting with ${total} participants and ${lines.length} segments.`,
    meeting: m,
    segments: script(lines, { names }),
    truth: {
      summary:
        'A two hour review across eight topics with tasks, a superseded launch decision, open questions and risks spread throughout.',
      topics: [
        ['hiring'],
        ['roadmap'],
        ['escalation'],
        ['security', 'audit'],
        ['mobile'],
        ['documentation'],
        ['offsite'],
      ],
      decisions: [
        { keywords: [['reporting'], ['q1']] },
        { keywords: [['staging'], ['twenty', '20']] },
        { keywords: [['mobile'], ['eighth', '8']] },
      ],
      notDecisions: [['mobile'], ['first', '1st']],
      actionItems: [
        { keywords: [['job', 'opening']], owner: 'Charlie Davis', deadline: '2026-09-25' },
        { keywords: [['initech']], owner: 'Grace Lee', deadline: '2026-09-25' },
        {
          keywords: [['audit evidence', 'evidence']],
          owner: 'David Wilson',
          deadline: '2026-10-09',
        },
        { keywords: [['access logs']], owner: 'Henry Park', deadline: '2026-09-28' },
        { keywords: [['api reference']], owner: 'Bob Smith', deadline: '2026-09-30' },
        { keywords: [['venue']], owner: 'Alice Johnson', deadline: '2026-10-02' },
      ],
      openQuestions: [
        { keywords: [['weekend']] },
        { keywords: [['changelog']] },
        { keywords: [['budget']] },
      ],
      risks: [
        { keywords: [['reserved', 'discount']] },
        { keywords: [['app store', 'tight']], optional: true },
      ],
    },
  };
}
