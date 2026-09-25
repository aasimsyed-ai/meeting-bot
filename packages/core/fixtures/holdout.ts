import { DEMO_USER, meeting, script } from './acme.ts';
import type { MeetingFixture } from './types.ts';

/**
 * HELD-OUT SET. Written after the offline engine was frozen at rules-2, in
 * deliberately varied phrasing, to measure how the rules generalize.
 * Do not tune the rules against these meetings; report their scores as is.
 */

export const holdoutMarketing: MeetingFixture = {
  id: 'holdout-campaign-sync',
  category: 'project',
  description: 'Held out: marketing campaign sync with informal ownership phrasing.',
  meeting: meeting(
    'mtg-h-campaign',
    'Spring Campaign Sync',
    '2026-09-22T13:00:00-04:00',
    ['alice', 'grace', 'jack', 'charlie'],
    { platform: 'meet' },
  ),
  segments: script([
    ['alice', 'Okay folks, spring campaign. Where did we land on the theme?'],
    ['grace', 'We tested three concepts and people liked Fresh Start the most.'],
    ['jack', 'Sales liked it too. I say we go with Fresh Start.'],
    ['charlie', 'Yeah, Fresh Start gets my vote.'],
    ['alice', "Great, Fresh Start it is. Grace, you're taking the landing page copy, right?"],
    ['grace', "Yep, that's me. I'll have a first draft by next Thursday."],
    ['alice', 'Jack, you own the partner outreach?'],
    ['jack', 'Correct. I will email the top ten partners before the launch.'],
    ['charlie', 'Could someone loop in legal before we publish anything?'],
    ['alice', "I'll do it. I'll send legal the draft once Grace is done."],
    ['jack', "I'm not sure who signs off on the ad spend this time. Last quarter it was finance."],
    [
      'charlie',
      "Nobody knows. My worry is that if approval takes two weeks we'll miss the launch window.",
    ],
    ['alice', 'Noted. Thanks everyone.'],
  ]),
  truth: {
    summary:
      'The team chose the Fresh Start theme. Grace drafts landing page copy by next Thursday, Jack emails partners before launch, Alice loops in legal. Ad spend approval is unclear and could delay launch.',
    topics: [['campaign', 'theme']],
    decisions: [{ keywords: [['fresh start']] }],
    actionItems: [
      { keywords: [['landing page', 'copy', 'draft']], owner: 'Grace Lee', deadline: '2026-10-01' },
      { keywords: [['partner']], owner: 'Jack Moore', deadline: null },
      { keywords: [['legal']], owner: 'Alice Johnson', deadline: null },
    ],
    openQuestions: [{ keywords: [['ad spend', 'signs off', 'sign off', 'approv']] }],
    risks: [{ keywords: [['approval', 'launch window', 'miss']] }],
  },
};

export const holdoutHiring: MeetingFixture = {
  id: 'holdout-hiring-debrief',
  category: 'project',
  description: 'Held out: hiring debrief with a decision to hold off and future-tense tasks.',
  meeting: meeting('mtg-h-hiring', 'Backend Hiring Debrief', '2026-09-23T16:00:00-04:00', [
    'alice',
    'bob',
    'henry',
    'irene',
  ]),
  segments: script([
    [
      'alice',
      'Thanks for making time. We interviewed two candidates for the backend role this week.',
    ],
    ['bob', 'The second candidate was much stronger on system design.'],
    ['henry', 'Agreed, and the references I heard informally were good.'],
    [
      'alice',
      "Then we're going to extend an offer to the second candidate. Everyone okay with that?",
    ],
    ['irene', 'Yes, fully support it.'],
    ['alice', 'Henry, please draft the offer letter by Wednesday.'],
    ['henry', 'Sure thing.'],
    ['bob', "I'm going to call the two formal references tomorrow morning."],
    ['irene', 'Should we open a second backend role right away?'],
    ['alice', "Let's hold off on a second role until Q1."],
    ['bob', 'Makes sense.'],
    [
      'irene',
      'One thing that worries me is the start date overlapping with the holidays. Onboarding could slip.',
    ],
    ['alice', 'Good point. Okay, that is it.'],
  ]),
  truth: {
    summary:
      'The team will extend an offer to the second candidate and hold off on a second role until Q1. Henry drafts the offer letter by Wednesday; Bob calls references tomorrow. Holiday start date may slip onboarding.',
    topics: [['candidate', 'hiring', 'backend']],
    decisions: [{ keywords: [['offer'], ['second']] }, { keywords: [['q1'], ['role']] }],
    actionItems: [
      { keywords: [['offer letter']], owner: 'Henry Park', deadline: '2026-09-30' },
      { keywords: [['reference']], owner: 'Bob Smith', deadline: '2026-09-24' },
    ],
    openQuestions: [],
    risks: [{ keywords: [['holiday', 'onboarding']] }],
  },
};

export const holdoutSupport: MeetingFixture = {
  id: 'holdout-support-escalation',
  category: 'incident',
  description: 'Held out: support escalation in lowercase transcript style.',
  meeting: meeting('mtg-h-escalation', 'Initech Escalation', '2026-09-24T10:00:00-04:00', [
    'alice',
    'irene',
    'bob',
    'charlie',
  ]),
  segments: script([
    ['irene', 'ok so the initech account is escalating again, third time this month.'],
    ['bob', 'the export job keeps timing out on their largest workspace.'],
    ['irene', 'i can jump on a call with them this afternoon to calm things down.'],
    [
      'charlie',
      'we decided last time to offer a one month credit if it happened again, so we should honor that.',
    ],
    ['alice', 'yes, give them the credit.'],
    ['irene', "who's following up with engineering on the root cause?"],
    ['bob', "that's on me. i'll file the ticket today and look at the timeout."],
    ['charlie', 'the risk is they churn at renewal in november if this keeps happening.'],
    ['alice', 'ok. irene, loop me into that call if you can. thanks all.'],
  ]),
  truth: {
    summary:
      'Initech is escalating over export timeouts. They get a one month credit. Irene calls them this afternoon, Bob files an engineering ticket today. Renewal churn is a risk.',
    topics: [['initech', 'escalat', 'export']],
    decisions: [{ keywords: [['credit']] }],
    actionItems: [
      { keywords: [['call']], owner: 'Irene Costa', deadline: '2026-09-24' },
      {
        keywords: [['ticket', 'root cause', 'timeout']],
        owner: 'Bob Smith',
        deadline: '2026-09-24',
      },
      { keywords: [['loop', 'alice']], owner: 'Irene Costa', optional: true },
    ],
    openQuestions: [],
    risks: [{ keywords: [['churn', 'renewal']] }],
  },
};

export const holdoutOneOnOne: MeetingFixture = {
  id: 'holdout-one-on-one',
  category: 'project',
  description: 'Held out: 1:1 recorded with the note taker on the microphone channel ("You").',
  meeting: {
    ...meeting('mtg-h-1on1', 'Alice / Bob 1:1', '2026-09-25T09:00:00-04:00', ['alice', 'bob']),
    user: DEMO_USER,
  },
  segments: script(
    [
      ['you', 'How is the reporting migration going?'],
      ['bob', 'Mostly fine. The last piece is the data export, which is slower than I hoped.'],
      ['you', 'Can you send me the draft plan by Monday?'],
      ['bob', 'Sure, no problem.'],
      ['you', "I'll review it on Tuesday and we can decide the cutover date then."],
      ['bob', 'One risk is that the export may not be ready before the cutover.'],
      ['you', 'Understood. Anything else?'],
      ['bob', "No, that's all from me."],
    ],
    { names: { you: 'You' } },
  ),
  truth: {
    summary:
      'Bob sends the migration plan draft by Monday; Alice reviews it Tuesday. The export may not be ready before cutover.',
    topics: [['reporting', 'migration']],
    decisions: [],
    actionItems: [
      { keywords: [['draft', 'plan']], owner: 'Bob Smith', deadline: '2026-09-28' },
      { keywords: [['review']], owner: 'Alice Johnson', deadline: '2026-09-29' },
    ],
    openQuestions: [{ keywords: [['cutover']], optional: true }],
    risks: [{ keywords: [['export']] }],
  },
};

export const holdoutBoardPrep: MeetingFixture = {
  id: 'holdout-board-prep',
  category: 'no-actions',
  description: 'Held out: board prep with misleading phrases and one real task.',
  meeting: meeting('mtg-h-board', 'Board Deck Prep', '2026-09-21T15:00:00-04:00', [
    'alice',
    'charlie',
    'jack',
  ]),
  segments: script([
    ['alice', "Let's look at the board deck."],
    ['jack', "I'll be presenting the sales numbers, so I want the pipeline slide simpler."],
    ['charlie', 'We could maybe add a slide on churn, but I think there is no need this time.'],
    [
      'alice',
      "Final call: we're dropping the pricing slide. It raises more questions than it answers.",
    ],
    ['jack', 'Fine by me.'],
    ['alice', 'Let me know if anything else looks off.'],
    [
      'charlie',
      'Charlie to send the deck to the board by Friday end of day, that is me, I will do it.',
    ],
    ['jack', 'Do we need legal to review the forward-looking statements?'],
    ['alice', "Good question, I'm not sure."],
  ]),
  truth: {
    summary:
      'The pricing slide is dropped. Charlie sends the deck to the board by Friday. Whether legal reviews forward-looking statements is open.',
    topics: [['board', 'deck']],
    decisions: [{ keywords: [['pricing slide']] }],
    notDecisions: [['churn']],
    actionItems: [
      { keywords: [['deck'], ['board', 'send']], owner: 'Charlie Davis', deadline: '2026-09-25' },
      { keywords: [['pipeline slide', 'simpler']], owner: 'Jack Moore', optional: true },
    ],
    openQuestions: [{ keywords: [['legal']] }],
    risks: [],
  },
};

export const HOLDOUT_FIXTURES: MeetingFixture[] = [
  holdoutMarketing,
  holdoutHiring,
  holdoutSupport,
  holdoutOneOnOne,
  holdoutBoardPrep,
];
