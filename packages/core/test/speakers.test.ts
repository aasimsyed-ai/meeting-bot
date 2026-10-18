import { describe, expect, it } from 'vitest';
import { suggestSpeakerNames } from '../src/speakers.ts';
import { capturedTeamSync } from '../fixtures/captured.ts';
import type { TranscriptSegment } from '../src/types.ts';

function lines(rows: [string, string][]): TranscriptSegment[] {
  return rows.map(([speaker, text], i) => ({
    id: `s${i + 1}`,
    startMs: i * 4000,
    endMs: i * 4000 + 3000,
    speaker,
    speakerId: speaker === 'You' ? 'mic' : speaker.toLowerCase().replace(/\s+/g, '-'),
    text,
  }));
}

const names = (out: ReturnType<typeof suggestSpeakerNames>) =>
  Object.fromEntries(out.map((s) => [s.speakerId, s.name]));

describe('speaker name suggestions', () => {
  it('names the two remote voices of the real ten-minute capture', () => {
    // As the app saw it before the user named anyone: voices are numbered.
    const segments = capturedTeamSync.segments.map((s) => ({
      ...s,
      speaker: s.speakerId === 'mic' ? 'You' : `Speaker ${s.speakerId.replace('spk-', '')}`,
    }));
    const out = suggestSpeakerNames(segments, { userName: 'Charlie Davis' });
    expect(names(out)).toEqual({ 'spk-1': 'Alice', 'spk-2': 'Bob' });
    const bob = out.find((s) => s.name === 'Bob')!;
    expect(bob.reason).toMatch(/Thanks, Bob/);
    expect(segments.find((s) => s.id === bob.segmentId)).toBeTruthy();
  });

  it('uses a request by name that the voice answered', () => {
    const out = suggestSpeakerNames(
      lines([
        ['Speaker 1', 'Bob, can you send the report to finance?'],
        ['Speaker 2', "Sure, I'll send it today."],
      ]),
    );
    expect(names(out)).toEqual({ 'speaker-2': 'Bob' });
    expect(out[0]!.reason).toBe('This voice answered “Bob, can you send the report to finance?”');
  });

  it('uses a self-introduction', () => {
    const out = suggestSpeakerNames(lines([['Speaker 3', "Hi everyone, I'm Priya from finance."]]));
    expect(names(out)).toEqual({ 'speaker-3': 'Priya' });
  });

  it('never suggests the user, a name already given, or a word that is not a name', () => {
    const out = suggestSpeakerNames(
      lines([
        ['Speaker 1', 'We should start.'],
        ['Speaker 2', 'Thanks, Charlie.'],
        ['Speaker 1', 'Sounds good.'],
        ['Speaker 2', 'Thanks, Alice.'],
        ['Speaker 1', 'Okay.'],
        ['Speaker 2', 'Thanks everyone. Great, Monday then.'],
      ]),
      { userName: 'Charlie Davis', taken: ['Alice Johnson'] },
    );
    expect(out).toEqual([]);
  });

  it('does not guess when the clues disagree, and never names a voice after itself', () => {
    const tie = suggestSpeakerNames(
      lines([
        ['Speaker 1', 'I sent it yesterday.'],
        ['Speaker 2', 'Thanks, Bob.'],
        ['Speaker 1', 'And the slides too.'],
        ['Speaker 3', 'Thanks, Dan.'],
      ]),
    );
    expect(tie).toEqual([]);
    const self = suggestSpeakerNames(
      lines([
        ['Speaker 1', 'Hi Alice, hi Charlie.'],
        ['Speaker 2', 'Hi everyone.'],
      ]),
    );
    // Speaker 1 greeted Alice, so Speaker 1 is not Alice.
    expect(self.find((s) => s.speakerId === 'speaker-1')).toBeUndefined();
  });

  it('leaves named voices alone', () => {
    const out = suggestSpeakerNames(
      lines([
        ['Bob Smith', 'I sent the report.'],
        ['Speaker 2', 'Thanks, Bob.'],
      ]),
    );
    expect(out).toEqual([]);
  });
});
