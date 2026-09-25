import type { ExpectedAction, ExpectedItem, MeetingFixture } from '../fixtures/types.ts';
import type { EmailDraft, MeetingNotes } from '../src/types.ts';
import { firstName, words } from '../src/text.ts';

export interface Counts {
  tp: number;
  fp: number;
  fn: number;
}

export interface FixtureScore {
  id: string;
  category: string;
  decisions: Counts;
  actions: Counts;
  questions: Counts;
  risks: Counts;
  ownerChecked: number;
  ownerCorrect: number;
  deadlineChecked: number;
  deadlineCorrect: number;
  /** Items that fail an independent grounding check (should always be 0). */
  unsupported: number;
  totalItems: number;
  violations: string[];
  failures: string[];
}

export function matchesKeywords(text: string, groups: string[][]): boolean {
  const t = ` ${text.toLowerCase().replace(/[’]/g, "'")} `;
  return groups.every((g) => g.some((k) => t.includes(k.toLowerCase())));
}

function score<T>(
  predicted: T[],
  expected: ExpectedItem[],
  textOf: (p: T) => string,
  label: string,
  failures: string[],
): { counts: Counts; pairs: [ExpectedItem, T][] } {
  const counts: Counts = { tp: 0, fp: 0, fn: 0 };
  const used = new Set<number>();
  const pairs: [ExpectedItem, T][] = [];
  const ordered = [...expected.filter((e) => !e.optional), ...expected.filter((e) => e.optional)];
  for (const exp of ordered) {
    const idx = predicted.findIndex(
      (p, i) => !used.has(i) && matchesKeywords(textOf(p), exp.keywords),
    );
    if (idx >= 0) {
      used.add(idx);
      if (!exp.optional) {
        counts.tp++;
        pairs.push([exp, predicted[idx]!]);
      }
    } else if (!exp.optional) {
      counts.fn++;
      failures.push(`missed ${label}: ${exp.keywords.map((g) => g.join('|')).join(' + ')}`);
    }
  }
  predicted.forEach((p, i) => {
    if (!used.has(i)) {
      counts.fp++;
      failures.push(`extra ${label}: "${textOf(p)}"`);
    }
  });
  return { counts, pairs };
}

/** Independent check that every item is grounded in the transcript. */
function unsupportedItems(
  notes: MeetingNotes,
  fx: MeetingFixture,
): { count: number; total: number; details: string[] } {
  const ids = new Set(fx.segments.map((s) => s.id));
  const byId = new Map(fx.segments.map((s) => [s.id, s]));
  const people = new Set<string>([
    ...fx.meeting.participants.map((p) => p.name.toLowerCase()),
    ...fx.segments.map((s) => s.speaker.toLowerCase()),
    fx.meeting.user.name.toLowerCase(),
  ]);
  const details: string[] = [];
  const all = [
    ...notes.decisions.map((d) => ({ label: `decision "${d.text}"`, ev: d.evidence })),
    ...notes.actionItems.map((a) => ({ label: `task "${a.task}"`, ev: a.evidence })),
    ...notes.openQuestions.map((q) => ({ label: `question "${q.question}"`, ev: q.evidence })),
    ...notes.risks.map((r) => ({ label: `risk "${r.text}"`, ev: r.evidence })),
  ];
  for (const item of all) {
    if (item.ev.segmentIds.length === 0 || !item.ev.segmentIds.every((id) => ids.has(id)))
      details.push(`no evidence: ${item.label}`);
  }
  for (const a of notes.actionItems) {
    const cited = a.evidence.segmentIds
      .map((id) => byId.get(id)?.text ?? '')
      .join(' ')
      .toLowerCase();
    if (
      a.owner &&
      !people.has(a.owner.toLowerCase()) &&
      !words(cited).includes(firstName(a.owner).toLowerCase())
    )
      details.push(`owner not grounded: "${a.owner}" on "${a.task}"`);
    if (a.deadline && !cited.includes(a.deadline.phrase.toLowerCase()))
      details.push(`deadline not grounded: "${a.deadline.phrase}"`);
  }
  return { count: details.length, total: all.length, details };
}

export function scoreFixture(
  fx: MeetingFixture,
  notes: MeetingNotes,
  email: EmailDraft,
): FixtureScore {
  const failures: string[] = [];
  const violations: string[] = [];
  const t = fx.truth;
  const confirmed = notes.decisions.filter((d) => d.status === 'confirmed');

  const dec = score(confirmed, t.decisions, (d) => d.text, 'decision', failures);
  const act = score(notes.actionItems, t.actionItems, (a) => a.task, 'task', failures);
  const q = score(notes.openQuestions, t.openQuestions, (x) => x.question, 'question', failures);
  const r = score(notes.risks, t.risks, (x) => x.text, 'risk', failures);

  let ownerChecked = 0;
  let ownerCorrect = 0;
  let deadlineChecked = 0;
  let deadlineCorrect = 0;
  for (const [exp, got] of act.pairs) {
    const e = exp as ExpectedAction;
    ownerChecked++;
    if ((e.owner ?? null)?.toLowerCase() === (got.owner ?? null)?.toLowerCase()) ownerCorrect++;
    else
      failures.push(
        `wrong owner for "${got.task}": expected ${e.owner ?? 'Needs review'}, got ${got.owner ?? 'Needs review'}`,
      );
    if (e.deadline !== undefined) {
      deadlineChecked++;
      const gotDate = got.deadline?.date ?? null;
      if (gotDate === e.deadline) deadlineCorrect++;
      else
        failures.push(
          `wrong deadline for "${got.task}": expected ${e.deadline ?? 'none'}, got ${gotDate ?? got.deadline?.phrase ?? 'none'}`,
        );
    }
  }

  for (const groups of t.notDecisions ? [t.notDecisions] : []) {
    for (const d of confirmed) {
      if (
        matchesKeywords(d.text, groups) &&
        !t.decisions.some((e) => matchesKeywords(d.text, e.keywords))
      )
        violations.push(`superseded or unconfirmed choice shown as a decision: "${d.text}"`);
    }
  }

  const generated = [
    notes.tldr,
    ...notes.topics.flatMap((x) => [x.title, x.summary]),
    ...notes.decisions.map((x) => x.text),
    ...notes.actionItems.map((x) => `${x.task} ${x.owner ?? ''}`),
    ...notes.openQuestions.map((x) => x.question),
    ...notes.risks.map((x) => x.text),
    email.subject,
    email.body,
    ...email.to.map((x) => x.email),
  ]
    .join('\n')
    .toLowerCase();
  for (const f of t.forbidden ?? [])
    if (generated.includes(f.toLowerCase())) violations.push(`forbidden content in output: "${f}"`);

  for (const ext of t.externalRecipients ?? []) {
    const rec = email.to.find((x) => x.email === ext);
    if (!rec || !rec.external) violations.push(`external recipient not flagged: ${ext}`);
  }
  if (fx.category === 'no-names') {
    for (const a of notes.actionItems)
      if (a.owner && !/^speaker \d+$/i.test(a.owner)) violations.push(`invented name "${a.owner}"`);
  }

  const u = unsupportedItems(notes, fx);
  violations.push(...u.details);
  return {
    id: fx.id,
    category: fx.category,
    decisions: dec.counts,
    actions: act.counts,
    questions: q.counts,
    risks: r.counts,
    ownerChecked,
    ownerCorrect,
    deadlineChecked,
    deadlineCorrect,
    unsupported: u.count,
    totalItems: u.total,
    violations,
    failures,
  };
}

export interface Aggregate {
  decisionPrecision: number;
  decisionRecall: number;
  actionPrecision: number;
  actionRecall: number;
  actionFalsePositiveRate: number;
  ownerAccuracy: number;
  deadlineAccuracy: number;
  questionRecall: number;
  riskRecall: number;
  hallucinationRate: number;
  violations: number;
}

const ratio = (a: number, b: number) => (b === 0 ? 1 : a / b);

export function aggregate(scores: FixtureScore[]): Aggregate {
  const sum = (f: (s: FixtureScore) => number) => scores.reduce((n, s) => n + f(s), 0);
  const dTp = sum((s) => s.decisions.tp);
  const dFp = sum((s) => s.decisions.fp);
  const dFn = sum((s) => s.decisions.fn);
  const aTp = sum((s) => s.actions.tp);
  const aFp = sum((s) => s.actions.fp);
  const aFn = sum((s) => s.actions.fn);
  return {
    decisionPrecision: ratio(dTp, dTp + dFp),
    decisionRecall: ratio(dTp, dTp + dFn),
    actionPrecision: ratio(aTp, aTp + aFp),
    actionRecall: ratio(aTp, aTp + aFn),
    actionFalsePositiveRate: ratio(aFp, aTp + aFp),
    ownerAccuracy: ratio(
      sum((s) => s.ownerCorrect),
      sum((s) => s.ownerChecked),
    ),
    deadlineAccuracy: ratio(
      sum((s) => s.deadlineCorrect),
      sum((s) => s.deadlineChecked),
    ),
    questionRecall: ratio(
      sum((s) => s.questions.tp),
      sum((s) => s.questions.tp + s.questions.fn),
    ),
    riskRecall: ratio(
      sum((s) => s.risks.tp),
      sum((s) => s.risks.tp + s.risks.fn),
    ),
    hallucinationRate:
      ratio(
        sum((s) => s.unsupported),
        sum((s) => s.totalItems),
      ) === 1 && sum((s) => s.totalItems) === 0
        ? 0
        : sum((s) => s.unsupported) /
          Math.max(
            1,
            sum((s) => s.totalItems),
          ),
    violations: sum((s) => s.violations.length),
  };
}

/** Minimum quality bar for the offline engine. Used as a CI gate. */
export const RULES_THRESHOLDS: Partial<Record<keyof Aggregate, number>> = {
  decisionPrecision: 0.85,
  actionPrecision: 0.85,
  ownerAccuracy: 0.9,
  deadlineAccuracy: 0.85,
  actionRecall: 0.7,
  decisionRecall: 0.7,
};
