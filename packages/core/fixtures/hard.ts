import { meeting, script } from './acme.ts';
import type { MeetingFixture } from './types.ts';
import { capturedTeamSync } from './captured.ts';

/**
 * DIFFICULT SET. Written for the capture validation phase to probe the line between
 * discussion, decision and action item: suggestions, "maybe", "we should", "someone
 * should", "I can" offers (accepted and declined), cancelled and reassigned tasks,
 * ambiguous owners, relative and conflicting dates, sarcasm and small talk.
 * Expected answers were written before the first run. All meetings are on
 * Tuesday 2026-09-29, 10:00 New York time.
 */
const DAY = '2026-09-29T10:00:00-04:00';

export const hardSuggestions: MeetingFixture = {
  id: 'hard-suggestions-vs-decisions',
  category: 'ambiguous',
  description: 'Ideas, "maybe", "someone should" and a tentative task next to one real decision.',
  meeting: meeting('mtg-x-sugg', 'Launch Prep', DAY, ['alice', 'bob', 'charlie', 'david']),
  segments: script([
    ['alice', 'Maybe we should switch the status page to a new vendor.'],
    ['bob', "We could, but let's think about it after the launch."],
    ['charlie', 'Someone should look at the vendor pricing at some point.'],
    ['alice', "Let's keep that as an idea for now."],
    ['david', "For the launch itself, let's freeze the code on Thursday."],
    ['bob', 'Works for me.'],
    ['charlie', 'Agreed, code freeze Thursday.'],
    ['alice', 'I can write the rollback runbook by Wednesday.'],
    ['bob', "Maybe I'll add more dashboards, not sure yet."],
  ]),
  truth: {
    summary:
      'Code freeze is Thursday. Alice writes the rollback runbook by Wednesday. Switching the status page vendor is only an idea.',
    topics: [['launch', 'freeze']],
    decisions: [{ keywords: [['freeze'], ['thursday']] }],
    notDecisions: [['vendor'], ['status page']],
    actionItems: [
      { keywords: [['rollback', 'runbook']], owner: 'Alice Johnson', deadline: '2026-09-30' },
      { keywords: [['vendor', 'pricing']], owner: null, optional: true },
    ],
    openQuestions: [],
    risks: [],
  },
};

export const hardReassigned: MeetingFixture = {
  id: 'hard-cancelled-and-reassigned',
  category: 'conflicting',
  description: 'A task handed from Bob to Henry, a task cancelled because a requirement changed.',
  meeting: meeting('mtg-x-reassign', 'Billing Sync', DAY, [
    'alice',
    'bob',
    'charlie',
    'david',
    'henry',
  ]),
  segments: script([
    ['alice', 'Bob, can you migrate the billing database this week?'],
    ['bob', "Sure, I'll do the migration by Friday."],
    ['charlie', 'Wait, Bob is out on Thursday and Friday.'],
    ['alice', 'Right. Henry, can you take the billing migration instead?'],
    ['henry', "Yes, I'll take it. I'll have it done by Friday."],
    [
      'alice',
      "Also, forget about the load test. We don't need it anymore, the client dropped that requirement.",
    ],
    ['bob', "Okay, I'll drop the load test then."],
    ['david', "I'll update the on-call schedule tomorrow."],
  ]),
  truth: {
    summary:
      'Henry takes the billing migration by Friday instead of Bob. The load test is cancelled because the client dropped the requirement. David updates the on-call schedule tomorrow.',
    topics: [['billing', 'migration']],
    decisions: [{ keywords: [['load test']], optional: true }],
    actionItems: [
      { keywords: [['migrat']], owner: 'Henry Park', deadline: '2026-10-02' },
      { keywords: [['on-call', 'schedule']], owner: 'David Wilson', deadline: '2026-09-30' },
    ],
    openQuestions: [],
    risks: [],
  },
};

export const hardAmbiguousOwners: MeetingFixture = {
  id: 'hard-ambiguous-owners',
  category: 'ambiguous',
  description: 'Work that clearly needs doing but nobody took: owners must stay "Needs review".',
  meeting: meeting('mtg-x-owners', 'Client Follow-up', DAY, [
    'alice',
    'bob',
    'charlie',
    'grace',
    'jack',
  ]),
  segments: script([
    ['charlie', 'We need to renew the SSL certificate before it expires next week.'],
    ['bob', 'One of us should do it.'],
    ['charlie', "Yeah, let's make sure it gets done."],
    ['alice', 'Grace or Jack, one of you please send the survey results to the client.'],
    ['grace', 'I think Jack has the latest numbers.'],
    ['jack', 'Hmm, maybe.'],
  ]),
  truth: {
    summary:
      'The SSL certificate must be renewed before it expires next week and the survey results must go to the client, but nobody took either task.',
    topics: [['certificate', 'survey']],
    decisions: [],
    actionItems: [
      { keywords: [['ssl', 'certificate']], owner: null },
      { keywords: [['survey']], owner: null },
    ],
    openQuestions: [],
    risks: [{ keywords: [['expire', 'certificate']], optional: true }],
  },
};

export const hardDates: MeetingFixture = {
  id: 'hard-relative-and-conflicting-dates',
  category: 'conflicting',
  description: 'A deadline moved earlier in the same meeting, "tomorrow", "in two days".',
  meeting: meeting('mtg-x-dates', 'Design Review Prep', DAY, [
    'alice',
    'bob',
    'grace',
    'henry',
    'jack',
  ]),
  segments: script([
    ['alice', 'The design review is next Tuesday.'],
    ['grace', "I'll send the mockups by Friday."],
    ['bob', 'Friday is too late for me, can you do Thursday?'],
    ['grace', "Okay, I'll send the mockups by Thursday then."],
    ['henry', "I'll finish the data export by end of day tomorrow."],
    ['alice', "And I'll book the room in two days."],
    ['jack', 'The proposal is due at the end of the month.'],
  ]),
  truth: {
    summary:
      'Grace sends the mockups by Thursday (moved from Friday). Henry finishes the data export by tomorrow. Alice books the room in two days.',
    topics: [['design review', 'mockups']],
    decisions: [],
    actionItems: [
      { keywords: [['mockup']], owner: 'Grace Lee', deadline: '2026-10-01' },
      { keywords: [['data export', 'export']], owner: 'Henry Park', deadline: '2026-09-30' },
      { keywords: [['room']], owner: 'Alice Johnson', deadline: '2026-10-01' },
      { keywords: [['proposal']], owner: null, optional: true },
    ],
    openQuestions: [],
    risks: [],
  },
};

export const hardSarcasm: MeetingFixture = {
  id: 'hard-sarcasm-and-small-talk',
  category: 'ambiguous',
  description: 'A sarcastic "let\'s" and small talk that must not become decisions or tasks.',
  meeting: meeting('mtg-x-sarcasm', 'Bug Triage', DAY, ['alice', 'bob', 'charlie', 'jack']),
  segments: script([
    ['bob', "Oh sure, let's just rewrite the whole thing in a weekend. Great idea."],
    ['charlie', 'Ha, yeah, right.'],
    ['alice', 'Did anyone watch the game last night?'],
    ['jack', 'I did. What a finish.'],
    ['alice', 'Okay, back to work. The login bug is the priority.'],
    ['bob', "I'll fix the login bug today."],
    ['charlie', "I'll write the release notes after that."],
  ]),
  truth: {
    summary: 'Bob fixes the login bug today and Charlie writes the release notes afterwards.',
    topics: [['login', 'bug']],
    decisions: [],
    notDecisions: [['rewrite']],
    actionItems: [
      { keywords: [['login']], owner: 'Bob Smith', deadline: '2026-09-29' },
      { keywords: [['release notes']], owner: 'Charlie Davis', deadline: null },
    ],
    openQuestions: [],
    risks: [],
  },
};

export const hardOffers: MeetingFixture = {
  id: 'hard-offers',
  category: 'ambiguous',
  description: '"I can" offers: accepted ones are tasks, a declined one is not.',
  meeting: meeting('mtg-x-offers', 'Client Demo Planning', DAY, [
    'alice',
    'grace',
    'henry',
    'irene',
  ]),
  segments: script([
    ['alice', 'The client wants a demo video.'],
    ['grace', 'I can make the demo video if that helps.'],
    ['alice', 'That would be great, thanks Grace.'],
    ['henry', 'I could also pull usage stats, if anyone needs them.'],
    ['alice', 'No need, we have them.'],
    ['irene', 'I can take the support tickets this week.'],
    ['alice', 'Perfect.'],
  ]),
  truth: {
    summary: 'Grace makes the demo video and Irene takes the support tickets this week.',
    topics: [['demo', 'video']],
    decisions: [],
    actionItems: [
      { keywords: [['demo video', 'video']], owner: 'Grace Lee', deadline: null },
      { keywords: [['support tickets', 'tickets']], owner: 'Irene Costa' },
    ],
    openQuestions: [],
    risks: [],
  },
};

export const hardOverruled: MeetingFixture = {
  id: 'hard-overruled-proposal',
  category: 'conflicting',
  description: 'A "we should" that is turned down, and an earlier decision restated.',
  meeting: meeting('mtg-x-overruled', 'Team Rituals', DAY, ['alice', 'bob', 'charlie', 'david']),
  segments: script([
    ['charlie', 'We should probably move the retro to Friday afternoon.'],
    ['david', "I'd rather keep it on Thursday."],
    ['charlie', 'Fair enough, the retro stays on Thursday then.'],
    ['alice', 'We decided last week to drop support for the old API. That still stands.'],
    ['bob', "So I'll send the deprecation notice to customers by Monday."],
  ]),
  truth: {
    summary:
      'The retro stays on Thursday. Dropping support for the old API still stands; Bob sends the deprecation notice by Monday.',
    topics: [['retro', 'api']],
    decisions: [
      { keywords: [['retro'], ['thursday']] },
      { keywords: [['old api', 'api']], optional: true },
    ],
    notDecisions: [['retro'], ['friday']],
    actionItems: [{ keywords: [['deprecation']], owner: 'Bob Smith', deadline: '2026-10-05' }],
    openQuestions: [],
    risks: [],
  },
};

export const HARD_FIXTURES: MeetingFixture[] = [
  hardSuggestions,
  hardReassigned,
  hardAmbiguousOwners,
  hardDates,
  hardSarcasm,
  hardOffers,
  hardOverruled,
  capturedTeamSync,
];
