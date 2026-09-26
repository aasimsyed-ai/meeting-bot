import { z } from 'zod';
import type { EngineKind, MeetingContext, ScreenNote, TranscriptSegment } from '../types.ts';

/**
 * What an extraction engine returns before validation. Every item must cite
 * transcript segment ids; the validator drops or downgrades anything it cannot verify.
 */
const segmentIds = z
  .array(z.string())
  .describe('Ids of the transcript segments that support this item, e.g. ["s0012"]. Required.');

export const RawTopicSchema = z.object({
  title: z.string().describe('Short topic title, 2 to 6 words.'),
  summary: z.string().describe('One or two plain sentences about what was said on this topic.'),
  segmentIds,
});

export const RawDecisionSchema = z.object({
  text: z
    .string()
    .describe('The decision as a short statement, e.g. "Deployment moves to Monday".'),
  status: z
    .enum(['confirmed', 'possible', 'discussion'])
    .describe(
      'confirmed only when the group clearly agreed; possible for proposals nobody confirmed; discussion for ideas raised.',
    ),
  segmentIds,
});

export const RawActionItemSchema = z.object({
  task: z
    .string()
    .describe('The work to be done, starting with a verb, e.g. "Update the firewall rule".'),
  owner: z
    .string()
    .nullable()
    .describe(
      'The person who committed or was clearly assigned, exactly as named in the transcript or participant list. null if unclear.',
    ),
  deadlinePhrase: z
    .string()
    .nullable()
    .describe('The deadline exactly as spoken, e.g. "by Friday". null if none was said.'),
  priority: z.enum(['high', 'medium', 'low']),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('high only when someone explicitly committed or was explicitly assigned.'),
  segmentIds,
});

export const RawQuestionSchema = z.object({
  question: z
    .string()
    .describe('A question that was raised and not answered by the end of the meeting.'),
  segmentIds,
});

export const RawRiskSchema = z.object({
  text: z.string().describe('A risk or blocker someone actually raised.'),
  segmentIds,
});

export const RawExtractionSchema = z.object({
  tldr: z
    .string()
    .describe(
      'Two to four plain sentences summarizing the meeting outcome. Only facts from the transcript.',
    ),
  topics: z.array(RawTopicSchema),
  decisions: z.array(RawDecisionSchema),
  actionItems: z.array(RawActionItemSchema),
  openQuestions: z.array(RawQuestionSchema),
  risks: z.array(RawRiskSchema),
});

export type RawTopic = z.infer<typeof RawTopicSchema>;
export type RawDecision = z.infer<typeof RawDecisionSchema>;
export type RawActionItem = z.infer<typeof RawActionItemSchema>;
export type RawQuestion = z.infer<typeof RawQuestionSchema>;
export type RawRisk = z.infer<typeof RawRiskSchema>;
export type RawExtraction = z.infer<typeof RawExtractionSchema>;

export interface ExtractionInput {
  meeting: MeetingContext;
  segments: TranscriptSegment[];
  screen?: ScreenNote[];
}

export interface Extractor {
  readonly kind: EngineKind;
  readonly model?: string;
  readonly promptVersion: string;
  extract(input: ExtractionInput, signal?: AbortSignal): Promise<RawExtraction>;
}

export const EMPTY_EXTRACTION: RawExtraction = {
  tldr: '',
  topics: [],
  decisions: [],
  actionItems: [],
  openQuestions: [],
  risks: [],
};
