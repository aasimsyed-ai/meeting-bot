import type {
  ActionItem,
  Confidence,
  Decision,
  EngineInfo,
  Evidence,
  MeetingContext,
  MeetingNotes,
  OpenQuestion,
  Risk,
  Topic,
  TranscriptSegment,
} from './types.ts';
import type { RawExtraction } from './extract/schema.ts';
import { findDeadlinePhrase, normalizeDeadline } from './deadlines.ts';
import { findInjectionSegments, looksLikeInjection } from './injection.ts';
import {
  capitalize,
  contentWords,
  coverage,
  firstName,
  GENERAL_DISCUSSION,
  hash53,
  normalizeWhitespace,
  shortName,
  similarity,
  truncate,
  words,
} from './text.ts';

const LIMITS = { topics: 12, decisions: 20, actionItems: 40, openQuestions: 15, risks: 15 };
const GENERIC_SPEAKER = /^(speaker\s*\d+|unknown speaker|unknown|participant\s*\d+|guest)$/i;
const SELF_WORDS = /^(you|me|i|myself|self|the user|note taker)$/i;

export interface ValidationContext {
  meeting: MeetingContext;
  segments: TranscriptSegment[];
  engine: EngineInfo;
  now?: () => Date;
}

interface Stats {
  removedNoEvidence: number;
  removedInjection: number;
  ownersCleared: number;
  deadlinesCleared: number;
}

/**
 * Turn raw engine output into trusted notes. Anything that cannot be traced to
 * the transcript is removed; unsupported owners and deadlines are cleared and
 * marked for review. A missing item is better than a false one.
 */
export function validateExtraction(raw: RawExtraction, ctx: ValidationContext): MeetingNotes {
  const { meeting, segments } = ctx;
  const byId = new Map(segments.map((s) => [s.id, s]));
  const injected = new Set(findInjectionSegments(segments));
  const stats: Stats = {
    removedNoEvidence: 0,
    removedInjection: 0,
    ownersCleared: 0,
    deadlinesCleared: 0,
  };
  const idFor = (kind: string, text: string) =>
    kind + '_' + hash53(`${meeting.id}|${kind}|${text.toLowerCase()}`);

  const evidenceFor = (ids: unknown): Evidence | null => {
    if (!Array.isArray(ids)) return null;
    const valid = [
      ...new Set(ids.filter((id): id is string => typeof id === 'string' && byId.has(id))),
    ];
    if (valid.length === 0) return null;
    const segs = valid.map((id) => byId.get(id)!).sort((a, b) => a.startMs - b.startMs);
    return {
      segmentIds: segs.map((s) => s.id),
      startMs: segs[0]!.startMs,
      quote: truncate(segs.map((s) => `${s.speaker}: ${s.text}`).join(' '), 700),
    };
  };

  /** True when the item was produced from injected instructions rather than real discussion. */
  const isInjected = (text: string, ev: Evidence): boolean => {
    if (looksLikeInjection(text)) return true;
    return ev.segmentIds.some(
      (id) => injected.has(id) && similarity(text, byId.get(id)!.text) >= 0.25,
    );
  };

  const accept = (text: unknown, ev: Evidence | null): ev is Evidence => {
    if (typeof text !== 'string' || !normalizeWhitespace(text)) return false;
    if (!ev) {
      stats.removedNoEvidence++;
      return false;
    }
    if (isInjected(text, ev)) {
      stats.removedInjection++;
      return false;
    }
    return true;
  };

  // ---- Topics
  const topics: Topic[] = [];
  for (const t of raw.topics ?? []) {
    const ev = evidenceFor(t?.segmentIds);
    if (!accept(t?.title, ev)) continue;
    const title = capitalize(normalizeWhitespace(t.title));
    if (topics.some((x) => similarity(x.title, title) >= 0.7)) continue;
    topics.push({
      id: idFor('topic', title),
      title,
      summary: normalizeWhitespace(t.summary ?? ''),
      evidence: ev,
    });
  }

  // ---- Decisions (later confirmed decisions supersede earlier conflicting ones)
  let decisions: Decision[] = [];
  for (const d of raw.decisions ?? []) {
    const ev = evidenceFor(d?.segmentIds);
    if (!accept(d?.text, ev)) continue;
    const text = capitalize(normalizeWhitespace(d.text).replace(/[.]+$/, ''));
    const status = d.status === 'confirmed' || d.status === 'possible' ? d.status : 'discussion';
    const dup = decisions.find((x) => similarity(x.text, text) >= 0.6);
    if (dup) {
      if (status === 'confirmed' && dup.status !== 'confirmed')
        Object.assign(dup, { status, evidence: ev });
      continue;
    }
    decisions.push({ id: idFor('decision', text), text, status, evidence: ev });
  }
  decisions.sort((a, b) => a.evidence.startMs - b.evidence.startMs);
  const confirmed = decisions.filter((d) => d.status === 'confirmed');
  for (let i = 0; i < confirmed.length; i++) {
    for (let j = i + 1; j < confirmed.length; j++) {
      if (supersedes(confirmed[j]!.text, confirmed[i]!.text)) confirmed[i]!.status = 'discussion';
    }
  }
  decisions = decisions.slice(0, LIMITS.decisions);

  // ---- Action items
  const known = knownPeople(meeting, segments);
  const actionItems: ActionItem[] = [];
  for (const a of raw.actionItems ?? []) {
    const ev = evidenceFor(a?.segmentIds);
    if (!accept(a?.task, ev)) continue;
    const task = capitalize(normalizeWhitespace(a.task).replace(/[.]+$/, ''));
    if (words(task).length < 2) continue;

    const citedText = ev.segmentIds.map((id) => byId.get(id)!.text).join(' ');
    const citedSpeakers = ev.segmentIds.map((id) => byId.get(id)!.speaker);
    const owner = resolveOwner(a.owner, known, citedText, citedSpeakers, meeting);
    if (a.owner && !owner) stats.ownersCleared++;

    let deadline = null;
    if (a.deadlinePhrase && normalizeWhitespace(a.deadlinePhrase)) {
      const phrase = groundedPhrase(a.deadlinePhrase, citedText);
      if (phrase) deadline = normalizeDeadline(phrase, meeting.startedAt, meeting.timeZone);
      else stats.deadlinesCleared++;
    }

    let confidence: Confidence =
      a.confidence === 'high' || a.confidence === 'low' ? a.confidence : 'medium';
    if (!owner && confidence === 'high') confidence = 'medium';
    const needsReview =
      !owner ||
      confidence === 'low' ||
      Boolean(deadline?.needsReview) ||
      (Boolean(a.deadlinePhrase) && !deadline);

    const existing = actionItems.find(
      (x) => similarity(x.task, task) >= 0.6 && (x.owner === owner || !x.owner || !owner),
    );
    if (existing) {
      existing.evidence = mergeEvidence(existing.evidence, ev, byId);
      if (!existing.owner && owner) existing.owner = owner;
      if (!existing.deadline && deadline) existing.deadline = deadline;
      existing.needsReview =
        !existing.owner || existing.confidence === 'low' || Boolean(existing.deadline?.needsReview);
      continue;
    }
    actionItems.push({
      id: idFor('action', task),
      task,
      owner,
      deadline,
      priority: a.priority === 'high' || a.priority === 'low' ? a.priority : 'medium',
      confidence,
      needsReview,
      status: 'open',
      evidence: ev,
    });
  }
  actionItems.sort((a, b) => a.evidence.startMs - b.evidence.startMs);

  // ---- Open questions and risks
  const openQuestions: OpenQuestion[] = [];
  for (const q of raw.openQuestions ?? []) {
    const ev = evidenceFor(q?.segmentIds);
    if (!accept(q?.question, ev)) continue;
    let question = capitalize(normalizeWhitespace(q.question));
    if (!/[?]$/.test(question)) question = question.replace(/[.]+$/, '') + '?';
    if (openQuestions.some((x) => similarity(x.question, question) >= 0.6)) continue;
    openQuestions.push({ id: idFor('question', question), question, evidence: ev });
  }
  const risks: Risk[] = [];
  for (const r of raw.risks ?? []) {
    const ev = evidenceFor(r?.segmentIds);
    if (!accept(r?.text, ev)) continue;
    const text = capitalize(normalizeWhitespace(r.text).replace(/[.]+$/, ''));
    if (risks.some((x) => similarity(x.text, text) >= 0.6)) continue;
    risks.push({ id: idFor('risk', text), text, evidence: ev });
  }

  const notes: MeetingNotes = {
    tldr: '',
    topics: topics.slice(0, LIMITS.topics),
    decisions,
    actionItems: actionItems.slice(0, LIMITS.actionItems),
    openQuestions: openQuestions.slice(0, LIMITS.openQuestions),
    risks: risks.slice(0, LIMITS.risks),
    engine: ctx.engine,
    generatedAt: (ctx.now?.() ?? new Date()).toISOString(),
    warnings: [],
  };

  const tldr = normalizeWhitespace(raw.tldr ?? '');
  notes.tldr =
    tldr && !looksLikeInjection(tldr) && tldrIsGrounded(tldr, segments)
      ? tldr
      : composeTldr(notes, meeting);

  const totalWords = segments.reduce((n, s) => n + words(s.text).length, 0);
  if (segments.length === 0)
    notes.warnings.push('No speech was captured, so there is nothing to summarize.');
  else if (totalWords < 40)
    notes.warnings.push('The transcript is very short, so these notes may be incomplete.');
  const removed = stats.removedNoEvidence;
  if (removed > 0)
    notes.warnings.push(
      `${removed} suggested ${removed === 1 ? 'item was' : 'items were'} left out because ${removed === 1 ? 'it' : 'they'} could not be traced to the transcript.`,
    );
  if (injected.size > 0 || stats.removedInjection > 0)
    notes.warnings.push(
      'Some of what was said looked like instructions to an AI. It was treated as conversation only, and nothing was acted on.',
    );
  if (stats.ownersCleared > 0)
    notes.warnings.push(
      'Some task owners could not be confirmed from the transcript and are marked "Needs review".',
    );
  if (stats.deadlinesCleared > 0)
    notes.warnings.push(
      'Some deadlines could not be confirmed from the transcript and were left blank.',
    );
  return notes;
}

const VALUE_RE =
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec|q[1-4]|\d+(?:st|nd|rd|th|%)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty[\w-]*|thirty[\w-]*|forty[\w-]*|fifty[\w-]*|hundred)\b/gi;
const GENERIC_SUBJECT = new Set([
  'go',
  'move',
  'push',
  'use',
  'plan',
  'ship',
  'keep',
  'make',
  'set',
  'week',
  'day',
  'time',
  'date',
  'last',
  'final',
  'then',
  'instead',
]);

function valuesOf(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(VALUE_RE) ?? []).filter(
      (v) => !['may'].includes(v) || /\bmay\s+\d/i.test(text),
    ),
  );
}

/**
 * True when `later` replaces `earlier`: near-identical wording, the same subject
 * with a different date or value ("launch Oct 1" then "launch Oct 15"), or an
 * explicit "instead of" / "rather than" naming the earlier choice.
 */
export function supersedes(later: string, earlier: string): boolean {
  if (similarity(later, earlier) >= 0.34) return true;
  const insteadOf = /\b(?:instead of|rather than|not)\s+(.+)$/i.exec(later);
  if (insteadOf) {
    const replaced = contentWords(insteadOf[1]!);
    if (replaced.length && replaced.every((w) => words(earlier).includes(w))) return true;
  }
  const lv = valuesOf(later);
  const ev = valuesOf(earlier);
  if (!lv.size || !ev.size) return false;
  if ([...lv].every((v) => ev.has(v)) && [...ev].every((v) => lv.has(v))) return false;
  const subject = (t: string) =>
    new Set(
      [...contentWords(t)]
        .filter((w) => !valuesOf(w).size && !GENERIC_SUBJECT.has(w))
        .map((w) => w.slice(0, 5)),
    );
  const a = subject(later);
  return [...subject(earlier)].some((w) => a.has(w));
}

function mergeEvidence(a: Evidence, b: Evidence, byId: Map<string, TranscriptSegment>): Evidence {
  const ids = [...new Set([...a.segmentIds, ...b.segmentIds])].sort(
    (x, y) => byId.get(x)!.startMs - byId.get(y)!.startMs,
  );
  return {
    segmentIds: ids,
    startMs: Math.min(a.startMs, b.startMs),
    quote: truncate(
      ids.map((id) => `${byId.get(id)!.speaker}: ${byId.get(id)!.text}`).join(' '),
      700,
    ),
  };
}

interface KnownPerson {
  name: string;
  first: string;
}

function knownPeople(meeting: MeetingContext, segments: TranscriptSegment[]): KnownPerson[] {
  const names = new Set<string>();
  for (const p of meeting.participants) if (p.name) names.add(normalizeWhitespace(p.name));
  for (const s of segments)
    if (s.speaker && !GENERIC_SPEAKER.test(s.speaker) && !SELF_WORDS.test(s.speaker))
      names.add(s.speaker);
  if (meeting.user?.name) names.add(normalizeWhitespace(meeting.user.name));
  return [...names].map((name) => ({ name, first: firstName(name).toLowerCase() }));
}

/**
 * Accept an owner only when it is grounded: a known participant/speaker, a name
 * spoken in the cited text, or the generic label of a cited speaker.
 */
function resolveOwner(
  owner: string | null | undefined,
  known: KnownPerson[],
  citedText: string,
  citedSpeakers: string[],
  meeting: MeetingContext,
): string | null {
  if (!owner) return null;
  const o = normalizeWhitespace(owner);
  if (
    !o ||
    /^(needs review|unknown|unassigned|tbd|none|n\/a|someone|everyone|the team|team|we|us)$/i.test(
      o,
    )
  )
    return null;
  if (SELF_WORDS.test(o)) {
    // "You"/"I" is only meaningful if the note taker is among the cited speakers.
    return citedSpeakers.some((s) => SELF_WORDS.test(s) || s === meeting.user.name)
      ? meeting.user.name
      : null;
  }
  const lower = o.toLowerCase();
  const exact = known.find((k) => k.name.toLowerCase() === lower);
  if (exact) return exact.name;
  const byFirst = known.filter((k) => k.first === firstName(o).toLowerCase());
  if (byFirst.length === 1) return byFirst[0]!.name;
  if (GENERIC_SPEAKER.test(o))
    return citedSpeakers.some((s) => s.toLowerCase() === lower) ? o : null;
  const cited = ` ${words(citedText).join(' ')} `;
  if (cited.includes(` ${firstName(o).toLowerCase()} `)) return o;
  return null;
}

/** Return the deadline phrase as it appears in the evidence, or null when it cannot be found there. */
function groundedPhrase(phrase: string, citedText: string): string | null {
  const p = normalizeWhitespace(phrase);
  const idx = citedText.toLowerCase().indexOf(p.toLowerCase());
  if (idx >= 0) return citedText.slice(idx, idx + p.length);
  const found = findDeadlinePhrase(citedText);
  if (found && (coverage(p, found) >= 0.5 || coverage(found, p) >= 0.5)) return found;
  // Content words like "friday" must appear in the evidence.
  const key = contentWords(p);
  if (key.length > 0 && key.every((w) => words(citedText).includes(w))) return p;
  return null;
}

/** The model's summary must mostly use words that were actually said. */
function tldrIsGrounded(tldr: string, segments: TranscriptSegment[]): boolean {
  const vocab = new Set(segments.flatMap((s) => contentWords(s.text)));
  const tw = contentWords(tldr);
  if (tw.length === 0) return false;
  const hits = tw.filter(
    (w) => vocab.has(w) || [...vocab].some((v) => v.startsWith(w.slice(0, 5))),
  ).length;
  return hits / tw.length >= 0.5;
}

/** Deterministic, grounded TL;DR built only from validated items. */
export function composeTldr(
  notes: Pick<MeetingNotes, 'topics' | 'decisions' | 'actionItems' | 'openQuestions'>,
  meeting: MeetingContext,
): string {
  const parts: string[] = [];
  // Titles keep their capitals ("Project Phoenix"), so no "The meeting covered ..." sentence.
  // A placeholder title says nothing, so the summary skips it.
  const topics = notes.topics
    .slice(0, 3)
    .map((t) => t.title)
    .filter((t) => t !== GENERAL_DISCUSSION);
  if (topics.length)
    parts.push(`${topics.length === 1 ? 'Topic' : 'Topics'}: ${joinList(topics)}.`);
  const confirmed = notes.decisions.filter((d) => d.status === 'confirmed');
  if (confirmed.length === 1) parts.push(`Decision: ${lowerFirst(confirmed[0]!.text)}.`);
  else if (confirmed.length > 1)
    parts.push(
      `${confirmed.length} decisions were made, including: ${lowerFirst(confirmed[0]!.text)}.`,
    );
  const n = notes.actionItems.length;
  if (n > 0) {
    const owners = [
      ...new Set(notes.actionItems.map((a) => a.owner).filter((o): o is string => Boolean(o))),
    ];
    parts.push(
      `${n} action ${n === 1 ? 'item was' : 'items were'} captured${owners.length ? ` for ${joinList(owners.map(shortName))}` : ''}.`,
    );
  } else {
    parts.push('No action items were captured.');
  }
  if (notes.openQuestions.length)
    parts.push(
      `${notes.openQuestions.length} open ${notes.openQuestions.length === 1 ? 'question remains' : 'questions remain'}.`,
    );
  if (parts.length === 1 && !topics.length) return `Notes for ${meeting.title}. ${parts[0]}`;
  return parts.join(' ');
}

function lowerFirst(s: string): string {
  return s && s.length > 1 && s[1] !== s[1]!.toUpperCase() ? s[0]!.toLowerCase() + s.slice(1) : s;
}

export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
