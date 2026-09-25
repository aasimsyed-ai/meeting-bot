import { describe, expect, it } from 'vitest';
import {
  findDeadlinePhrase,
  normalizeDeadline,
  ordinalWordsToNumbers,
  stripDeadline,
} from '../src/deadlines.ts';

// Monday, September 21, 2026, 10:00 in New York.
const MON = '2026-09-21T10:00:00-04:00';
const TZ = 'America/New_York';
const d = (phrase: string, at = MON) => normalizeDeadline(phrase, at, TZ);

describe('findDeadlinePhrase', () => {
  it.each([
    ["I'll update the firewall rule by Thursday.", 'by Thursday'],
    ['Send it by the end of the week please', 'by the end of the week'],
    ['We need to update the docs by the end of the month.', 'by the end of the month'],
    ['Can you have it ready tomorrow morning?', 'tomorrow morning'],
    ['by October twentieth', 'by October twentieth'],
    ['due 2026-10-03', 'due 2026-10-03'],
    ['before the launch', 'before the launch'],
    ['send the deck by Friday end of day', 'by Friday end of day'],
    ['I can jump on a call this afternoon', 'this afternoon'],
    ['ASAP please', 'ASAP'],
  ])('%s -> %s', (text, phrase) => {
    expect(findDeadlinePhrase(text)?.toLowerCase()).toBe(phrase.toLowerCase());
  });

  it('returns null when there is no deadline', () => {
    expect(findDeadlinePhrase("I'll fix the migration script so it runs faster.")).toBeNull();
    expect(findDeadlinePhrase('I sat down with the team.')).toBeNull();
  });
});

describe('normalizeDeadline', () => {
  it.each([
    ['today', '2026-09-21'],
    ['EOD', '2026-09-21'],
    ['tomorrow', '2026-09-22'],
    ['by Thursday', '2026-09-24'],
    ['by Friday', '2026-09-25'],
    ['end of the week', '2026-09-25'],
    ['end of next week', '2026-10-02'],
    ['end of the month', '2026-09-30'],
    ['end of the quarter', '2026-09-30'],
    ['in two weeks', '2026-10-05'],
    ['within 3 business days', '2026-09-24'],
    ['by October 20', '2026-10-20'],
    ['by October twentieth', '2026-10-20'],
    ['the 15th of October', '2026-10-15'],
    ['2026-11-02', '2026-11-02'],
    ['by Friday end of day', '2026-09-25'],
  ])('%s -> %s', (phrase, date) => {
    const r = d(phrase);
    expect(r.date).toBe(date);
    expect(r.phrase).toBe(phrase);
  });

  it('keeps vague phrases undated and marks them for review', () => {
    for (const p of ['before the launch', 'before the next meeting', 'this sprint']) {
      const r = d(p);
      expect(r.date).toBeNull();
      expect(r.needsReview).toBe(true);
    }
  });

  it('treats ASAP as urgent but without a date and without review', () => {
    expect(d('ASAP')).toEqual({
      phrase: 'ASAP',
      date: null,
      approximate: false,
      needsReview: false,
    });
  });

  it('marks "next week" as an approximate estimate', () => {
    const r = d('next week');
    expect(r.date).toBe('2026-10-02');
    expect(r.approximate).toBe(true);
  });

  it('flags "next Friday" as ambiguous when this Friday is still ahead', () => {
    const r = d('by next Friday', '2026-09-23T11:00:00-04:00');
    expect(r.date).toBe('2026-10-02');
    expect(r.needsReview).toBe(true);
  });

  it('flags a weekday said on the same weekday', () => {
    const r = d('by Monday');
    expect(r.date).toBe('2026-09-28');
    expect(r.needsReview).toBe(true);
  });

  it('uses the meeting time zone, not UTC, for the reference day', () => {
    // 23:30 in New York on Sep 21 is already Sep 22 in UTC.
    expect(normalizeDeadline('tomorrow', '2026-09-21T23:30:00-04:00', TZ).date).toBe('2026-09-22');
    expect(normalizeDeadline('tomorrow', '2026-09-21T23:30:00-04:00', 'UTC').date).toBe(
      '2026-09-23',
    );
  });

  it('handles month and year rollover', () => {
    expect(normalizeDeadline('tomorrow', '2026-12-31T10:00:00-05:00', TZ).date).toBe('2027-01-01');
    expect(normalizeDeadline('end of next month', '2026-12-10T10:00:00-05:00', TZ).date).toBe(
      '2027-01-31',
    );
  });

  it('throws on an invalid meeting date instead of guessing', () => {
    expect(() => normalizeDeadline('tomorrow', 'not a date', TZ)).toThrow();
  });
});

describe('helpers', () => {
  it('converts spoken ordinals', () => {
    expect(ordinalWordsToNumbers('October twenty-first')).toBe('October 21');
    expect(ordinalWordsToNumbers('the ninth of May')).toBe('the 9 of May');
  });

  it('strips the deadline from task text', () => {
    expect(stripDeadline('update the firewall rule by Thursday.', 'by Thursday')).toBe(
      'update the firewall rule.',
    );
  });
});
