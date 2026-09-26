import { describe, expect, it } from 'vitest';
import { ALL_FIXTURES } from '../fixtures/index.ts';
import { HOLDOUT_FIXTURES } from '../fixtures/holdout.ts';
import { HARD_FIXTURES } from '../fixtures/hard.ts';
import { PEOPLE } from '../fixtures/acme.ts';
import { analyzeMeeting } from '../src/pipeline.ts';
import { RulesExtractor } from '../src/extract/rules.ts';
import { contentWords, firstName } from '../src/text.ts';
import { formatFriendlyDate } from '../src/time.ts';
import type { MeetingFixture } from '../fixtures/types.ts';

/**
 * Trust checks over every fixture meeting (development, held-out and difficult sets):
 * every decision, task, owner and deadline can be traced to the transcript, and the
 * follow-up email says exactly what the validated notes say, and nothing more.
 */
const NOW = () => new Date('2026-09-25T12:00:00-04:00');
const EVERY = [...ALL_FIXTURES, ...HOLDOUT_FIXTURES, ...HARD_FIXTURES];

async function analyze(fx: MeetingFixture) {
  return analyzeMeeting(
    { meeting: fx.meeting, segments: fx.segments, screen: fx.screen },
    { extractor: new RulesExtractor(), now: NOW },
  );
}

describe('evidence: every item points back to what was said', () => {
  it.each(EVERY.map((f) => [f.id, f] as const))('%s', async (_id, fx) => {
    const { notes } = await analyze(fx);
    const byId = new Map(fx.segments.map((s) => [s.id, s]));
    const items = [
      ...notes.decisions.map((d) => ({ kind: 'decision', text: d.text, evidence: d.evidence })),
      ...notes.actionItems.map((a) => ({ kind: 'task', text: a.task, evidence: a.evidence })),
    ];
    for (const item of items) {
      const where = `${item.kind} "${item.text}"`;
      expect(item.evidence.segmentIds.length, where).toBeGreaterThan(0);
      const cited = item.evidence.segmentIds.map((id) => byId.get(id));
      expect(cited.every(Boolean), `${where} cites real transcript lines`).toBe(true);
      // The timestamp the UI jumps to is the first cited line.
      expect(item.evidence.startMs, where).toBe(Math.min(...cited.map((s) => s!.startMs)));
      // The quote shown under "Why?" is the cited lines themselves.
      expect(item.evidence.quote.length, where).toBeGreaterThan(0);
      // (The quote is the cleaned-up text: fillers like "uh" and repeated words removed.)
      const quoteWords = new Set(contentWords(item.evidence.quote));
      for (const s of cited) {
        const said = contentWords(s!.text);
        if (said.length === 0) continue; // "Sure." has nothing to compare
        const shown = said.filter((w) => quoteWords.has(w)).length;
        expect(shown / Math.max(1, said.length), where).toBeGreaterThanOrEqual(0.6);
      }
    }
    for (const a of notes.actionItems) {
      const quote = a.evidence.quote.toLowerCase();
      const cited = a.evidence.segmentIds.map((id) => byId.get(id)!);
      if (a.owner) {
        // An owner is someone who spoke in the cited lines or is named in them.
        const grounded =
          cited.some(
            (s) =>
              s.speaker === a.owner || (s.speaker === 'You' && a.owner === fx.meeting.user.name),
          ) ||
          quote.includes(firstName(a.owner).toLowerCase()) ||
          /\b(i|i'll|i will|me)\b/.test(quote);
        expect(grounded, `owner of "${a.task}" (${a.owner}) is grounded`).toBe(true);
      }
      if (a.deadline?.phrase)
        expect(quote, `deadline of "${a.task}" is in the quote`).toContain(
          a.deadline.phrase.toLowerCase(),
        );
    }
  });
});

describe('follow-up email: only what the notes say', () => {
  it.each(EVERY.map((f) => [f.id, f] as const))('%s', async (_id, fx) => {
    const { notes, email } = await analyze(fx);
    const body = email.body;
    const section = (name: string) => {
      const m = new RegExp(`\\n${name}\\n([\\s\\S]*?)(?:\\n\\n|$)`).exec(body);
      return m ? m[1]!.split('\n').map((l) => l.replace(/^• /, '')) : [];
    };

    // Recipients: the meeting's participants with an address, never the sender.
    const expectedTo = fx.meeting.participants
      .map((p) => p.email?.toLowerCase())
      .filter((e): e is string => Boolean(e) && e !== fx.meeting.user.email?.toLowerCase());
    expect(email.to.map((r) => r.email).sort()).toEqual([...new Set(expectedTo)].sort());

    // Decisions: exactly the confirmed ones.
    expect(section('Key Decisions')).toEqual(
      notes.decisions.filter((d) => d.status === 'confirmed').map((d) => d.text),
    );

    // Tasks: one line each, with the same owner and date as the notes.
    const lines = section('Action Items');
    expect(lines).toHaveLength(notes.actionItems.length);
    notes.actionItems.forEach((a, i) => {
      expect(lines[i]).toContain(a.task);
      expect(lines[i]).toContain(a.owner ?? 'Owner to be confirmed');
      if (a.deadline?.date) expect(lines[i]).toContain(formatFriendlyDate(a.deadline.date));
    });

    // Never invents people: every Acme person the email names was in this meeting.
    const present = new Set([
      ...fx.meeting.participants.map((p) => p.name),
      ...fx.segments.map((s) => s.speaker),
      fx.meeting.user.name,
    ]);
    for (const p of Object.values(PEOPLE))
      if (new RegExp(`\\b${p.name}\\b`).test(body))
        expect(present.has(p.name), `${p.name} was in the meeting`).toBe(true);

    // Never invents dates: every date in the email is a task deadline.
    const dates = new Set(
      notes.actionItems
        .filter((a) => a.deadline?.date)
        .map((a) => formatFriendlyDate(a.deadline!.date!)),
    );
    for (const m of body.matchAll(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2}\b/g))
      if (!body.includes(`our meeting on ${m[0]}`))
        expect(dates.has(m[0]), `date ${m[0]} comes from a task`).toBe(true);
  });
});
