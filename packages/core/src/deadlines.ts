import * as chrono from 'chrono-node';
import type { Deadline } from './types.ts';
import {
  addDays,
  endOfMonth,
  localDate,
  toIsoDate,
  weekday,
  WEEKDAYS,
  type CalendarDate,
} from './time.ts';

const WD =
  '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)';
const MONTH =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORD =
  '(?:(?:twenty|thirty)[- ]?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)';
const PREP = '(?:(?:by|before|until|till|due|on|for|no later than|sometime|at the latest by)\\s+)?';
const NUM = '(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)';

/** Ordered from most to least specific; the first pattern that matches wins. */
const PATTERNS: RegExp[] = [
  new RegExp(
    `${PREP}(?:this\\s+|next\\s+)?${WD}\\s+(?:end of (?:the )?day|eod|cob|close of business|morning|afternoon|evening|night)\\b`,
    'i',
  ),
  new RegExp(
    `${PREP}(?:the\\s+)?end\\s+of\\s+(?:the\\s+|this\\s+|next\\s+)?(?:day|week|month|quarter|year|sprint)\\b`,
    'i',
  ),
  new RegExp(`${PREP}(?:eod|eow|eom|cob|close of business|end of business)\\b`, 'i'),
  new RegExp(
    `${PREP}(?:today|tonight|this\\s+(?:morning|afternoon|evening)|tomorrow(?:\\s+(?:morning|afternoon|evening|night))?)\\b`,
    'i',
  ),
  new RegExp(`${PREP}(?:this\\s+|next\\s+)${WD}\\b`, 'i'),
  new RegExp(`${PREP}later\\s+this\\s+(?:week|month)\\b`, 'i'),
  new RegExp(`${PREP}(?:this|next)\\s+(?:week|month|sprint|quarter)\\b`, 'i'),
  new RegExp(
    `${PREP}${MONTH}\\.?\\s+(?:the\\s+)?(?:\\d{1,2}(?:st|nd|rd|th)?|${ORD})(?:,?\\s+\\d{4})?\\b`,
    'i',
  ),
  new RegExp(`${PREP}(?:the\\s+)?${ORD}\\s+of\\s+${MONTH}\\b`, 'i'),
  new RegExp(`${PREP}(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)?\\s+of\\s+${MONTH}\\b`, 'i'),
  new RegExp(`${PREP}\\d{4}-\\d{2}-\\d{2}\\b`, 'i'),
  new RegExp(`${PREP}\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b`, 'i'),
  new RegExp(`${PREP}the\\s+\\d{1,2}(?:st|nd|rd|th)\\b`, 'i'),
  new RegExp(
    `(?:with)?in\\s+(?:the\\s+next\\s+)?${NUM}\\s+(?:business\\s+)?(?:days?|weeks?|months?)\\b`,
    'i',
  ),
  new RegExp(
    `(?:before|by|prior to|ahead of)\\s+(?:the\\s+|our\\s+)?(?:launch|release|go-live|cutover|demo|next\\s+(?:meeting|sync|standup|stand-up|call|review|retro|check-in))\\b`,
    'i',
  ),
  /\b(?:asap|as soon as possible)\b/i,
  new RegExp(`(?:by|before|until|till|due|on|no later than)\\s+${WD}\\b`, 'i'),
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
];

/** Find the most specific deadline phrase in a sentence, e.g. "by Friday". */
export function findDeadlinePhrase(text: string): string | null {
  for (const re of PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0].trim();
  }
  return null;
}

const WORD_NUM: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function weekdayIndex(token: string): number {
  const t = token.toLowerCase().slice(0, 3);
  return WEEKDAYS.findIndex((w) => w.startsWith(t));
}

/** Friday of the week containing `c` (weeks run Monday to Sunday). */
function fridayOfWeek(c: CalendarDate): CalendarDate {
  const wd = weekday(c);
  const mondayOffset = wd === 0 ? -6 : 1 - wd;
  return addDays(c, mondayOffset + 4);
}

function endOfQuarter(c: CalendarDate): CalendarDate {
  const qEndMonth = Math.ceil(c.m / 3) * 3;
  return endOfMonth({ y: c.y, m: qEndMonth, d: 1 });
}

function result(
  phrase: string,
  date: CalendarDate | null,
  approximate = false,
  needsReview = false,
): Deadline {
  return {
    phrase,
    date: date ? toIsoDate(date) : null,
    approximate,
    needsReview: needsReview || date === null,
  };
}

/**
 * Normalize a spoken deadline relative to the meeting's local date.
 * Vague phrases keep a null date and are marked for review rather than guessed.
 */
export function normalizeDeadline(
  phrase: string,
  meetingStartIso: string,
  timeZone?: string,
): Deadline {
  const p = phrase.toLowerCase().replace(/\s+/g, ' ').trim();
  const ref = localDate(meetingStartIso, timeZone);
  const refWd = weekday(ref);

  if (/\b(asap|as soon as possible)\b/.test(p))
    return { phrase, date: null, approximate: false, needsReview: false };
  if (
    /\b(launch|release|go-live|cutover|demo|next (meeting|sync|standup|stand-up|call|review|retro|check-in))\b/.test(
      p,
    )
  )
    return result(phrase, null);

  const hasWeekday = new RegExp(`\\b${WD}\\b`).test(p);
  if (
    !hasWeekday &&
    /\b(today|tonight|this (morning|afternoon|evening)|eod|cob|close of business|end of business)\b|end of (the )?day/.test(
      p,
    )
  )
    return result(phrase, ref);
  if (/\btomorrow\b/.test(p)) return result(phrase, addDays(ref, 1));

  if (/end of (the )?next week/.test(p)) return result(phrase, addDays(fridayOfWeek(ref), 7));
  if (/end of (the |this )?week|\beow\b/.test(p)) {
    const fri = fridayOfWeek(ref);
    return result(
      phrase,
      refWd === 6 || refWd === 0 ? addDays(fri, 7) : fri,
      false,
      refWd === 6 || refWd === 0,
    );
  }
  if (/later this week|\bthis week\b/.test(p)) return result(phrase, fridayOfWeek(ref), true);
  if (/\bnext week\b/.test(p)) return result(phrase, addDays(fridayOfWeek(ref), 7), true);
  if (/end of (the )?next month/.test(p))
    return result(
      phrase,
      endOfMonth({
        ...ref,
        m: ref.m === 12 ? 1 : ref.m + 1,
        y: ref.m === 12 ? ref.y + 1 : ref.y,
        d: 1,
      }),
    );
  if (/end of (the |this )?month|\beom\b/.test(p)) return result(phrase, endOfMonth(ref));
  if (/later this month|\bthis month\b/.test(p)) return result(phrase, endOfMonth(ref), true);
  if (/\bnext month\b/.test(p)) {
    const next = { y: ref.m === 12 ? ref.y + 1 : ref.y, m: ref.m === 12 ? 1 : ref.m + 1, d: 1 };
    return result(phrase, endOfMonth(next), true);
  }
  if (/end of (the |this )?quarter/.test(p)) return result(phrase, endOfQuarter(ref));
  if (/end of (the |this )?year/.test(p)) return result(phrase, { y: ref.y, m: 12, d: 31 });
  if (/sprint|quarter/.test(p)) return result(phrase, null);

  const within = new RegExp(
    `(?:with)?in (?:the next )?(${NUM}) (business )?(days?|weeks?|months?)`,
  ).exec(p);
  if (within) {
    const n = WORD_NUM[within[1]!] ?? Number(within[1]);
    const unit = within[3]!;
    if (unit.startsWith('day')) {
      if (within[2]) {
        let c = ref;
        let left = n;
        while (left > 0) {
          c = addDays(c, 1);
          if (weekday(c) !== 0 && weekday(c) !== 6) left--;
        }
        return result(phrase, c);
      }
      return result(phrase, addDays(ref, n));
    }
    if (unit.startsWith('week')) return result(phrase, addDays(ref, 7 * n));
    return result(phrase, parseWithChrono(`in ${n} months`, ref), true);
  }

  const wdMatch = new RegExp(`\\b(this |next )?(${WD})\\b`).exec(p);
  if (wdMatch && !new RegExp(MONTH + '\\.? \\d').test(p)) {
    const target = weekdayIndex(wdMatch[2]!);
    const modifier = wdMatch[1]?.trim();
    const delta = (target - refWd + 7) % 7;
    if (modifier === 'next') {
      // "next Friday" is ambiguous when this week's Friday is still ahead.
      const upcoming = delta === 0 ? 7 : delta;
      const nextWeeks = addDays(fridayOfWeek(ref), 3); // Monday of next week
      const inNextWeek = (target - 1 + 7) % 7; // days from Monday
      const date = addDays(nextWeeks, inNextWeek);
      const ambiguous = upcoming < 7 && toIsoDate(addDays(ref, upcoming)) !== toIsoDate(date);
      return result(phrase, date, false, ambiguous);
    }
    if (delta === 0) {
      // Said on the same weekday: could mean today or a week from now.
      return result(phrase, addDays(ref, 7), false, true);
    }
    // "this Monday" said on a Wednesday: the day already passed this week.
    const passed = modifier === 'this' && (target === 0 ? 7 : target) < (refWd === 0 ? 7 : refWd);
    return result(phrase, addDays(ref, delta), false, passed);
  }

  const parsed = parseWithChrono(phrase, ref);
  if (parsed) return result(phrase, parsed);
  return result(phrase, null);
}

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  thirtieth: 30,
};

/** "October twenty-first" -> "October 21" so the date parser understands spoken ordinals. */
export function ordinalWordsToNumbers(text: string): string {
  return text.replace(
    new RegExp(`\\b(?:(twenty|thirty)[- ]?)?(${Object.keys(ORDINAL_WORDS).join('|')})\\b`, 'gi'),
    (m, tens: string | undefined, unit: string) => {
      const base = tens ? (tens.toLowerCase() === 'twenty' ? 20 : 30) : 0;
      return String(base + (ORDINAL_WORDS[unit.toLowerCase()] ?? 0));
    },
  );
}

function parseWithChrono(text: string, ref: CalendarDate): CalendarDate | null {
  text = ordinalWordsToNumbers(text);
  const refDate = new Date(ref.y, ref.m - 1, ref.d, 12);
  const d = chrono.parseDate(text, refDate, { forwardDate: true });
  if (!d) return null;
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

/** Remove the deadline phrase from a task sentence, e.g. "update the rule by Friday" -> "update the rule". */
export function stripDeadline(text: string, phrase: string | null): string {
  if (!phrase) return text;
  const idx = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (idx < 0) return text;
  return (text.slice(0, idx) + text.slice(idx + phrase.length))
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
