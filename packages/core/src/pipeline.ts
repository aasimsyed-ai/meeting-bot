import { composeFollowUpEmail } from './email.ts';
import { AiError } from './errors.ts';
import type { ExtractionInput, Extractor, RawExtraction } from './extract/schema.ts';
import { normalizeTranscript, removeEcho } from './transcript.ts';
import type { EmailDraft, MeetingNotes, TranscriptSegment } from './types.ts';
import { validateExtraction } from './validate.ts';

export type Stage = 'preparing' | 'analyzing' | 'checking' | 'drafting' | 'done';

export const STAGE_LABELS: Record<Stage, string> = {
  preparing: 'Preparing transcript…',
  analyzing: 'Finding decisions and action items…',
  checking: 'Checking everything against the transcript…',
  drafting: 'Creating follow-up email…',
  done: 'Ready',
};

export interface AnalyzeOptions {
  extractor: Extractor;
  /** Used when the main extractor fails with a recoverable or refusal error. */
  fallback?: Extractor;
  now?: () => Date;
  onStage?: (stage: Stage) => void;
  signal?: AbortSignal;
}

export interface AnalyzeResult {
  notes: MeetingNotes;
  segments: TranscriptSegment[];
  email: EmailDraft;
  usedFallback: boolean;
  /** Set when the main engine failed; the UI can offer a retry. */
  primaryError?: AiError;
}

/**
 * Transcript -> normalize -> extract -> validate -> notes -> email.
 * One structured pass; no agents. The email is composed from validated notes only.
 */
export async function analyzeMeeting(
  input: ExtractionInput,
  opts: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const now = opts.now ?? (() => new Date());
  opts.onStage?.('preparing');
  const { segments, warnings } = normalizeTranscript(removeEcho(input.segments));
  const prepared: ExtractionInput = { ...input, segments };

  opts.onStage?.('analyzing');
  let extractor = opts.extractor;
  let raw: RawExtraction;
  let primaryError: AiError | undefined;
  try {
    raw = await extractor.extract(prepared, opts.signal);
  } catch (err) {
    const aiErr =
      err instanceof AiError
        ? err
        : new AiError('unknown', err instanceof Error ? err.message : String(err), { cause: err });
    if (aiErr.code === 'cancelled' || !opts.fallback) throw aiErr;
    primaryError = aiErr;
    extractor = opts.fallback;
    raw = await extractor.extract(prepared, opts.signal);
  }

  opts.onStage?.('checking');
  const notes = validateExtraction(raw, {
    meeting: input.meeting,
    segments,
    engine: {
      kind: extractor.kind,
      model: extractor.model,
      promptVersion: extractor.promptVersion,
    },
    now,
  });
  notes.warnings.unshift(...warnings);
  if (primaryError && primaryError.code !== 'not_configured') {
    notes.warnings.push(
      `${primaryError.userMessage} These notes were made on this device instead. You can analyze the meeting again later.`,
    );
  }

  opts.onStage?.('drafting');
  const email = composeFollowUpEmail(notes, input.meeting, now());
  opts.onStage?.('done');
  return { notes, segments, email, usedFallback: Boolean(primaryError), primaryError };
}
