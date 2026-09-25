import type { TranscriptSegment } from './types.ts';
import { normalizeWhitespace, similarity, words } from './text.ts';
import { formatTimestamp } from './time.ts';

const FILLER_RE = /\b(?:um+|uh+|erm+|hmm+|mm+)\b[,.]?\s*/gi;
const WORDS_PER_MS = 150 / 60000; // average speaking rate

export function segmentId(n: number): string {
  return 's' + String(n).padStart(4, '0');
}

export interface NormalizeResult {
  segments: TranscriptSegment[];
  warnings: string[];
}

/**
 * Clean a raw transcript without changing the meaning or the ids of good segments:
 * trims fillers and whitespace, repairs bad timestamps, drops empty and duplicate
 * segments, sorts by time, and guarantees unique ids.
 */
export function normalizeTranscript(input: readonly TranscriptSegment[]): NormalizeResult {
  const warnings: string[] = [];
  let repairedTimes = 0;
  let dropped = 0;

  const cleaned: TranscriptSegment[] = [];
  for (const raw of input) {
    if (!raw || typeof raw.text !== 'string') {
      dropped++;
      continue;
    }
    const text = normalizeWhitespace(raw.text.replace(FILLER_RE, ' ')).replace(/^[,.\s]+/, '');
    if (!text || words(text).length === 0) {
      dropped++;
      continue;
    }
    let startMs = Number(raw.startMs);
    let endMs = Number(raw.endMs);
    const estimate = Math.max(800, Math.round(words(text).length / WORDS_PER_MS));
    if (!Number.isFinite(startMs) || startMs < 0) {
      const prev = cleaned[cleaned.length - 1];
      startMs = prev ? prev.endMs : 0;
      repairedTimes++;
    }
    if (!Number.isFinite(endMs) || endMs < startMs) {
      endMs = startMs + estimate;
      repairedTimes++;
    }
    const speaker = normalizeWhitespace(String(raw.speaker ?? '')) || 'Unknown speaker';
    cleaned.push({
      ...raw,
      speaker,
      speakerId: raw.speakerId || speaker,
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
      text,
    });
  }

  // Stable sort by start time (keeps original order for ties).
  const sorted = cleaned
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.startMs - b.s.startMs || a.i - b.i)
    .map((x) => x.s);

  // Drop exact duplicates (same speaker and text within 3 seconds), e.g. double-delivered chunks.
  const deduped: TranscriptSegment[] = [];
  for (const seg of sorted) {
    const dup = deduped
      .slice(-4)
      .some(
        (p) =>
          p.speakerId === seg.speakerId &&
          p.text.toLowerCase() === seg.text.toLowerCase() &&
          Math.abs(p.startMs - seg.startMs) <= 3000,
      );
    if (dup) {
      dropped++;
      continue;
    }
    deduped.push(seg);
  }

  // Guarantee unique, non-empty ids.
  const seen = new Set<string>();
  let next = 1;
  const segments = deduped.map((seg) => {
    let id = typeof seg.id === 'string' && /^[\w-]{1,40}$/.test(seg.id) ? seg.id : '';
    if (!id || seen.has(id)) {
      do id = segmentId(next++);
      while (seen.has(id));
    }
    seen.add(id);
    return { ...seg, id };
  });

  if (repairedTimes > 0)
    warnings.push('Some timestamps were missing or out of order and were estimated.');
  if (dropped > 0 && dropped >= input.length * 0.2)
    warnings.push('Part of the transcript was empty or duplicated and was skipped.');
  const speakers = new Set(segments.map((s) => s.speakerId));
  if (segments.length > 0 && speakers.size === 1 && segments.length > 20)
    warnings.push('Only one speaker was detected, so speaker labels may be incomplete.');
  return { segments, warnings };
}

/**
 * When someone listens on speakers, the microphone also picks up the other people.
 * Drop microphone segments that repeat an overlapping system-audio segment.
 */
export function removeEcho(segments: readonly TranscriptSegment[]): TranscriptSegment[] {
  const system = segments.filter((s) => s.channel === 'system');
  if (system.length === 0) return [...segments];
  return segments.filter((seg) => {
    if (seg.channel !== 'mic') return true;
    return !system.some(
      (sys) =>
        sys.startMs <= seg.endMs + 1500 &&
        seg.startMs <= sys.endMs + 1500 &&
        similarity(sys.text, seg.text) >= 0.6,
    );
  });
}

export function applySpeakerNames(
  segments: readonly TranscriptSegment[],
  names: Readonly<Record<string, string>>,
): TranscriptSegment[] {
  return segments.map((s) => {
    const name = names[s.speakerId];
    return name ? { ...s, speaker: name } : s;
  });
}

/** One line per segment, with ids the model must cite. */
export function formatForPrompt(segments: readonly TranscriptSegment[]): string {
  return segments
    .map((s) => `[${s.id} ${formatTimestamp(s.startMs)}] ${s.speaker}: ${s.text}`)
    .join('\n');
}

export function formatForReading(segments: readonly TranscriptSegment[]): string {
  return segments
    .map((s) => `[${formatTimestamp(s.startMs)}] ${s.speaker}:\n${s.text}`)
    .join('\n\n');
}

/** Split into contiguous chunks of at most `maxChars` formatted characters, with a small overlap. */
export function chunkSegments(
  segments: readonly TranscriptSegment[],
  maxChars: number,
  overlapSegments = 3,
): TranscriptSegment[][] {
  const chunks: TranscriptSegment[][] = [];
  let current: TranscriptSegment[] = [];
  let size = 0;
  for (const seg of segments) {
    const len = seg.text.length + seg.speaker.length + 20;
    if (current.length > 0 && size + len > maxChars) {
      chunks.push(current);
      current = current.slice(-overlapSegments);
      size = current.reduce((n, s) => n + s.text.length + s.speaker.length + 20, 0);
    }
    current.push(seg);
    size += len;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function transcriptDurationMs(segments: readonly TranscriptSegment[]): number {
  if (segments.length === 0) return 0;
  return Math.max(...segments.map((s) => s.endMs)) - Math.min(...segments.map((s) => s.startMs));
}

export function wordCount(segments: readonly TranscriptSegment[]): number {
  return segments.reduce((n, s) => n + words(s.text).length, 0);
}
