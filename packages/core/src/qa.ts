import type { MeetingNotes, TaskStatus, TranscriptSegment } from './types.ts';
import { contentStems, firstName, stem, words } from './text.ts';
import { localDate, toIsoDate } from './time.ts';

/** A stored meeting as seen by the memory/Q&A layer. */
export interface MemoryMeeting {
  id: string;
  title: string;
  startedAt: string;
  timeZone?: string;
  notes: MeetingNotes | null;
  segments: TranscriptSegment[];
}

export type AnswerItemKind = 'decision' | 'action' | 'question' | 'risk' | 'topic' | 'segment';

export interface AnswerItem {
  kind: AnswerItemKind;
  text: string;
  meetingId: string;
  meetingTitle: string;
  date: string;
  startMs: number;
  segmentIds: string[];
  owner?: string | null;
  deadline?: string | null;
  status?: TaskStatus;
}

export interface Answer {
  found: boolean;
  text: string;
  items: AnswerItem[];
}

const INTENT_WORDS = new Set(
  'what when where who did do does we our decide decided decision decisions discuss discussed talk talked mention mentioned cover covered meeting meetings about agree agreed agreement say said still open unresolved outstanding pending tasks task action items item assigned assign commit committed promise promised sign signed volunteer volunteered is are was were there any list show tell find me my i risk risks blocker blockers'
    .split(' ')
    .map(stem),
);

function topicStems(question: string): Set<string> {
  return new Set([...contentStems(question)].filter((w) => !INTENT_WORDS.has(w)));
}

function relevance(text: string, terms: Set<string>): number {
  if (terms.size === 0) return 1;
  const t = contentStems(text);
  let hit = 0;
  for (const term of terms)
    if ([...t].some((w) => w === term || w.startsWith(term) || term.startsWith(w))) hit++;
  return hit / terms.size;
}

function dateOf(m: MemoryMeeting): string {
  return toIsoDate(localDate(m.startedAt, m.timeZone));
}

function sameName(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || firstName(x) === firstName(y);
}

function findPerson(question: string, meetings: MemoryMeeting[], me: string): string | null {
  const people = new Set<string>();
  for (const m of meetings) {
    for (const a of m.notes?.actionItems ?? []) if (a.owner) people.add(a.owner);
    for (const s of m.segments)
      if (!/^(speaker\s*\d+|you|unknown speaker)$/i.test(s.speaker)) people.add(s.speaker);
  }
  const qWords = new Set(words(question));
  const matches = [...people].filter(
    (p) => p !== me && (qWords.has(p.toLowerCase()) || qWords.has(firstName(p).toLowerCase())),
  );
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}

/**
 * Answer a question about past meetings using only stored notes and transcripts.
 * Every item carries its meeting, date and transcript position. When nothing
 * matches, it says so instead of guessing.
 */
export function answerQuestion(
  question: string,
  meetings: MemoryMeeting[],
  me: { name: string },
): Answer {
  const q = question.toLowerCase();
  const sorted = [...meetings].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const terms = topicStems(question);
  const items: AnswerItem[] = [];
  const base = (m: MemoryMeeting) => ({ meetingId: m.id, meetingTitle: m.title, date: dateOf(m) });

  const actions = (filter: (owner: string | null) => boolean, openOnly: boolean) => {
    for (const m of sorted)
      for (const a of m.notes?.actionItems ?? []) {
        if (!filter(a.owner)) continue;
        if (openOnly && a.status === 'completed') continue;
        if (terms.size && relevance(a.task, terms) < 0.5) continue;
        items.push({
          kind: 'action',
          text: a.task,
          ...base(m),
          startMs: a.evidence.startMs,
          segmentIds: a.evidence.segmentIds,
          owner: a.owner,
          deadline: a.deadline?.date ?? a.deadline?.phrase ?? null,
          status: a.status,
        });
      }
  };

  // 1. My tasks
  if (
    /\b(assigned to me|my (open )?(tasks?|action items?|to-?dos?)|what do i (need|have) to do|on my plate|tasks? (for|assigned to) me)\b/.test(
      q,
    )
  ) {
    actions((o) => sameName(o, me.name), true);
    return finish(
      items,
      `You have ${items.length} open ${items.length === 1 ? 'task' : 'tasks'}.`,
      'You have no open tasks from your meetings.',
    );
  }

  // 2. What did <person> agree to / own
  const person = findPerson(question, sorted, me.name);
  if (
    person &&
    /\b(agree|agreed|commit|committed|promise|promised|sign(ed)? up|volunteer(ed)?|own|owns|responsible|working on|tasks?|action items?|doing|take|took)\b/.test(
      q,
    )
  ) {
    for (const t of terms) if (words(person).map(stem).includes(t)) terms.delete(t);
    actions((o) => sameName(o, person), false);
    return finish(
      items,
      `${person} has ${items.length} ${items.length === 1 ? 'action item' : 'action items'} from your meetings.`,
      `I couldn't find any tasks for ${person} in your meetings.`,
    );
  }

  // 3. Unresolved / open
  if (
    /\b(unresolved|open questions?|still open|outstanding|not (yet )?(decided|resolved)|undecided|pending)\b/.test(
      q,
    )
  ) {
    for (const m of sorted) {
      for (const oq of m.notes?.openQuestions ?? [])
        if (!terms.size || relevance(oq.question, terms) >= 0.5)
          items.push({
            kind: 'question',
            text: oq.question,
            ...base(m),
            startMs: oq.evidence.startMs,
            segmentIds: oq.evidence.segmentIds,
          });
    }
    actions(() => true, true);
    return finish(
      items,
      `There ${items.length === 1 ? 'is 1 unresolved item' : `are ${items.length} unresolved items`}.`,
      'Nothing is marked unresolved in your meetings.',
    );
  }

  // 4. Decisions
  if (
    /\b(decide|decided|decision|decisions|agree on|agreed on|agreed to|conclusion|settle|settled)\b/.test(
      q,
    )
  ) {
    for (const m of sorted)
      for (const d of m.notes?.decisions ?? []) {
        if (d.status !== 'confirmed') continue;
        if (terms.size && relevance(d.text + ' ' + d.evidence.quote, terms) < 0.5) continue;
        items.push({
          kind: 'decision',
          text: d.text,
          ...base(m),
          startMs: d.evidence.startMs,
          segmentIds: d.evidence.segmentIds,
        });
      }
    return finish(
      items,
      items.length === 1 ? 'Here is the decision I found.' : `I found ${items.length} decisions.`,
      "I couldn't find a decision about that in your meetings.",
    );
  }

  // 5. Risks
  if (/\b(risks?|blockers?|blocked|concerns?)\b/.test(q)) {
    for (const m of sorted)
      for (const r of m.notes?.risks ?? [])
        if (!terms.size || relevance(r.text, terms) >= 0.5)
          items.push({
            kind: 'risk',
            text: r.text,
            ...base(m),
            startMs: r.evidence.startMs,
            segmentIds: r.evidence.segmentIds,
          });
    return finish(
      items,
      `I found ${items.length} ${items.length === 1 ? 'risk' : 'risks'}.`,
      "I couldn't find any risks about that in your meetings.",
    );
  }

  // 6. When did we discuss X / general search: transcript moments plus structured items
  if (terms.size === 0) return finish([], '', 'Try asking about a topic, a person or a decision.');
  for (const m of sorted) {
    for (const t of m.notes?.topics ?? [])
      if (relevance(t.title + ' ' + t.summary, terms) >= 0.5)
        items.push({
          kind: 'topic',
          text: t.title,
          ...base(m),
          startMs: t.evidence.startMs,
          segmentIds: t.evidence.segmentIds,
        });
    let perMeeting = 0;
    for (const s of m.segments) {
      if (perMeeting >= 3) break;
      if (relevance(s.text, terms) >= (terms.size > 2 ? 0.6 : 0.99)) {
        items.push({
          kind: 'segment',
          text: `${s.speaker}: ${s.text}`,
          ...base(m),
          startMs: s.startMs,
          segmentIds: [s.id],
        });
        perMeeting++;
      }
    }
  }
  const when = /\bwhen\b/.test(q);
  const top = items.slice(0, 12);
  const first = top[0];
  const summary =
    when && first
      ? `It came up in "${first.meetingTitle}" on ${first.date}.`
      : `I found ${top.length} ${top.length === 1 ? 'place' : 'places'} where this came up.`;
  return finish(top, summary, "I couldn't find that in your meetings.");
}

function finish(items: AnswerItem[], found: string, notFound: string): Answer {
  return items.length
    ? { found: true, text: found, items }
    : { found: false, text: notFound, items: [] };
}
