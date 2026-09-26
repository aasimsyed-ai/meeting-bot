import type { MeetingContext, TranscriptSegment } from '../types.ts';
import type {
  ExtractionInput,
  Extractor,
  RawActionItem,
  RawDecision,
  RawExtraction,
  RawQuestion,
  RawRisk,
  RawTopic,
} from './schema.ts';
import { findDeadlinePhrase, stripDeadline } from '../deadlines.ts';
import { looksLikeInjection } from '../injection.ts';
import {
  capitalize,
  contentStems,
  contentWords,
  GENERAL_DISCUSSION,
  firstName,
  normalizeWhitespace,
  sentences,
  similarity,
  words,
} from '../text.ts';

/**
 * Offline, deterministic extractor ("Basic" mode). Conservative on purpose:
 * it only reports action items for explicit commitments, assignments or
 * accepted requests, and only confirms decisions that were clearly agreed.
 */
export const RULES_PROMPT_VERSION = 'rules-2';

interface Unit {
  segId: string;
  speaker: string;
  text: string;
  index: number;
  startMs: number;
  /** True when the source segment had no punctuation at all (raw recognition output). */
  unpunctuated: boolean;
}

interface PendingRequest {
  task: string;
  deadline: string | null;
  requester: string;
  addressee: string | null;
  unit: Unit;
  consumed: boolean;
  /** Imperative requests ("Bob, please...") count even without an explicit yes. */
  imperative: boolean;
}

const GENERIC_SPEAKER = /^(speaker\s*\d+|unknown speaker|unknown|participant\s*\d+|guest)$/i;
const LEAD_INTERJECTION =
  /^(?:(?:so|and|but|also|ok(?:ay)?|well|great|right|alright|yeah|yes|good|then|now)[,.]?\s+)+/i;
const ACCEPT_WORDS =
  /^(?:(?:sure|yes|yeah|yep|ok(?:ay)?|absolutely|of course|no problem|definitely|happy to)\b[,.!]?\s*)+(.*)$/i;
const ACCEPT_PHRASE =
  /^(?:i\s*(?:'ll|will|can)\s+(?:do|take|handle|own)\s+(?:that|it|this)|i've got (?:it|that)|i got (?:it|that)|consider it done|will do|on it|can do|i'm on it)\b/i;

/** "Sure.", "Yes, I'll have it by Friday", "I can do that". Not "Okay, Monday it is." */
function isAcceptance(text: string): boolean {
  const t = text.trim();
  if (ACCEPT_PHRASE.test(t)) return true;
  const m = ACCEPT_WORDS.exec(t);
  if (!m) return false;
  const rest = m[1]!.trim();
  if (!rest) return true;
  if (/\bit is\b|\bthanks?\b|\bthank you\b|\bbye\b|\?/i.test(rest)) return false;
  if (ACCEPT_PHRASE.test(rest) || /^(?:i\s*(?:'ll|will|can)|let me)\b/i.test(rest)) return true;
  return words(rest).length <= 3;
}
const AGREE_ANYWHERE_RE =
  /^[^,.;]{0,30}\b(?:works for (?:me|us)|is fine(?: with me| by me)?|sounds good|fine by me)\b/i;
const AGREE_RE =
  /^(?:agreed|sounds good|sounds great|works for me|that works|yes|yep|yeah|sure|great|perfect|let's do (?:it|that)|makes sense|fine by me|i agree|\+1|deal|done|ok(?:ay)?|alright|good call|good idea|love it|same here)\b/i;
/** A turn that is only agreement: "Agreed." "Perfect." */
const AGREE_ONLY_RE =
  /^(?:agreed|decided|confirmed|settled|great|perfect|ok(?:ay)?|alright|all right|good|sounds good)[.!]*$/i;
/** A turn that starts by closing a topic: "Agreed, deployment is Monday." */
const CLOSING_RE = /^(?:agreed|decided|confirmed)\b/i;
const DISAGREE_RE =
  /\b(?:but|however|risky|disagree|not sure|don't think|do not think|won't work|can't|cannot|too soon|not ready|push back|concern|worried|wait)\b/i;
const NEGATION_RE =
  /\b(?:won't|will not|can't|cannot|don't|do not|not going to|never|no need to|shouldn't|wouldn't)\b/i;
const PAST_RE =
  /\b(?:already|yesterday|last week|i've (?:done|finished|completed|updated|sent|fixed|shipped|merged|reviewed)|i have (?:done|finished|completed|updated|sent|fixed|shipped|merged|reviewed)|i (?:did|finished|completed|updated|sent|fixed|shipped|merged|reviewed|renewed)\b)/i;
const HYPOTHETICAL_RE =
  /\b(?:maybe|might|would be nice|in the future|someday|eventually|at some point|could we|if only|i wonder|i'd|i would)\b/i;
/** Things said to run the meeting itself, not work to do afterwards. */
const NOT_TASK_RE =
  /^(?:be|think|see|let you know|say|admit|just say|be honest|note|start|kick off|hand it over|pass it|stop sharing|share (?:my|the|your) screen|keep it short|wait|try|go first|mention|talk|leave|drop off|jump (?:in|off|out|ahead|to)|hop off|repeat|summarize|show (?:you|us|the team|everyone|them)|walk (?:you|us|the team|everyone|them) through|take (?:you|us|the team|everyone) through|give (?:you|us|the team|everyone) (?:a|an) (?:quick )?(?:update|overview)|read it out|introduce|explain|recap|go ahead|ask around|look into it)\b/i;
const FILLER_LEAD_RE =
  /^(?:(?:just|also|then|probably|definitely|quickly|actually|go ahead and|make sure to|try to|try and|get to|be sure to|please|basically|really|still|now|have to|need to)\s+)+/i;

export class RulesExtractor implements Extractor {
  readonly kind = 'rules' as const;
  readonly promptVersion = RULES_PROMPT_VERSION;

  async extract(input: ExtractionInput): Promise<RawExtraction> {
    return extractWithRules(input.meeting, input.segments);
  }
}

export function extractWithRules(
  meeting: MeetingContext,
  segments: readonly TranscriptSegment[],
): RawExtraction {
  const units = toUnits(segments);
  const names = collectNames(meeting, segments);
  const nameRe = names.length
    ? `(?:${names
        .map(escapeRe)
        .sort((a, b) => b.length - a.length)
        .join('|')})`
    : '(?!x)x';
  const speakers = [...new Set(segments.map((s) => s.speaker))];

  return {
    tldr: '',
    topics: extractTopics(units),
    decisions: extractDecisions(units),
    actionItems: extractActions(units, meeting, nameRe, names, speakers),
    openQuestions: extractQuestions(units),
    risks: extractRisks(units),
  };
}

/** Repair common speech-recognition artifacts: stutters and missing apostrophes. */
export function repairAsrText(text: string): string {
  let t = text;
  for (let n = 3; n >= 1; n--) {
    const phrase = Array.from({ length: n }, () => "[\\w']+").join('\\s+');
    t = t.replace(new RegExp(`\\b(${phrase})(?:\\s+\\1\\b)+`, 'gi'), '$1');
  }
  const fixes: [RegExp, string][] = [
    [/\bim\b/gi, "I'm"],
    [/\bive\b/gi, "I've"],
    [/\bdont\b/gi, "don't"],
    [/\bcant\b/gi, "can't"],
    [/\bwont\b/gi, "won't"],
    [/\bthats\b/gi, "that's"],
    [/\btheres\b/gi, "there's"],
    [/\bhavent\b/gi, "haven't"],
    [/\bisnt\b/gi, "isn't"],
    [/\bdoesnt\b/gi, "doesn't"],
    [/\bwere\s+(?=about|going|still|over|under|on track)/gi, "we're "],
    [/\byoure\b/gi, "you're"],
    [/\bwhos\b/gi, "who's"],
    [/\bits\s+(?=been|going|a|the|not|fine|done|ready)/gi, "it's "],
  ];
  for (const [re, rep] of fixes) t = t.replace(re, rep);
  // "ill" is almost always "I'll" when a verb follows it.
  t = t.replace(
    /(^|[,.]\s*|\b(?:ok|okay|yeah|yes|sure|so|and|then|but|fine)\s+|\b[A-Za-z]+\s+(?=ill\s))ill\s+(?=[a-z]{2,})/gi,
    (m, pre: string) => `${pre}I'll `,
  );
  return t;
}

function toUnits(segments: readonly TranscriptSegment[]): Unit[] {
  const units: Unit[] = [];
  for (const seg of segments) {
    const unpunctuated = !/[.!?]/.test(seg.text);
    const text = unpunctuated ? repairAsrText(seg.text) : seg.text;
    for (const s of sentences(text)) {
      units.push({
        segId: seg.id,
        speaker: seg.speaker,
        text: s,
        index: units.length,
        startMs: seg.startMs,
        unpunctuated,
      });
    }
  }
  return units;
}

function collectNames(meeting: MeetingContext, segments: readonly TranscriptSegment[]): string[] {
  const set = new Set<string>();
  const add = (n: string | undefined | null) => {
    if (!n) return;
    const name = normalizeWhitespace(n);
    if (!name || GENERIC_SPEAKER.test(name) || /^you$/i.test(name)) return;
    set.add(name);
    set.add(firstName(name));
  };
  meeting.participants.forEach((p) => add(p.name));
  segments.forEach((s) => add(s.speaker));
  add(meeting.user?.name);
  return [...set].filter((n) => n.length > 1);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Map a matched name (maybe a first name) back to the full participant name. */
function canonicalName(name: string, names: string[]): string {
  const lower = name.toLowerCase();
  const full = names.filter((n) => n.includes(' ') && firstName(n).toLowerCase() === lower);
  if (full.length === 1) return full[0]!;
  return names.find((n) => n.toLowerCase() === lower) ?? name;
}

function ownerFromSpeaker(speaker: string, meeting: MeetingContext): string {
  return /^you$/i.test(speaker) ? meeting.user.name : speaker;
}

function isQuestion(u: Unit): boolean {
  if (/\?\s*$/.test(u.text)) return true;
  if (!u.unpunctuated) return false;
  return /^(?:who|when|what|where|how|which|whether|are we|is it|is there|do we|does|did|can we|should we|will we|can you|could you)\b/i.test(
    u.text.replace(LEAD_INTERJECTION, ''),
  );
}

// ---------------------------------------------------------------------------
// Action items

function cleanTask(
  raw: string,
  deadline: string | null,
  opts: { requester?: string; you?: string } = {},
): string | null {
  let t = stripDeadline(raw, deadline);
  t = t.replace(/[?!.]+$/g, '').trim();
  t = t.replace(/^(?:,|and|so|then|that)\s+/i, '');
  t = t.replace(FILLER_LEAD_RE, '');
  // Drop trailing reasons and conditions: "..., since it touches security", "... if nothing else comes up".
  t = t.replace(/,?\s+(?:since|because|so that|as long as|if nothing|unless|whoever)\b.*$/i, '');
  t = t.replace(
    /[,\s]+(?:then|as well|too|okay|ok|alright|right|if that's okay|if that works|for now|please|thanks|thank you|myself|yourself|instead)$/i,
    '',
  );
  t = t.replace(/\s+(?:for you|for everyone)$/i, '');
  if (NOT_TASK_RE.test(t)) return null;
  if (opts.requester) t = t.replace(/\b(me|myself)\b/gi, firstName(opts.requester));
  if (opts.you) t = t.replace(/\byou\b/gi, firstName(opts.you));
  t = t
    .replace(/\bmy\b/gi, 'the')
    .replace(/\bour\b/gi, 'the')
    .replace(/\bus\b/gi, 'the team');
  t = normalizeWhitespace(t);
  if (!t || NOT_TASK_RE.test(t)) return null;
  // Must name real work, not just "do it" / "take care of that".
  if (contentWords(t).length < 2) return null;
  if (/^(?:do|handle|take|own|get)\s+(?:it|that|this|care of (?:it|that|this))$/i.test(t))
    return null;
  return capitalize(t);
}

function priorityOf(text: string, deadline: string | null): 'high' | 'medium' | 'low' {
  if (
    /\b(?:urgent|asap|as soon as possible|critical|blocker|top priority|immediately|right away)\b/i.test(
      text,
    )
  )
    return 'high';
  if (deadline && /\b(?:today|tonight|eod|end of (?:the )?day|tomorrow)\b/i.test(deadline))
    return 'high';
  if (/\b(?:no rush|when you get a chance|nice to have|low priority|whenever)\b/i.test(text))
    return 'low';
  return 'medium';
}

function extractActions(
  units: Unit[],
  meeting: MeetingContext,
  nameRe: string,
  names: string[],
  speakers: string[],
): RawActionItem[] {
  const items: (RawActionItem & { lastIndex: number })[] = [];
  const pending: PendingRequest[] = [];
  const push = (
    task: string | null,
    owner: string | null,
    deadline: string | null,
    confidence: 'high' | 'medium' | 'low',
    unitsUsed: Unit[],
    text: string,
  ) => {
    if (!task) return;
    const ids = unitsUsed.map((u) => u.segId);
    const last = Math.max(...unitsUsed.map((u) => u.index));
    // Same person restating the same commitment moments later: merge instead of duplicating.
    const dup = items.find(
      (i) =>
        (similarity(i.task, task) >= 0.6 && (i.owner === owner || !i.owner || !owner)) ||
        (i.owner === owner &&
          owner !== null &&
          last - i.lastIndex <= 2 &&
          similarity(i.task, task) >= 0.25),
    );
    if (dup) {
      if (!dup.owner && owner) dup.owner = owner;
      if (contentWords(task).length > contentWords(dup.task).length) dup.task = task;
      if (!dup.deadlinePhrase && deadline) dup.deadlinePhrase = deadline;
      for (const id of ids) if (!dup.segmentIds.includes(id)) dup.segmentIds.push(id);
      dup.lastIndex = Math.max(dup.lastIndex, last);
      return;
    }
    items.push({
      task,
      owner,
      deadlinePhrase: deadline,
      priority: priorityOf(text, deadline),
      confidence,
      segmentIds: [...new Set(ids)],
      lastIndex: last,
    });
  };

  const explicitRe = new RegExp(
    `^(?:action items?|todo|to-do|to do|follow[- ]up)\\s*(?:for\\s+(${nameRe}))?\\s*[:\\-–]\\s*(.+)$`,
    'i',
  );
  const firstPersonRe =
    /\b(?:i\s*(?:'ll|will|am going to|'m going to|'m gonna|am gonna)|i can|let me|i'll go ahead and|i'll make sure to)\s+(?!be\b|have to be\b|think\b|say\b|admit\b|let you know\b|just say\b|note\b|see\b|need\b|want\b|miss\b|wait\b|love\b|hear\b|know\b)(.+)/i;
  const namedWillRe = new RegExp(
    `\\b(${nameRe})\\s+(?:will|is going to|is gonna|needs to|has to|should|to|owns|is taking|takes|will take|is on)\\s+(?!be\\b|have\\b|like\\b|know\\b|join\\b|present\\b|share\\b|talk\\b|walk\\b|show\\b|demo\\b)(.+)`,
    'i',
  );
  const addressedBeforeRe = new RegExp(
    `\\b(${nameRe})\\s*,?\\s*(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(.+)`,
    'i',
  );
  const addressedAfterRe = new RegExp(
    `\\b(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(.+?),?\\s+(${nameRe})\\s*[?.!]*$`,
    'i',
  );
  const namedPleaseRe = new RegExp(`\\b(${nameRe})\\s*,\\s*please\\s+(.+)`, 'i');
  const anonRequestRe =
    /\b(?:can|could|would)\s+(?:you|someone|somebody|anyone)\s+(?:please\s+)?(.+?)\??$/i;
  const whoCanRe = /\bwho\s+(?:can|could|will|wants to|is going to|'s going to)\s+(.+?)\??$/i;
  const groupRe = /\b(?:we|someone|somebody)\s+(?:need|needs|have|has)\s+to\s+(.+)/i;

  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    const text = u.text;
    if (looksLikeInjection(text)) continue;
    const question = isQuestion(u);
    const deadline = findDeadlinePhrase(text);
    const prevOther = [...units.slice(Math.max(0, i - 2), i)]
      .reverse()
      .find((p) => p.speaker !== u.speaker);

    // 0) Acceptance of an earlier request by someone else.
    if (isAcceptance(text)) {
      const req = [...pending]
        .reverse()
        .find(
          (p) =>
            !p.consumed &&
            p.requester !== u.speaker &&
            u.index - p.unit.index <= 4 &&
            (!p.addressee ||
              p.addressee === u.speaker ||
              firstName(p.addressee) === firstName(u.speaker)),
        );
      if (req) {
        req.consumed = true;
        push(
          req.task,
          ownerFromSpeaker(u.speaker, meeting),
          deadline ?? req.deadline,
          'high',
          [req.unit, u],
          req.unit.text + ' ' + text,
        );
        continue;
      }
    }

    // 1) Explicit "Action item: ..." markers.
    const ex = explicitRe.exec(text);
    if (ex) {
      const body = ex[2]!;
      let owner = ex[1] ? canonicalName(ex[1], names) : null;
      let taskText = body;
      const inner = new RegExp(`^(${nameRe})\\s+(?:will|to|should|is going to)\\s+(.+)`, 'i').exec(
        body,
      );
      if (inner) {
        owner = canonicalName(inner[1]!, names);
        taskText = inner[2]!;
      }
      push(cleanTask(taskText, deadline), owner, deadline, owner ? 'high' : 'medium', [u], text);
      continue;
    }

    if (NEGATION_RE.test(text) && !/\bdon't forget to\b/i.test(text)) continue;
    if (PAST_RE.test(text)) continue;

    // 2) Requests addressed to a named person. They become tasks once accepted
    //    (or right away when phrased as an instruction).
    const ab = addressedBeforeRe.exec(text);
    const aa = ab ? null : addressedAfterRe.exec(text);
    const np = ab || aa ? null : namedPleaseRe.exec(text);
    if (ab || aa || np) {
      const name = ab ? ab[1]! : aa ? aa[2]! : np![1]!;
      const body = ab ? ab[2]! : aa ? aa[1]! : np![2]!;
      const owner = canonicalName(name, names);
      const task = cleanTask(body, deadline, { requester: u.speaker });
      if (task && owner !== u.speaker) {
        const imperative = Boolean(np) || !question;
        if (np) push(task, owner, deadline, 'medium', [u], text);
        else
          pending.push({
            task,
            deadline,
            requester: u.speaker,
            addressee: owner,
            unit: u,
            consumed: false,
            imperative,
          });
      }
      continue;
    }

    // 3) Unaddressed requests: wait for someone to accept.
    const anon = anonRequestRe.exec(text) ?? whoCanRe.exec(text);
    if (anon && question) {
      const task = cleanTask(anon[1]!, deadline, { requester: u.speaker });
      if (task) {
        const others = speakers.filter((s) => s !== u.speaker);
        const direct = /\byou\b/i.test(text) && others.length === 1 ? others[0]! : null;
        pending.push({
          task,
          deadline,
          requester: u.speaker,
          addressee: direct,
          unit: u,
          consumed: false,
          imperative: false,
        });
      }
      continue;
    }
    if (question) continue;

    // 4) "Bob will update the runbook", "Sarah to complete QA".
    const nw = namedWillRe.exec(text);
    if (nw && !HYPOTHETICAL_RE.test(text)) {
      const owner = canonicalName(nw[1]!, names);
      if (owner !== u.speaker || !/^you$/i.test(owner)) {
        const soft = /\bshould\b/i.test(nw[0].slice(0, nw[1]!.length + 12));
        push(cleanTask(nw[2]!, deadline), owner, deadline, soft ? 'medium' : 'high', [u], text);
        continue;
      }
    }

    // 5) First-person commitments: "I'll update the firewall rule by Thursday".
    const fp = firstPersonRe.exec(text);
    if (fp && !HYPOTHETICAL_RE.test(text.slice(0, fp.index + 12))) {
      const weak =
        /\b(?:i can|let me)\b/i.test(fp[0].slice(0, 12)) ||
        /\b(?:probably|try to|try and|hopefully)\b/i.test(text);
      const you = prevOther ? ownerFromSpeaker(prevOther.speaker, meeting) : undefined;
      push(
        cleanTask(fp[1]!, deadline, { you }),
        ownerFromSpeaker(u.speaker, meeting),
        deadline,
        weak ? 'medium' : 'high',
        [u],
        text,
      );
      continue;
    }

    // 6) Group obligations: only reported when a deadline makes them concrete.
    const g = groupRe.exec(text);
    if (g && deadline && !HYPOTHETICAL_RE.test(text)) {
      push(cleanTask(g[1]!, deadline), null, deadline, 'low', [u], text);
    }
  }

  // Direct instructions that nobody declined still count.
  for (const p of pending) {
    if (!p.consumed && p.imperative && p.addressee)
      push(p.task, p.addressee, p.deadline, 'medium', [p.unit], p.unit.text);
  }
  return items.map(({ lastIndex: _lastIndex, ...rest }) => rest);
}

// ---------------------------------------------------------------------------
// Decisions

function cleanDecision(raw: string): string | null {
  let t = raw.replace(/[?!.]+$/g, '').trim();
  t = t.replace(/^(?:that|to|on|with|,)\s+/i, '');
  t = t.replace(
    /^(?:then\s+)?(?:we|let's|let us)(?:\s+(?:should|will|shall|can|could)|'ll|'re going to| are going to)?\s+/i,
    '',
  );
  t = t.replace(/,?\s+(?:if|as long as|unless|provided)\b.*$/i, '');
  t = normalizeWhitespace(t);
  // Speech recognition sometimes drops sentence breaks; cut run-ons at a clause boundary.
  const w = t.split(' ');
  if (w.length > 14) {
    const cut = w.findIndex(
      (x, i) => i >= 4 && /^(?:that|which|because|so|and|but|then)$/i.test(x),
    );
    if (cut > 0) t = w.slice(0, cut).join(' ');
  }
  if (contentWords(t).length < 2) return null;
  return capitalize(t);
}

const ANNOUNCE_VERB: Record<string, string> = {
  moving: 'Move',
  pushing: 'Push',
  shifting: 'Shift',
  postponing: 'Postpone',
  delaying: 'Delay',
  switching: 'Switch',
};

const PRONOUN_OBJECT =
  /^(?:that|it|this|those|these|the plan|that plan|that option|this option|option \w+)$/i;

function extractDecisions(units: Unit[]): RawDecision[] {
  const out: RawDecision[] = [];
  const add = (text: string | null, status: RawDecision['status'], ids: string[]) => {
    if (!text) return;
    const dup = out.find((d) => similarity(d.text, text) >= 0.6);
    if (dup) {
      if (status === 'confirmed') {
        dup.status = 'confirmed';
        dup.text = text;
        dup.segmentIds = [...new Set([...dup.segmentIds, ...ids])];
      }
      return;
    }
    out.push({ text, status, segmentIds: [...new Set(ids)] });
  };

  const confirmedRe =
    /\b(?:we(?:'ve| have)?\s+(?:all\s+)?(?:agreed|decided)(?:\s+(?:that|to|on))?|it(?:'s| is| was)\s+(?:agreed|decided)(?:\s+that)?|the decision is(?:\s+that|\s+to)?|final decision\s*(?:is|:)|(?:decision|final call|verdict)\s*:|we(?:'re| are)\s+going (?:with|to go with)|we're moving forward with|we are moving forward with|the (?:final )?plan is|agreed[,:]\s*(?:we|let's))\s+(.+)/i;
  const itIsRe =
    /^(?:(?:ok(?:ay)?|alright|all right|so|great|fine|good)[,\s]+)*(.{2,40}?)\s+it is(?:,?\s+then)?[.!]*$/i;
  const restateRe =
    /^(?:(?:agreed|decided|confirmed|so|ok(?:ay)?|alright)[.,!:]?\s+)?(.{3,60}?)\s+(?:is|will be|stays|is going to be)\s+(.{2,40}?)[.!]*$/i;
  const settledRe = /\b(?:that's|that is)\s+(?:settled|decided|final|the plan|a decision)\b/i;
  // "We're moving the deployment to Monday": an announced change is a decision. Not "we're moving on".
  const announceRe =
    /\bwe(?:'re| are)\s+(?:(moving|pushing|shifting)\s+(?!on\b|to\b|ahead\b|forward\b|hard\b|fast\b|quickly\b)((?:\S+\s+){1,6}?(?:to|until|back|out)\b.*)|(postponing|delaying)\s+(.+)|(switching)\s+(to\s+.+))/i;
  // "What if we ...?" even when the first word is misheard ("Where if we ...?", "So if we ...?").
  const ifWeRe = /^(?:\w+\s+)?if we\s+([^,?]+)\?$/i;
  const proposalRe =
    /\b(?:we should|we could|i suggest(?: that)?(?: we)?|i propose(?: that)?(?: we)?|how about(?: we)?|what if we|why don't we|i think we should|i'd suggest|i recommend(?: that)?(?: we)?|(?:then )?we(?:'re| are) going to(?= \w)|(?:then )?we(?:'ll| will)(?= (?:push|move|shift|delay|postpone|pull in|bring forward|switch|change|use|launch|ship|deploy|go live|keep|freeze|cap|adopt|drop|cancel)\b)|let's(?! (?:see|talk|discuss|think|check|look|revisit|take a|circle|start|get started|move on|keep going|keep that|keep it|wrap|kick|begin|jump|go around|do a quick|hear|go through|review|dig|focus|pick this up|table|park|leave it|meet|also make sure|find out)\b))\s+(?!see\b|talk\b|discuss\b|think\b|look\b)(.+)/i;

  const proposals: { text: string; unit: Unit }[] = [];
  const latestProposal = (u: Unit, window: number, filter?: (p: { text: string }) => boolean) =>
    [...proposals]
      .reverse()
      .find((p) => u.index - p.unit.index <= window && (!filter || filter(p)));

  // Others spoke after the proposal and nobody objected.
  const wentAlong = (from: number, to: number, proposer: string): boolean => {
    const between = units.slice(from + 1, to).filter((n) => n.speaker !== proposer);
    return between.length > 0 && !between.some((n) => DISAGREE_RE.test(n.text));
  };

  const agreementAfter = (i: number, proposer: string): Unit | null => {
    for (let j = i + 1; j < Math.min(units.length, i + 4); j++) {
      const next = units[j]!;
      if (next.speaker === proposer) continue;
      if (DISAGREE_RE.test(next.text)) return null;
      if (
        AGREE_RE.test(next.text.replace(/^(?:no,?\s+)(?=.*\b(?:fine|works|good)\b)/i, 'ok ')) ||
        AGREE_ANYWHERE_RE.test(next.text)
      )
        return next;
    }
    return null;
  };

  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (looksLikeInjection(u.text)) continue;

    const c = confirmedRe.exec(u.text);
    if (c) {
      const object = c[1]!.replace(/[.!?]+$/, '').trim();
      const prop = PRONOUN_OBJECT.test(object) ? latestProposal(u, 6) : undefined;
      add(
        prop ? prop.text : (cleanDecision(object) ?? cleanDecision(`Go with ${object}`)),
        'confirmed',
        prop ? [prop.unit.segId, u.segId] : [u.segId],
      );
      continue;
    }

    const an = announceRe.exec(u.text);
    if (an && !isQuestion(u) && !HYPOTHETICAL_RE.test(u.text) && !NEGATION_RE.test(u.text)) {
      const verb = (an[1] ?? an[3] ?? an[5])!.toLowerCase();
      const object = (an[2] ?? an[4] ?? an[6])!.replace(/[.!?]+$/, '').trim();
      add(cleanDecision(`${ANNOUNCE_VERB[verb]} ${object}`), 'confirmed', [u.segId]);
      continue;
    }

    const it = itIsRe.exec(u.text);
    if (it) {
      const subject = it[1]!.replace(/^(?:then|so)\s+/i, '');
      const key = contentWords(subject);
      const prop = latestProposal(u, 10, (p) => key.some((k) => words(p.text).includes(k)));
      add(
        prop ? prop.text : cleanDecision(`Go with ${subject}`),
        'confirmed',
        prop ? [prop.unit.segId, u.segId] : [u.segId],
      );
      continue;
    }

    // "Agreed. Deployment is Monday.": someone closes a proposal by restating it. The
    // proposer counts too, but only after others have spoken without objecting.
    const prevU = units[i - 1];
    const agreedFirst = !!prevU && prevU.speaker === u.speaker && AGREE_ONLY_RE.test(prevU.text);
    const rs =
      (agreedFirst || CLOSING_RE.test(u.text)) && !isQuestion(u) ? restateRe.exec(u.text) : null;
    if (rs) {
      const stems = contentStems(u.text);
      const prop = latestProposal(
        u,
        10,
        (p) => [...contentStems(p.text)].filter((w) => stems.has(w)).length >= 2,
      );
      if (
        prop &&
        (prop.unit.speaker !== u.speaker || wentAlong(prop.unit.index, u.index, u.speaker))
      ) {
        add(prop.text, 'confirmed', [
          ...new Set([prop.unit.segId, ...(agreedFirst ? [prevU.segId] : []), u.segId]),
        ]);
        continue;
      }
    }

    if (settledRe.test(u.text)) {
      const prop = latestProposal(u, 6);
      if (prop) add(prop.text, 'confirmed', [prop.unit.segId, u.segId]);
      continue;
    }

    const p = proposalRe.exec(u.text) ?? ifWeRe.exec(u.text.trim());
    if (p && !HYPOTHETICAL_RE.test(u.text) && !NEGATION_RE.test(p[1]!)) {
      const object = p[1]!.replace(/[.!?]+$/, '').trim();
      // "Let's go with that": refers to the previous proposal or statement.
      const goWith = /^go with\s+(.+)$/i.exec(object);
      let text: string | null;
      let ids = [u.segId];
      let adopted = false;
      if (goWith && PRONOUN_OBJECT.test(goWith[1]!)) {
        const prev = latestProposal(u, 6);
        if (!prev) continue;
        text = prev.text;
        ids = [prev.unit.segId, u.segId];
        // Someone else adopting the proposal is agreement.
        adopted = prev.unit.speaker !== u.speaker;
      } else {
        text = cleanDecision(object) ?? (goWith ? cleanDecision(`Go with ${goWith[1]}`) : null);
      }
      if (!text) continue;
      proposals.push({ text, unit: u });
      if (adopted) {
        add(text, 'confirmed', ids);
        continue;
      }
      const agree = agreementAfter(i, u.speaker);
      add(text, agree ? 'confirmed' : 'possible', agree ? [...ids, agree.segId] : ids);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Open questions

const NON_ANSWER_RE =
  /\b(?:i don't know|i do not know|not sure|no idea|good question|we'll (?:need to )?(?:find out|figure (?:it|that) out)|let's take (?:that|it) offline|tbd|to be determined|(?:still )?to be decided|nobody knows|unclear|haven't decided|not decided|not yet|we'll see|need to check|i'll have to check|let me check|nobody has decided)\b/i;
const EXPLICIT_OPEN_RE =
  /\b(?:open question|still (?:need to|have to) (?:figure out|decide|determine|confirm|check|find out|work out|understand)|(?:we )?(?:don't|do not) know (?:yet )?(?:who|when|whether|if|how)|to be determined|to be decided|unclear (?:who|when|whether|how)|not (?:sure|clear) (?:who|when|whether|if|how)|nobody has (?:decided|confirmed)|we (?:still )?haven't (?:decided|figured out|confirmed)|one thing we still haven't)\b/i;

function extractQuestions(units: Unit[]): RawQuestion[] {
  const out: RawQuestion[] = [];
  const add = (q: string, ids: string[]) => {
    let question = normalizeWhitespace(q).replace(LEAD_INTERJECTION, '');
    if (contentWords(question).length < 1 || words(question).length < 4) return;
    question = capitalize(question.replace(/[.!]+$/, ''));
    if (!question.endsWith('?')) question += '?';
    if (out.some((x) => similarity(x.question, question) >= 0.6)) return;
    out.push({ question, segmentIds: ids });
  };
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (looksLikeInjection(u.text)) continue;
    if (isQuestion(u)) {
      const body = u.text.replace(LEAD_INTERJECTION, '');
      // Requests and rhetorical check-ins are not open questions.
      if (
        /\b(?:can|could|would) you\b|^(?:any (?:objections|questions|thoughts)|anything else|right|ok(?:ay)?|charlie|bob|david|alice)\b/i.test(
          body,
        )
      )
        continue;
      if (words(body).length < 3) continue;
      const replies = units.slice(i + 1, i + 3).filter((n) => n.speaker !== u.speaker);
      const first = replies[0];
      const unanswered = first ? NON_ANSWER_RE.test(first.text) : i >= units.length - 2;
      // A follow-up question in the same breath ("Is that me or someone else?") belongs to the one before it.
      const sameSegmentQuestion = out.some((q) => q.segmentIds.includes(u.segId));
      if (unanswered && !sameSegmentQuestion) add(body, first ? [u.segId, first.segId] : [u.segId]);
      continue;
    }
    if (EXPLICIT_OPEN_RE.test(u.text)) {
      // Only statements that name the open question; bare "not decided yet" replies are handled above.
      const m = /\b(?:who|when|whether|how|what|which)\b.+/i.exec(u.text);
      if (m) add(m[0], [u.segId]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Risks

const RISK_RE =
  /\b(?:risk|risky|blocker|blocking|blocked (?:on|by)|concern(?:ed|s)?|worried|worr(?:y|ies)|might (?:slip|fail|break|delay|not make)|could (?:slip|delay|break|cause|fail)|at risk|dependency on|bottleneck|won't make|behind schedule|vulnerab\w*|single point of failure|too tight|is tight|can't slip)\b/i;
const NO_RISK_RE =
  /\b(?:no (?:risk|concerns?|blockers?)|not (?:a )?(?:risk|concern|worried|blocked)|low risk|nothing blocking|no worries)\b/i;

function extractRisks(units: Unit[]): RawRisk[] {
  const out: RawRisk[] = [];
  for (let i = 0; i < units.length; i++) {
    let u = units[i]!;
    if (looksLikeInjection(u.text) || !RISK_RE.test(u.text) || NO_RISK_RE.test(u.text)) continue;
    if (/\?\s*$/.test(u.text)) continue;
    // "One more risk." followed by the actual risk in the next sentence.
    const next = units[i + 1];
    if (
      contentWords(u.text.replace(/\b(?:one|more|risk|concern|blocker|another)\b/gi, '')).length ===
        0 &&
      next &&
      next.segId === u.segId
    )
      u = next;
    let text = normalizeWhitespace(u.text)
      .replace(LEAD_INTERJECTION, '')
      .replace(
        /^(?:one more risk|one risk|the risk is(?: that)?|my (?:only )?(?:concern|worry) is(?: that)?|just so it is on record)[:,]?\s*/i,
        '',
      );
    text = capitalize(text.replace(/[.!]+$/, ''));
    if (contentWords(text).length < 3) continue;
    if (out.some((r) => similarity(r.text, text) >= 0.5)) continue;
    out.push({ text, segmentIds: [u.segId] });
  }
  return out.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Topics

const TRANSITION_RE =
  /\b(?:let's (?:talk about|discuss|move (?:on )?to|go to|cover|turn to|look at|get into|start with|go through)|next (?:up|topic|item)(?: is)?|moving on to|the (?:next|other) (?:thing|topic|item) is|(?:second|third|next) topic,?|on to|first (?:up|item|topic)(?: is)?|last (?:thing|item|topic)(?: is)?|update on|agenda item|the main item today is|first item is)\s*:?,?\s*(.+)/i;

function titleFrom(text: string): string {
  const t = text
    .replace(/[?!.]+$/, '')
    .replace(/^(?:the|our|a|an)\s+/i, '')
    .replace(/\s+(?:first|quickly|now|today|then|real quick)$/i, '')
    .split(/[.,;]/)[0]!;
  return capitalize(t.split(/\s+/).slice(0, 6).join(' '));
}

/** Words that say nothing about a topic on their own. */
const NOT_A_TOPIC =
  /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|yesterday|week|weeks|month|months|january|february|march|april|june|july|august|september|october|november|december|morning|afternoon|everyone|guys|folks|thanks|thank|good|great|update|finish|make|done|work|working|time|start|sounds|agreed)$/;

/** Fallback title: words people kept coming back to. Never contractions or dates. */
function keywordTitle(units: Unit[]): string {
  const freq = new Map<string, number>();
  for (const u of units)
    for (const w of contentWords(u.text))
      if (w.length > 3 && !/^\d+$/.test(w) && !w.includes("'") && !NOT_A_TOPIC.test(w))
        freq.set(w, (freq.get(w) ?? 0) + 1);
  const top = [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([w]) => w);
  return top.length ? capitalize(top.join(', ')) : GENERAL_DISCUSSION;
}

function extractTopics(units: Unit[]): RawTopic[] {
  if (units.length === 0) return [];
  const blocks: { title: string | null; units: Unit[] }[] = [{ title: null, units: [] }];
  for (const u of units) {
    const t = TRANSITION_RE.exec(u.text);
    const current = blocks[blocks.length - 1]!;
    if (t && !looksLikeInjection(u.text) && contentWords(t[1]!).length >= 1) {
      // A short untitled lead-in (greetings) belongs to the first real topic.
      if (!current.title && current.units.length < 4) current.title = titleFrom(t[1]!);
      else blocks.push({ title: titleFrom(t[1]!), units: [] });
    } else if (current.units.length >= 60) {
      blocks.push({ title: null, units: [] });
    }
    blocks[blocks.length - 1]!.units.push(u);
  }
  return blocks
    .filter((b) => b.units.length > 0)
    .slice(0, 10)
    .map((b) => {
      const informative = b.units.filter(
        (u) => words(u.text).length >= 7 && !looksLikeInjection(u.text),
      );
      const summary = informative
        .slice(0, 2)
        .map((u) => u.text)
        .join(' ');
      return {
        title: b.title ?? keywordTitle(b.units),
        summary: summary || b.units[0]!.text,
        segmentIds: [...new Set(b.units.slice(0, 6).map((u) => u.segId))],
      };
    });
}
