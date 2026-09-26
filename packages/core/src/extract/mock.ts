import { hash53 } from '../text.ts';
import type { TranscriptSegment } from '../types.ts';
import type { LlmProvider, LlmRequest } from './llm.ts';
import { RulesExtractor } from './rules.ts';
import type { RawExtraction } from './schema.ts';

/**
 * A deterministic stand-in for a language model, free and offline. It lets the
 * whole LLM path (prompting, JSON round trip, schema checks, chunking, caching,
 * fallback, validation) run in development and tests without any provider.
 *
 * - Known transcripts get their recorded reference output (see fixtures/ai-outputs).
 * - Tests can script any response, including broken or hostile ones.
 * - Anything else is answered with the offline rules engine, returned as JSON the
 *   way a model would return it.
 */

export interface RecordedOutput {
  fingerprint: string;
  output: RawExtraction;
}

export interface MockLlmOptions {
  recorded?: readonly RecordedOutput[];
  /** Scripted behavior for tests. Return undefined to fall through. */
  respond?: (req: LlmRequest) => unknown | Promise<unknown>;
  model?: string;
}

/** Stable identity of a transcript, independent of meeting time or title. */
export function transcriptFingerprint(segments: readonly TranscriptSegment[]): string {
  const text = segments.map((s) => `${s.id}|${s.speaker}|${s.text}`).join('\n');
  return `${hash53(text)}:${segments.length}`;
}

export class MockLlmProvider implements LlmProvider {
  readonly kind = 'mock' as const;
  readonly model: string;
  readonly calls: LlmRequest[] = [];
  private readonly recorded: Map<string, RawExtraction>;
  private readonly rules = new RulesExtractor();

  private readonly opts: MockLlmOptions;

  constructor(opts: MockLlmOptions = {}) {
    this.opts = opts;
    this.model = opts.model ?? 'mock-1';
    this.recorded = new Map((opts.recorded ?? []).map((r) => [r.fingerprint, r.output]));
  }

  async generate(req: LlmRequest): Promise<unknown> {
    this.calls.push(req);
    const scripted = await this.opts.respond?.(req);
    if (scripted !== undefined) return scripted;
    if (!req.input)
      return { tldr: '', topics: [], decisions: [], actionItems: [], openQuestions: [], risks: [] };
    const known = this.recorded.get(transcriptFingerprint(req.input.segments));
    // A JSON round trip, like a real model response.
    const output = known ?? (await this.rules.extract(req.input));
    return JSON.parse(JSON.stringify(output));
  }
}
