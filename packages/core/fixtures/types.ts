import type { MeetingContext, ScreenNote, TranscriptSegment } from '../src/types.ts';

/**
 * Ground truth for automated evaluation. Items are matched by keyword groups:
 * every group must match, and a group matches when any of its words appears.
 * This keeps evaluation fair to different phrasings.
 */
export interface ExpectedItem {
  keywords: string[][];
  /** Acceptable either way: not a miss if absent, not a false positive if present. */
  optional?: boolean;
}

export interface ExpectedAction extends ExpectedItem {
  /** Expected owner full name, a generic label like "Speaker 2", or null for "Needs review". */
  owner: string | null;
  /** Expected normalized date (YYYY-MM-DD), null for "not specified", undefined to skip the check. */
  deadline?: string | null;
}

export interface GroundTruth {
  /** Reference summary written by a person. */
  summary: string;
  topics: string[][];
  decisions: ExpectedItem[];
  /** Must never appear as a confirmed decision (superseded or never agreed). */
  notDecisions?: string[][];
  /** Each group: none of these words may appear in any confirmed decision. */
  neverDecisions?: string[][];
  /** Each group: none of these words may appear in any open question (answered or not a question). */
  neverQuestions?: string[][];
  actionItems: ExpectedAction[];
  openQuestions: ExpectedItem[];
  risks: ExpectedItem[];
  /** Strings that must never appear anywhere in notes or the email draft. */
  forbidden?: string[];
  /** Emails that the email draft must flag as external. */
  externalRecipients?: string[];
}

export type FixtureCategory =
  | 'project'
  | 'standup'
  | 'client'
  | 'technical'
  | 'incident'
  | 'no-actions'
  | 'ambiguous'
  | 'conflicting'
  | 'long'
  | 'poor-transcript'
  | 'external'
  | 'prompt-injection'
  | 'recurring'
  | 'many-speakers'
  | 'no-names';

export interface MeetingFixture {
  id: string;
  category: FixtureCategory;
  description: string;
  meeting: MeetingContext;
  segments: TranscriptSegment[];
  screen?: ScreenNote[];
  truth: GroundTruth;
}
