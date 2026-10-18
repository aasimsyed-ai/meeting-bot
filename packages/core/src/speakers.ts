import type { TranscriptSegment } from './types.ts';
import { firstName, normalizeWhitespace } from './text.ts';

/** A possible name for a numbered voice, with the words that suggest it. */
export interface SpeakerSuggestion {
  speakerId: string;
  name: string;
  /** Plain-language reason shown to the user, quoting what was said. */
  reason: string;
  /** The line that gives the strongest clue. */
  segmentId: string;
  score: number;
}

const GENERIC = /^(?:speaker|participant|guest)\s*\d+$/i;

/** Capitalized words that are not names even when they look like one. */
const NOT_NAMES = new Set(
  (
    'I Im Ill Ive Id OK Okay So Yes Yeah Yep No Nope Thanks Thank Great Perfect Nice Good Hi Hey Hello ' +
    'Morning Afternoon Evening Everyone Everybody All Team Folks Guys Well Now Right Sure Fine Cool ' +
    'Agreed Sorry Please The A An We You They He She It This That There Here Then And But Or ' +
    'Let Lets What Who When Where Why How Which Monday Tuesday Wednesday Thursday Friday Saturday ' +
    'Sunday January February March April May June July August September October November December ' +
    'Today Tomorrow Yesterday Both Anyway Also Next Last First Maybe Absolutely Definitely Exactly ' +
    'True Fair Cheers Bye Goodbye Welcome Congrats Congratulations Wow Oh Ah Um Uh Hmm'
  ).split(/\s+/),
);

// Names must start with a capital letter, so these patterns are case-sensitive; the words
// around the name list both spellings ("Thanks"/"thanks") instead of using the i flag.
const NAME = "([A-Z][a-z]{1,14}(?:[-'][A-Z][a-z]+)?)";
const THANKS_RE = new RegExp(
  `\\b(?:[Tt]hanks|[Tt]hank you|[Cc]heers|[Gg]reat|[Pp]erfect|[Nn]ice one|[Gg]ood point|[Ww]ell done|[Gg]ood question)\\s*,?\\s+${NAME}\\b`,
);
const GREETING_RE = new RegExp(
  `(?:^|[.!?]\\s+)(?:[Hh]i|[Hh]ey|[Hh]ello|[Mm]orning|[Gg]ood morning)\\s*,?\\s+${NAME}\\b`,
);
const GREET_ALL_RE = new RegExp(`\\b(?:[Hh]i|[Hh]ey|[Hh]ello)\\s*,?\\s+${NAME}\\b`, 'g');
const ADDRESS_RE = new RegExp(
  `(?:^|[.!?]\\s+)${NAME}\\s*,\\s*(?:can|could|would|will|please|do|did|are|is|what|how|when|any|you)\\b`,
);
const ADDRESS_AFTER_RE = new RegExp(
  `\\b(?:[Cc]an|[Cc]ould|[Ww]ould|[Ww]ill) you\\b[^?]*,\\s*${NAME}\\s*\\?\\s*$`,
);
const SELF_RE = new RegExp(
  `\\b(?:I'm|I am|[Mm]y name is|[Ii]t's|[Tt]his is)\\s+${NAME}\\b(?=\\s*(?:here|speaking|from|,|\\.|$))`,
);
const ACCEPT_RE =
  /^(?:yes|yeah|yep|sure|ok(?:ay)?|of course|absolutely|will do|no problem|i'll|i will|i can|on it|got it|happy to)\b/i;

const isName = (w: string, known: Set<string>) =>
  known.has(w.toLowerCase()) || (!NOT_NAMES.has(w.replace(/['-]/g, '')) && w.length >= 3);

const quote = (s: string) => `“${truncateWords(s, 12)}”`;
function truncateWords(s: string, n: number): string {
  const w = normalizeWhitespace(s).split(' ');
  return w.length > n ? `${w.slice(0, n).join(' ')}…` : w.join(' ');
}

/**
 * Suggest names for numbered voices from how people talk to each other: someone
 * thanks or greets a name right after a voice spoke, asks a name to do something and
 * that voice answers, or a voice introduces itself. Only suggestions: the user decides.
 *
 * `known` are names already in the meeting (participants, the user); they count as names
 * even when lowercase-looking. `taken` are names already given to a voice.
 */
export function suggestSpeakerNames(
  segments: readonly TranscriptSegment[],
  opts: { known?: string[]; taken?: string[]; userName?: string } = {},
): SpeakerSuggestion[] {
  const known = new Set(
    [...(opts.known ?? []), ...(opts.taken ?? []), opts.userName ?? '']
      .filter(Boolean)
      .map((n) => firstName(n).toLowerCase()),
  );
  const user = opts.userName ? firstName(opts.userName).toLowerCase() : null;
  const taken = new Set((opts.taken ?? []).map((n) => firstName(n).toLowerCase()));
  // votes[speakerId][name] = { score, best clue }
  const votes = new Map<
    string,
    Map<string, { score: number; reason: string; seg: string; w: number; display: string }>
  >();
  const vetoes = new Map<string, Set<string>>();
  const generic = (s: TranscriptSegment) => GENERIC.test(s.speaker);
  const vote = (s: TranscriptSegment, name: string, w: number, reason: string, seg: string) => {
    if (!generic(s)) return;
    const key = name.toLowerCase();
    if (key === user || taken.has(key)) return;
    const per = votes.get(s.speakerId) ?? new Map();
    const v = per.get(key) ?? { score: 0, reason, seg, w: 0, display: name };
    v.score += w;
    if (w > v.w) Object.assign(v, { reason, seg, w });
    per.set(key, v);
    votes.set(s.speakerId, per);
  };
  const veto = (s: TranscriptSegment, name: string) => {
    const set = vetoes.get(s.speakerId) ?? new Set();
    set.add(name.toLowerCase());
    vetoes.set(s.speakerId, set);
  };
  // The previous turn by someone else: who was just speaking.
  const before = (i: number) => {
    for (let k = i - 1; k >= Math.max(0, i - 2); k--)
      if (segments[k]!.speakerId !== segments[i]!.speakerId) return segments[k]!;
    return undefined;
  };
  const after = (i: number) => {
    for (let k = i + 1; k <= Math.min(segments.length - 1, i + 2); k++)
      if (segments[k]!.speakerId !== segments[i]!.speakerId) return segments[k]!;
    return undefined;
  };

  segments.forEach((s, i) => {
    const text = s.text.trim();
    // Anyone this person greets or thanks by name is someone else.
    for (const m of text.matchAll(GREET_ALL_RE)) if (isName(m[1]!, known)) veto(s, m[1]!);
    const thanked = THANKS_RE.exec(text);
    if (thanked && isName(thanked[1]!, known)) {
      veto(s, thanked[1]!);
      const prev = before(i);
      if (prev)
        vote(
          prev,
          thanked[1]!,
          1.5,
          `${s.speaker} said ${quote(text)} right after this voice spoke`,
          s.id,
        );
    }
    const greeted = GREETING_RE.exec(text);
    if (greeted && isName(greeted[1]!, known)) {
      const prev = before(i);
      if (prev && i - segments.indexOf(prev) === 1)
        vote(
          prev,
          greeted[1]!,
          1,
          `${s.speaker} said ${quote(text)} right after this voice spoke`,
          s.id,
        );
    }
    const asked = ADDRESS_RE.exec(text) ?? ADDRESS_AFTER_RE.exec(text);
    if (asked && isName(asked[1]!, known)) {
      veto(s, asked[1]!);
      const next = after(i);
      if (next && ACCEPT_RE.test(next.text.trim()))
        vote(next, asked[1]!, 2, `This voice answered ${quote(text)}`, next.id);
    }
    const self = SELF_RE.exec(text);
    if (self && isName(self[1]!, known))
      vote(s, self[1]!, 3, `This voice said ${quote(text)}`, s.id);
  });

  // Best name per voice, each name for one voice only, strongest first.
  const candidates: SpeakerSuggestion[] = [];
  for (const [speakerId, per] of votes)
    for (const [key, v] of per) {
      if (vetoes.get(speakerId)?.has(key) || v.score < 1) continue;
      candidates.push({
        speakerId,
        name: v.display,
        reason: v.reason,
        segmentId: v.seg,
        score: v.score,
      });
    }
  candidates.sort((a, b) => b.score - a.score || a.speakerId.localeCompare(b.speakerId));
  const usedVoices = new Set<string>();
  const usedNames = new Set<string>();
  const out: SpeakerSuggestion[] = [];
  for (const c of candidates) {
    const key = c.name.toLowerCase();
    if (usedVoices.has(c.speakerId) || usedNames.has(key)) continue;
    // A voice with two equally strong names is not a suggestion, it is a guess.
    const rival = candidates.find(
      (o) => o.speakerId === c.speakerId && o.name !== c.name && o.score === c.score,
    );
    if (rival) continue;
    usedVoices.add(c.speakerId);
    usedNames.add(key);
    out.push(c);
  }
  return out;
}
