import { meeting, script } from './acme.ts';
import type { MeetingFixture } from './types.ts';

/** 6. No-action-item meeting: a demo full of phrases that look like commitments but are not. */
export const noActionMeeting: MeetingFixture = {
  id: 'dashboard-showcase',
  category: 'no-actions',
  description: 'Design showcase with no decisions or tasks. Checks for false positives.',
  meeting: meeting(
    'mtg-showcase',
    'Dashboard Showcase',
    '2026-09-18T13:00:00-04:00',
    ['alice', 'bob', 'charlie', 'grace'],
    { platform: 'zoom' },
  ),
  segments: script([
    [
      'grace',
      'Hi all. Bob is going to show us the new dashboard today. This is just a showcase, no decisions needed.',
    ],
    [
      'bob',
      'Thanks Grace. Let me share my screen. So this is the new dashboard. The main change is that the charts load in under a second now.',
    ],
    ['charlie', "That's a big improvement. I will say the old one was painfully slow."],
    [
      'bob',
      'The filters on the left are new as well. You can save a view and come back to it later.',
    ],
    ['grace', 'I think the colors work much better in this version.'],
    ['charlie', "Maybe someday we could add a dark mode, but that's not urgent."],
    ['bob', 'It would be nice to have, for sure.'],
    ['alice', 'How did you get the charts to load so fast?'],
    ['bob', 'We moved the aggregation to the database and cache the results for five minutes.'],
    ['alice', 'Nice. I can see how that helps with the big accounts.'],
    ['grace', "I'll be honest, this is the best version we've shown so far."],
    ['bob', "Thanks. That's everything I wanted to show. I'll stop sharing now."],
    ['alice', 'Great demo, Bob. Thanks everyone.'],
  ]),
  truth: {
    summary:
      'Bob demonstrated the new dashboard: faster charts, saved filter views and new colors. No decisions or tasks.',
    topics: [['dashboard', 'chart', 'demo']],
    decisions: [],
    actionItems: [],
    openQuestions: [],
    risks: [],
  },
};

/** 7. Ambiguous tasks: vague ownership and deadlines must be marked for review, not guessed. */
export const ambiguousMeeting: MeetingFixture = {
  id: 'sprint-planning-ambiguous',
  category: 'ambiguous',
  description: 'Sprint planning with vague ownership. Owners must not be guessed.',
  meeting: meeting(
    'mtg-sprint-planning',
    'Sprint Planning',
    '2026-09-16T10:00:00-04:00',
    ['alice', 'bob', 'charlie', 'david'],
    { platform: 'teams' },
  ),
  segments: script([
    ['charlie', 'Okay, sprint planning. A few loose ends from last sprint first.'],
    ['charlie', 'Someone should look into the flaky integration tests at some point.'],
    ['bob', 'Yeah, they fail maybe one run in five.'],
    ['alice', 'We need to update the onboarding docs by the end of the month.'],
    ['david', 'Can somebody check whether the nightly backups are actually restorable?'],
    ['charlie', "That's a good point."],
    ['charlie', 'Bob or David could take the load test, whoever has time.'],
    ['charlie', 'I might look at the logging changes later, not sure yet.'],
    ['alice', "Let's also make sure the release notes get written before the launch."],
    ['david', "I'll handle the backup restore check myself, since it touches security."],
    ['charlie', 'Great. And the load test, can someone pick that up this sprint?'],
    ['bob', 'Maybe. Let me see how the week goes.'],
    ['alice', "Okay, let's leave it there."],
  ]),
  truth: {
    summary:
      'Onboarding docs must be updated by end of month (owner unclear). David will check backup restores. Load test and flaky tests have no owner.',
    topics: [['sprint', 'planning', 'loose ends']],
    decisions: [],
    actionItems: [
      { keywords: [['docs', 'documentation']], owner: null, deadline: '2026-09-30' },
      { keywords: [['backup']], owner: 'David Wilson', deadline: null },
      { keywords: [['load test']], owner: null, optional: true },
      { keywords: [['release notes']], owner: null, optional: true },
      { keywords: [['flaky']], owner: null, optional: true },
    ],
    openQuestions: [{ keywords: [['load test']], optional: true }],
    risks: [{ keywords: [['flaky']], optional: true }],
  },
};

/** 8. Conflicting decisions: only the final decisions count. */
export const conflictingMeeting: MeetingFixture = {
  id: 'vendor-selection-conflict',
  category: 'conflicting',
  description:
    'Vendor and launch date change mid-meeting. Earlier choices must not appear as decisions.',
  meeting: meeting(
    'mtg-vendor-selection',
    'Email Vendor Selection',
    '2026-09-14T15:00:00-04:00',
    ['alice', 'bob', 'charlie', 'david'],
    { platform: 'meet' },
  ),
  segments: script([
    [
      'charlie',
      'We have to pick an email delivery vendor in this meeting. The two options are Mailspring and Postwave.',
    ],
    ['bob', "Mailspring is cheaper and the API is simpler. Let's go with Mailspring."],
    ['charlie', 'Sounds good to me.'],
    [
      'david',
      "Wait, before we commit. Mailspring doesn't support dedicated IP addresses, and their SLA is only ninety nine percent. That won't meet our uptime requirement.",
    ],
    ['bob', 'Oh, I missed that. Then Mailspring is out.'],
    ['charlie', 'So Postwave instead?'],
    ['david', 'Postwave has a ninety nine point nine five percent SLA and dedicated IPs.'],
    ['alice', "Then let's go with Postwave instead of Mailspring."],
    ['bob', 'Agreed, Postwave.'],
    ['charlie', 'Second topic, the launch date. We decided last week to launch on October first.'],
    ['david', 'With the vendor change we need two extra weeks for the migration.'],
    ['alice', "Then we'll push the launch to October fifteenth."],
    ['charlie', 'Okay, October fifteenth it is.'],
    ['bob', 'Works for me.'],
    ['alice', 'Good. So the final plan is Postwave, launching October fifteenth.'],
    [
      'david',
      "One risk: if Postwave's onboarding takes longer than a week, even the fifteenth is tight.",
    ],
    ['charlie', 'Who will own the Postwave contract?'],
    ['alice', "I'm not sure yet, we'll figure it out."],
  ]),
  truth: {
    summary:
      'The team first picked Mailspring but switched to Postwave because of SLA and dedicated IP needs. The launch moves from October 1 to October 15. Contract owner is undecided.',
    topics: [['vendor', 'email'], ['launch']],
    decisions: [{ keywords: [['postwave']] }, { keywords: [['launch'], ['fifteenth', '15']] }],
    notDecisions: [['mailspring'], ['first', '1st']],
    actionItems: [],
    openQuestions: [{ keywords: [['contract']] }],
    risks: [{ keywords: [['onboarding', 'tight']] }],
  },
};

/** 10. Poor transcript: speech recognition errors, no punctuation, stutters. */
export const poorTranscript: MeetingFixture = {
  id: 'budget-poor-transcript',
  category: 'poor-transcript',
  description: 'Noisy recognition output without punctuation or capitals.',
  meeting: meeting(
    'mtg-budget-checkin',
    'Budget Check-in',
    '2026-09-15T11:00:00-04:00',
    ['alice', 'bob', 'charlie'],
    { platform: 'other' },
  ),
  segments: script([
    [
      'charlie',
      'ok so um yeah the the budget for q4 were uh were about ten percent over on cloud spend',
    ],
    ['bob', 'yeah thats mostly the the new gpu instances we we spun up for the test cluster'],
    ['alice', 'can we uh turn those off at night'],
    ['bob', 'probably yes i think so'],
    ['charlie', 'bob can you uh can you set up the the shutdown schedule for the test cluster'],
    ['bob', 'sure ill do it by tomorrow'],
    ['alice', 'and uh charlie ill need the updated numbers for the the board deck'],
    ['charlie', 'ok ill send you the budget numbers by friday'],
    ['alice', 'great um and are we are we still on track for the the audit'],
    ['charlie', 'i dont know yet honestly we havent heard back from finance'],
    ['bob', 'theres also a risk the gpu quota runs out next week if we dont clean up'],
    ['alice', 'ok thanks'],
  ]),
  truth: {
    summary:
      'Cloud spend is 10% over budget due to GPU test instances. Bob sets up a shutdown schedule by tomorrow; Charlie sends budget numbers by Friday. Audit status is unknown.',
    topics: [['budget', 'cloud', 'gpu']],
    decisions: [],
    actionItems: [
      { keywords: [['shutdown', 'schedule']], owner: 'Bob Smith', deadline: '2026-09-16' },
      { keywords: [['budget', 'numbers']], owner: 'Charlie Davis', deadline: '2026-09-18' },
    ],
    openQuestions: [{ keywords: [['audit']] }],
    risks: [{ keywords: [['quota', 'gpu']] }],
  },
};
