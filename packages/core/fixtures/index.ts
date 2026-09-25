import { generateLongMeeting } from './long.ts';
import {
  phoenixWeekly,
  standup,
  clientMeeting,
  technicalMeeting,
  incidentMeeting,
} from './meetings-a.ts';
import {
  noActionMeeting,
  ambiguousMeeting,
  conflictingMeeting,
  poorTranscript,
} from './meetings-b.ts';
import {
  externalMeeting,
  injectionMeeting,
  recurringWeek1,
  recurringWeek2,
  manySpeakersMeeting,
  noNamesMeeting,
} from './meetings-c.ts';
import type { MeetingFixture } from './types.ts';

export * from './acme.ts';
export * from './types.ts';
export { generateLongMeeting } from './long.ts';
export {
  phoenixWeekly,
  standup,
  clientMeeting,
  technicalMeeting,
  incidentMeeting,
  noActionMeeting,
  ambiguousMeeting,
  conflictingMeeting,
  poorTranscript,
  externalMeeting,
  injectionMeeting,
  recurringWeek1,
  recurringWeek2,
  manySpeakersMeeting,
  noNamesMeeting,
};

export const longMeeting: MeetingFixture = generateLongMeeting();

/** The 15 evaluation scenarios (recurring counts once but has two meetings). */
export const ALL_FIXTURES: MeetingFixture[] = [
  phoenixWeekly,
  standup,
  clientMeeting,
  technicalMeeting,
  incidentMeeting,
  noActionMeeting,
  ambiguousMeeting,
  conflictingMeeting,
  longMeeting,
  poorTranscript,
  externalMeeting,
  injectionMeeting,
  recurringWeek1,
  recurringWeek2,
  manySpeakersMeeting,
  noNamesMeeting,
];

/** Expected "what changed since last time" for the recurring pair. */
export const RECURRING_EXPECTATION = {
  previous: recurringWeek1,
  current: recurringWeek2,
  /** Task statuses the user set before week 2 (Bob said both were done). */
  completedBefore: [['kubernetes'], ['storage', 'report']],
  expected: {
    completed: [['kubernetes']],
    outstanding: [['credential']],
    changedDeadlines: [['credential']],
    newTasks: [['lifecycle']],
    newDecisions: [['cold storage', 'logs']],
    stillOpen: [['logging']],
  },
};
