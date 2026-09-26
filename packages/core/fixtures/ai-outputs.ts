import type { RecordedOutput } from '../src/extract/mock.ts';
import data from './ai-outputs.json' with { type: 'json' };

/**
 * Reference outputs replayed by the mock AI provider for the fixture meetings.
 * Recorded from the offline engine (eval/record-ai-outputs.ts), not from a real
 * language model, so tests of the AI path are deterministic and free.
 */
export const RECORDED_AI_OUTPUTS = data as unknown as (RecordedOutput & {
  id: string;
  source: string;
})[];
