import { describe, expect, it } from 'vitest';
import {
  chunkSegments,
  normalizeTranscript,
  removeEcho,
  applySpeakerNames,
  formatForPrompt,
} from '../src/transcript.ts';
import { sentences, similarity, stem } from '../src/text.ts';
import type { TranscriptSegment } from '../src/types.ts';

const seg = (
  id: string,
  startMs: number,
  text: string,
  speaker = 'Alice',
  extra: Partial<TranscriptSegment> = {},
): TranscriptSegment => ({
  id,
  startMs,
  endMs: startMs + 2000,
  speakerId: speaker,
  speaker,
  text,
  ...extra,
});

describe('text helpers', () => {
  it('does not split emails, URLs or decimals into sentences', () => {
    expect(
      sentences(
        'Email attacker@example.com now. Version 2.5 is out! Visit acme.example.test/docs please.',
      ),
    ).toEqual([
      'Email attacker@example.com now.',
      'Version 2.5 is out!',
      'Visit acme.example.test/docs please.',
    ]);
  });

  it('returns unpunctuated speech as one sentence', () => {
    expect(sentences('ok so ill send it tomorrow')).toEqual(['ok so ill send it tomorrow']);
  });

  it('stems related word forms together', () => {
    expect(stem('deploying')).toBe(stem('deploys'));
    expect(stem('certificates')).toBe(stem('certificate'));
    expect(similarity('Update the certificates', 'update certificate')).toBe(1);
  });
});

describe('normalizeTranscript', () => {
  it('handles an empty transcript', () => {
    expect(normalizeTranscript([])).toEqual({ segments: [], warnings: [] });
  });

  it('drops empty and filler-only segments', () => {
    const { segments } = normalizeTranscript([
      seg('a', 0, '   '),
      seg('b', 1000, 'um uh'),
      seg('c', 2000, 'Real words here.'),
    ]);
    expect(segments.map((s) => s.id)).toEqual(['c']);
  });

  it('repairs missing and inverted timestamps', () => {
    const { segments, warnings } = normalizeTranscript([
      seg('a', 0, 'First.'),
      { ...seg('b', Number.NaN, 'Second.'), endMs: Number.NaN },
      { ...seg('c', 9000, 'Third.'), endMs: 100 },
    ]);
    expect(segments.every((s) => Number.isFinite(s.startMs) && s.endMs >= s.startMs)).toBe(true);
    expect(warnings.join(' ')).toMatch(/timestamps/);
  });

  it('sorts by time and removes duplicate deliveries', () => {
    const { segments } = normalizeTranscript([
      seg('b', 5000, 'Later.'),
      seg('a', 1000, 'Earlier.'),
      seg('a2', 1500, 'Earlier.'),
    ]);
    expect(segments.map((s) => s.text)).toEqual(['Earlier.', 'Later.']);
  });

  it('guarantees unique ids', () => {
    const { segments } = normalizeTranscript([
      seg('x', 0, 'One.'),
      seg('x', 1000, 'Two.', 'Bob'),
      seg('', 2000, 'Three.'),
    ]);
    expect(new Set(segments.map((s) => s.id)).size).toBe(3);
  });

  it('survives malformed input without throwing', () => {
    const bad = [null, { text: 42 }, seg('ok', 0, 'Fine.')] as unknown as TranscriptSegment[];
    expect(normalizeTranscript(bad).segments).toHaveLength(1);
  });
});

describe('echo removal', () => {
  it('drops microphone copies of what came through system audio', () => {
    const out = removeEcho([
      seg('s1', 0, 'We should move the deployment to Monday', 'Speaker 1', { channel: 'system' }),
      seg('m1', 300, 'we should move the deployment to monday', 'You', { channel: 'mic' }),
      seg('m2', 5000, 'Monday works for me', 'You', { channel: 'mic' }),
    ]);
    expect(out.map((s) => s.id)).toEqual(['s1', 'm2']);
  });

  it('keeps a reply that repeats the words of the question', () => {
    // Found by the capture harness: the user's commitment was dropped as an "echo".
    const out = removeEcho([
      seg('s1', 12_400, 'Can you check the pricing table by Wednesday?', 'Alice', {
        channel: 'system',
        endMs: 14_700,
      }),
      seg('m1', 15_900, "Yes, I'll check the pricing table by Wednesday.", 'You', {
        channel: 'mic',
      }),
    ]);
    expect(out.map((s) => s.id)).toEqual(['s1', 'm1']);
  });
});

describe('prompt formatting and chunking', () => {
  it('includes ids and timestamps', () => {
    expect(formatForPrompt([seg('s0001', 222000, 'Hello.')])).toBe(
      '[s0001 00:03:42] Alice: Hello.',
    );
  });

  it('applies confirmed speaker names without touching others', () => {
    const out = applySpeakerNames(
      [
        seg('1', 0, 'Hi', 'Speaker 2', { speakerId: 'spk-2' }),
        seg('2', 0, 'Yo', 'Speaker 3', { speakerId: 'spk-3' }),
      ],
      { 'spk-2': 'John' },
    );
    expect(out.map((s) => s.speaker)).toEqual(['John', 'Speaker 3']);
  });

  it('chunks long transcripts with overlap and covers every segment', () => {
    const many = Array.from({ length: 300 }, (_, i) => seg(`s${i}`, i * 1000, 'word '.repeat(40)));
    const chunks = chunkSegments(many, 20_000, 3);
    expect(chunks.length).toBeGreaterThan(1);
    const covered = new Set(chunks.flat().map((s) => s.id));
    expect(covered.size).toBe(300);
    expect(chunks[1]![0]!.id).toBe(chunks[0]![chunks[0]!.length - 3]!.id);
  });
});
