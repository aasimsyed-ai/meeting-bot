import { describe, expect, it } from 'vitest';
import { analyzeMeeting } from '../src/pipeline.ts';
import { RulesExtractor } from '../src/extract/rules.ts';
import { buildMailto, composeFollowUpEmail, resolveRecipients } from '../src/email.ts';
import { answerQuestion, type MemoryMeeting } from '../src/qa.ts';
import { diffMeetings, seriesKey } from '../src/recurring.ts';
import {
  ALL_FIXTURES,
  clientMeeting,
  phoenixWeekly,
  RECURRING_EXPECTATION,
} from '../fixtures/index.ts';
import { matchesKeywords } from '../eval/metrics.ts';
import type { MeetingFixture } from '../fixtures/types.ts';

const NOW = () => new Date('2026-09-25T12:00:00-04:00');
const analyze = (fx: MeetingFixture) =>
  analyzeMeeting(
    { meeting: fx.meeting, segments: fx.segments },
    { extractor: new RulesExtractor(), now: NOW },
  );

describe('follow-up email', () => {
  it('builds the expected sections from validated notes', async () => {
    const { email } = await analyze(phoenixWeekly);
    expect(email.subject).toBe('Meeting Summary — Project Phoenix Weekly');
    expect(email.body).toMatch(/^Hi everyone,/);
    expect(email.body).toContain('our meeting on Mon, Sep 21');
    for (const section of [
      'Summary',
      'Key Decisions',
      'Action Items',
      'Open Questions',
      'Next Steps',
    ])
      expect(email.body).toContain(`\n${section}\n`);
    expect(email.body).toMatch(/firewall rule.*David Wilson, due Thu, Sep 24/i);
    expect(email.body.trim().endsWith('Best,\nAlice Johnson')).toBe(true);
  });

  it('never shortens a numbered speaker to "Speaker" in the summary or next steps', async () => {
    // Found by the capture harness: "captured for Bob and Speaker".
    const segments = [
      ['Bob Smith', "I'll send the press release by Thursday."],
      ['Speaker 3', "I'll update the help center articles before the launch."],
    ].map(([speaker, text], i) => ({
      id: `s${i + 1}`,
      startMs: i * 4000,
      endMs: i * 4000 + 3000,
      speaker: speaker!,
      speakerId: speaker!,
      text: text!,
    }));
    const { notes, email } = await analyzeMeeting(
      { meeting: { ...phoenixWeekly.meeting, participants: [] }, segments },
      { extractor: new RulesExtractor(), now: NOW },
    );
    expect(notes.tldr).toContain('for Bob and Speaker 3');
    expect(email.body).toContain('Bob, Speaker 3: please confirm');
  });

  it('excludes the sender and flags external recipients', () => {
    const { to, warnings } = resolveRecipients(clientMeeting.meeting);
    expect(to.map((r) => r.email)).toEqual([
      'charlie.davis@acme.example.test',
      'eva.brown@globex.example.test',
    ]);
    expect(to.find((r) => r.email.startsWith('eva'))?.external).toBe(true);
    expect(warnings[0]).toMatch(/External recipients detected/);
  });

  it('asks for the user email when external recipients cannot be detected', () => {
    const { warnings } = resolveRecipients({
      ...clientMeeting.meeting,
      user: { name: 'Alice Johnson' },
    });
    expect(warnings.join(' ')).toMatch(/Add your email address/);
  });

  it('skips invalid addresses and reports people without email', () => {
    const { to, warnings } = resolveRecipients({
      ...phoenixWeekly.meeting,
      participants: [
        { name: 'X', email: 'not-an-email' },
        { name: 'Y', email: 'y@acme.example.test' },
        { name: 'Z' },
      ],
    });
    expect(to.map((r) => r.email)).toEqual(['y@acme.example.test']);
    expect(warnings.join(' ')).toMatch(/2 people have no email address/);
  });

  it('encodes a mailto link safely', () => {
    const url = buildMailto({
      subject: 'Notes & next steps',
      body: 'Line 1\nLine 2',
      to: [{ email: 'a@b.test' }, { email: 'bad' }],
    });
    expect(url).toBe(
      'mailto:a@b.test?subject=Notes%20%26%20next%20steps&body=Line%201%0D%0ALine%202',
    );
  });

  it('says so when there are no action items', async () => {
    const fx = ALL_FIXTURES.find((f) => f.category === 'no-actions')!;
    const r = await analyze(fx);
    const email = composeFollowUpEmail(r.notes, fx.meeting, NOW());
    expect(email.body).not.toContain('Action Items');
    expect(r.notes.tldr).toMatch(/No action items/);
  });
});

async function memory(): Promise<MemoryMeeting[]> {
  const out: MemoryMeeting[] = [];
  for (const fx of ALL_FIXTURES) {
    const r = await analyze(fx);
    out.push({
      id: fx.meeting.id,
      title: fx.meeting.title,
      startedAt: fx.meeting.startedAt,
      timeZone: fx.meeting.timeZone,
      notes: r.notes,
      segments: r.segments,
    });
  }
  return out;
}

describe('meeting memory Q&A', () => {
  it('answers decisions with a source meeting and date', async () => {
    const a = answerQuestion('What did we decide about deployment?', await memory(), {
      name: 'Alice Johnson',
    });
    expect(a.found).toBe(true);
    const phoenix = a.items.find((i) => i.meetingTitle === 'Project Phoenix Weekly');
    expect(phoenix?.text).toMatch(/monday/i);
    expect(phoenix?.date).toBe('2026-09-21');
    expect(phoenix?.segmentIds.length).toBeGreaterThan(0);
  });

  it('lists what a person agreed to', async () => {
    const a = answerQuestion('What did David agree to?', await memory(), { name: 'Alice Johnson' });
    expect(a.items.every((i) => i.owner === 'David Wilson')).toBe(true);
    expect(a.items.some((i) => /firewall/i.test(i.text))).toBe(true);
  });

  it('lists my open tasks', async () => {
    const a = answerQuestion('What tasks were assigned to me?', await memory(), {
      name: 'Alice Johnson',
    });
    expect(a.found).toBe(true);
    expect(a.items.every((i) => i.owner === 'Alice Johnson' && i.status !== 'completed')).toBe(
      true,
    );
  });

  it('finds when something was discussed', async () => {
    const a = answerQuestion('When did we discuss the firewall?', await memory(), {
      name: 'Alice Johnson',
    });
    expect(a.text).toMatch(/Project Phoenix Weekly/);
  });

  it('lists unresolved items', async () => {
    const a = answerQuestion('What is still unresolved?', await memory(), {
      name: 'Alice Johnson',
    });
    expect(a.items.some((i) => i.kind === 'question' && /approv/i.test(i.text))).toBe(true);
  });

  it('says it does not know instead of guessing', async () => {
    const a = answerQuestion('What did we decide about the Mars colony?', await memory(), {
      name: 'Alice Johnson',
    });
    expect(a).toEqual({
      found: false,
      text: "I couldn't find a decision about that in your meetings.",
      items: [],
    });
  });
});

describe('recurring meetings', () => {
  it('groups titles into a series', () => {
    expect(seriesKey('Platform Sync — Sep 21')).toBe(seriesKey('Platform Sync (week 2)'));
    expect(seriesKey('Platform Sync')).not.toBe(seriesKey('Budget Check-in'));
  });

  it('reports what changed since last time', async () => {
    const { previous, current, completedBefore, expected } = RECURRING_EXPECTATION;
    const prev = (await analyze(previous)).notes;
    for (const a of prev.actionItems)
      if (completedBefore.some((k) => matchesKeywords(a.task, [k]))) a.status = 'completed';
    const curr = (await analyze(current)).notes;
    const diff = diffMeetings(prev, curr);
    const has = (
      items: { task?: string; text?: string; question?: string }[],
      groups: string[][],
    ) =>
      groups.every((g) =>
        items.some((i) => matchesKeywords(i.task ?? i.text ?? i.question ?? '', [g])),
      );
    expect(has(diff.completedTasks, expected.completed)).toBe(true);
    expect(has(diff.outstandingTasks, expected.outstanding)).toBe(true);
    expect(
      has(
        diff.changedDeadlines.map((c) => c.task),
        expected.changedDeadlines,
      ),
    ).toBe(true);
    expect(has(diff.newTasks, expected.newTasks)).toBe(true);
    expect(has(diff.newDecisions, expected.newDecisions)).toBe(true);
    expect(has(diff.stillOpen, expected.stillOpen)).toBe(true);
    const cred = diff.changedDeadlines.find((c) => /credential/i.test(c.task.task))!;
    expect([cred.before?.date, cred.after?.date]).toEqual(['2026-09-16', '2026-09-25']);
  });
});
