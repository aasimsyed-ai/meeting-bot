import { meeting, script } from './acme.ts';
import type { MeetingFixture } from './types.ts';

/** 1. Normal project meeting, and the final demo scenario (Project Phoenix Weekly). */
export const phoenixWeekly: MeetingFixture = {
  id: 'phoenix-weekly',
  category: 'project',
  description: 'Project Phoenix Weekly: deployment moves to Monday after a security concern.',
  meeting: meeting(
    'mtg-phoenix-weekly',
    'Project Phoenix Weekly',
    '2026-09-21T10:00:00-04:00',
    ['alice', 'bob', 'charlie', 'david'],
    { platform: 'zoom' },
  ),
  segments: script([
    [
      'alice',
      "Good morning everyone. This is the Project Phoenix weekly. Let's start with the deployment plan.",
    ],
    [
      'charlie',
      'The release candidate is ready. Bob finished the last feature on Friday. I was hoping we could deploy this Friday.',
    ],
    [
      'bob',
      'From my side the build is green. The one technical issue is the database migration. It took forty minutes on the staging copy, which is too slow.',
    ],
    [
      'david',
      "I have a concern about Friday. Security hasn't finished the firewall review for the new payment service, and the rule change isn't in place yet.",
    ],
    ['alice', 'How long does the review need?'],
    ['david', 'I can probably finish it by Thursday if nothing else comes up.'],
    [
      'charlie',
      'Friday is risky then. If we deploy on Friday and something breaks, nobody is around over the weekend.',
    ],
    [
      'bob',
      'What if we move the deployment to Monday? That gives David time and gives me time to speed up the migration.',
    ],
    ['alice', 'Monday works for me. Charlie, David, any objections?'],
    ['charlie', 'No, Monday is fine.'],
    ['david', 'Agreed.'],
    ['alice', "Okay, Monday it is. We're moving the deployment to Monday the twenty-eighth."],
    [
      'alice',
      'David, can you complete the firewall review and update the firewall rule by Thursday?',
    ],
    ['david', "Yes, I'll have the firewall rule updated by Thursday."],
    ['bob', "I'll fix the migration script so it runs in under ten minutes."],
    [
      'charlie',
      "One thing we still haven't figured out is who gives the final approval for the deployment. Is that me or someone from operations?",
    ],
    ['alice', "Good question. I don't know yet."],
    [
      'david',
      'Just so it is on record, if the firewall review slips, the Monday deployment is at risk.',
    ],
    ['alice', "Understood. Thanks everyone, that's all for today."],
  ]),
  screen: [
    {
      atMs: 4000,
      text: 'Project Phoenix — Release Plan v3\nTarget date: Friday, Sep 25\nOwner: Charlie Davis',
      windowTitle: 'Zoom Meeting',
    },
    {
      atMs: 21000,
      text: 'Staging migration run: 40 min 12 s\nRows migrated: 18,204,331',
      windowTitle: 'Zoom Meeting',
    },
  ],
  truth: {
    summary:
      'The team moved the Project Phoenix deployment from Friday to Monday because the firewall review is not finished. David will update the firewall rule by Thursday and Bob will speed up the database migration. Who gives final deployment approval is still open.',
    topics: [['deploy', 'release']],
    decisions: [{ keywords: [['monday'], ['deploy']] }],
    notDecisions: [['friday']],
    actionItems: [
      { keywords: [['firewall']], owner: 'David Wilson', deadline: '2026-09-24' },
      { keywords: [['migration']], owner: 'Bob Smith', deadline: null },
    ],
    openQuestions: [{ keywords: [['approv']] }],
    risks: [{ keywords: [['firewall', 'friday', 'weekend', 'monday']] }],
  },
};

/** 2. Stand-up */
export const standup: MeetingFixture = {
  id: 'daily-standup',
  category: 'standup',
  description: 'Daily stand-up with status updates, one blocker and one follow-up.',
  meeting: meeting(
    'mtg-standup-0922',
    'Daily Stand-up',
    '2026-09-22T09:30:00-04:00',
    ['alice', 'bob', 'charlie', 'david'],
    { platform: 'teams' },
  ),
  segments: script([
    ['alice', "Morning everyone, let's do a quick standup. Bob, you're first."],
    [
      'bob',
      "Yesterday I fixed the login timeout bug and merged it. Today I'll finish the pagination for the orders API. No blockers.",
    ],
    ['alice', 'Great. Charlie?'],
    [
      'charlie',
      "Yesterday I updated the release checklist. Today I'm meeting the support team about the new help articles.",
    ],
    ['charlie', "I'll share the updated checklist in the team channel after this call."],
    ['alice', 'Thanks. David?'],
    [
      'david',
      "I'm still blocked on access to the production audit logs. I requested it on Friday but nothing yet. Without it I can't finish the compliance report.",
    ],
    ['alice', 'Charlie, can you chase the access request with IT today?'],
    ['charlie', "Sure, I'll ping them right after standup."],
    ['david', "Thanks. Otherwise today I'm reviewing Bob's pull request for the orders API."],
    ['alice', "Perfect. For me, I'm working on the quarterly roadmap. That's it, thanks everyone."],
  ]),
  truth: {
    summary:
      'Status updates. David is blocked on audit log access; Charlie will chase IT today. Bob will finish orders API pagination today.',
    topics: [['standup', 'blocker', 'orders', 'audit']],
    decisions: [],
    actionItems: [
      { keywords: [['pagination']], owner: 'Bob Smith', deadline: '2026-09-22' },
      { keywords: [['checklist']], owner: 'Charlie Davis' },
      { keywords: [['access', 'it ']], owner: 'Charlie Davis', deadline: '2026-09-22' },
      { keywords: [['pull request', 'review']], owner: 'David Wilson', optional: true },
    ],
    openQuestions: [],
    risks: [{ keywords: [['audit', 'access', 'blocked']] }],
  },
};

/** 3. Client meeting with an external attendee */
export const clientMeeting: MeetingFixture = {
  id: 'client-kickoff',
  category: 'client',
  description: 'Pilot kickoff with an external client: start date agreed, tasks on both sides.',
  meeting: meeting(
    'mtg-globex-kickoff',
    'Globex Pilot Kickoff',
    '2026-09-22T14:00:00-04:00',
    ['alice', 'charlie', 'eva'],
    { platform: 'meet' },
  ),
  segments: script([
    [
      'alice',
      'Thanks for joining, Eva. Today we want to agree on the scope and the start date for the Globex pilot.',
    ],
    [
      'eva',
      'Happy to be here. On our side the main goal is to get the reporting module in front of our finance team.',
    ],
    [
      'charlie',
      'That works. Our proposal covers the reporting module and single sign-on, with fifty user seats for the pilot.',
    ],
    ['eva', 'Fifty seats is fine to start. When could the pilot begin?'],
    ['charlie', 'We could start on October fifth if we get the test data from you this week.'],
    ['eva', "October fifth works for us. Let's go with that."],
    ['alice', 'Great, so the pilot starts on October fifth.'],
    ['eva', "I'll send over the anonymized test data by the end of the week."],
    ['charlie', "And I'll send you the revised proposal with the updated seat count by Wednesday."],
    [
      'eva',
      'One thing I still need to check is how pricing works if we add more seats during the pilot. Do you know?',
    ],
    ['charlie', "I'm not sure yet. I need to check with our finance team."],
    [
      'eva',
      'Okay. My only concern is our security team, they might delay the single sign-on setup.',
    ],
    ['alice', "Understood. Thanks Eva, we'll follow up in writing."],
  ]),
  truth: {
    summary:
      'The Globex pilot will start on October 5 with 50 seats. Eva sends test data by end of week; Charlie sends a revised proposal by Wednesday. Pricing for extra seats is still open.',
    topics: [['pilot', 'scope', 'globex']],
    decisions: [
      { keywords: [['october'], ['fifth', '5']] },
      { keywords: [['fifty', '50'], ['seat']], optional: true },
    ],
    actionItems: [
      { keywords: [['test data']], owner: 'Eva Brown', deadline: '2026-09-25' },
      { keywords: [['proposal']], owner: 'Charlie Davis', deadline: '2026-09-23' },
      { keywords: [['pricing', 'finance']], owner: 'Charlie Davis', optional: true },
    ],
    openQuestions: [{ keywords: [['pricing', 'price', 'seats']] }],
    risks: [{ keywords: [['security', 'sign-on', 'sso']] }],
    externalRecipients: ['eva.brown@globex.example.test'],
  },
};

/** 4. Technical meeting */
export const technicalMeeting: MeetingFixture = {
  id: 'session-cache-review',
  category: 'technical',
  description: 'Architecture review: Redis chosen for sessions, ambiguous "next Friday" deadline.',
  meeting: meeting(
    'mtg-cache-review',
    'Session Cache Architecture Review',
    '2026-09-23T11:00:00-04:00',
    ['alice', 'bob', 'charlie', 'david'],
    { platform: 'slack' },
  ),
  segments: script([
    [
      'charlie',
      "Let's talk about the session cache. The current in-memory cache loses all sessions on every deploy.",
    ],
    [
      'bob',
      'Right. I compared two options. We keep the in-memory cache and add sticky sessions, or we move sessions to Redis.',
    ],
    [
      'david',
      'From a security point of view Redis is fine as long as we enable TLS and require authentication.',
    ],
    ['bob', "Redis also lets us scale horizontally, which sticky sessions don't."],
    ['charlie', 'Sounds like Redis is the better option. Any objections?'],
    ['david', 'No objections from me.'],
    ['bob', 'Agreed.'],
    ['charlie', "Great, we've decided to use Redis for the session cache."],
    ['charlie', 'Bob, can you write the design doc by next Friday?'],
    ['bob', 'Yes, I can do that.'],
    ['david', "I'll review the Redis TLS configuration by Monday."],
    [
      'bob',
      'My worry is that a single Redis node becomes a single point of failure. We should plan for a replica.',
    ],
    ['david', 'Good point. Also, do we need a multi-region setup for this?'],
    ['charlie', 'Good question. Nobody has decided that yet.'],
    ['alice', "Let's keep that open for now. Thanks everyone."],
  ]),
  truth: {
    summary:
      'The team decided to move session storage to Redis. Bob writes the design doc; David reviews the TLS setup by Monday. A single Redis node is a risk; multi-region is undecided.',
    topics: [['session', 'cache', 'redis']],
    decisions: [
      { keywords: [['redis'], ['session', 'cache']] },
      { keywords: [['replica']], optional: true },
    ],
    actionItems: [
      { keywords: [['design doc']], owner: 'Bob Smith', deadline: '2026-10-02' },
      { keywords: [['tls']], owner: 'David Wilson', deadline: '2026-09-28' },
    ],
    openQuestions: [{ keywords: [['region']] }],
    risks: [{ keywords: [['single point', 'failure', 'single redis']] }],
  },
};

/** 5. Incident meeting */
export const incidentMeeting: MeetingFixture = {
  id: 'payment-incident',
  category: 'incident',
  description: 'Incident review for an expired certificate outage with urgent follow-ups.',
  meeting: meeting(
    'mtg-payment-incident',
    'Payment API Incident Review',
    '2026-09-17T16:00:00-04:00',
    ['alice', 'bob', 'charlie', 'david'],
    { platform: 'teams' },
  ),
  segments: script([
    [
      'alice',
      "Let's review this morning's payment API outage. David, can you walk us through the timeline?",
    ],
    [
      'david',
      "Sure. At eight fifteen the payment API started rejecting requests. We found the TLS certificate on the load balancer had expired at eight o'clock.",
    ],
    [
      'bob',
      'I renewed the certificate at nine ten and service recovered by nine twenty. So about an hour of impact.',
    ],
    ['charlie', 'Around four hundred customers saw failed payments during that window.'],
    ['alice', 'What was the root cause?'],
    ['david', 'The certificate was renewed manually last year and nobody set up an expiry alert.'],
    [
      'alice',
      "Then we need monitoring for this. Let's add certificate expiry monitoring for every public endpoint.",
    ],
    ['bob', 'Agreed.'],
    ['charlie', 'Yes, definitely.'],
    ['alice', "Decision: we'll add expiry monitoring for all public certificates."],
    ['david', "I'll set up certificate expiry alerts by tomorrow."],
    ['bob', "I'll write the postmortem by the end of the week."],
    ['alice', 'Charlie, please notify the affected customers today.'],
    ['charlie', 'Will do.'],
    [
      'david',
      'One more risk. Two other certificates expire next month, and they were also renewed by hand.',
    ],
    ['alice', 'Okay. Thanks everyone, good work getting it back up quickly.'],
  ]),
  truth: {
    summary:
      'An expired TLS certificate caused a one hour payment outage. The team will monitor certificate expiry for all public endpoints. Alerts by tomorrow, postmortem by end of week, customers notified today.',
    topics: [['payment', 'outage', 'incident']],
    decisions: [
      {
        keywords: [
          ['monitor', 'alert'],
          ['certificate', 'expir'],
        ],
      },
    ],
    actionItems: [
      { keywords: [['alert']], owner: 'David Wilson', deadline: '2026-09-18' },
      { keywords: [['postmortem', 'post-mortem']], owner: 'Bob Smith', deadline: '2026-09-18' },
      { keywords: [['customer']], owner: 'Charlie Davis', deadline: '2026-09-17' },
    ],
    openQuestions: [],
    risks: [{ keywords: [['certificate'], ['expire', 'next month', 'hand']] }],
  },
};
