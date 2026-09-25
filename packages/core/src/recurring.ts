import type { ActionItem, Decision, Deadline, MeetingNotes, OpenQuestion } from './types.ts';
import { normalizeWhitespace, similarity } from './text.ts';

/** "Platform Sync — Sep 21" and "Platform Sync (week 2)" belong to the same series. */
export function seriesKey(title: string): string {
  return normalizeWhitespace(
    title
      .toLowerCase()
      .replace(/\(.*?\)/g, ' ')
      .replace(
        /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/g,
        ' ',
      )
      .replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
      .replace(/\b(?:week|wk|sprint|#)\s*\d+\b/g, ' ')
      .replace(/[—–\-:|#]+/g, ' '),
  );
}

export interface RecurringDiff {
  completedTasks: ActionItem[];
  outstandingTasks: ActionItem[];
  newTasks: ActionItem[];
  newDecisions: Decision[];
  changedDeadlines: { task: ActionItem; before: Deadline | null; after: Deadline | null }[];
  stillOpen: OpenQuestion[];
  newQuestions: OpenQuestion[];
}

function sameTask(a: ActionItem, b: ActionItem): boolean {
  if (similarity(a.task, b.task) < 0.5) return false;
  return !a.owner || !b.owner || a.owner === b.owner;
}

/** What changed since the previous meeting in the same series. Concise by design. */
export function diffMeetings(previous: MeetingNotes, current: MeetingNotes): RecurringDiff {
  const completedTasks: ActionItem[] = [];
  const outstandingTasks: ActionItem[] = [];
  const changedDeadlines: RecurringDiff['changedDeadlines'] = [];
  for (const p of previous.actionItems) {
    const again = current.actionItems.find((c) => sameTask(p, c));
    if (p.status === 'completed' || again?.status === 'completed') completedTasks.push(p);
    else outstandingTasks.push(p);
    if (
      again &&
      (p.deadline?.date ?? null) !== (again.deadline?.date ?? null) &&
      (p.deadline || again.deadline)
    ) {
      changedDeadlines.push({ task: again, before: p.deadline, after: again.deadline });
    }
  }
  const newTasks = current.actionItems.filter(
    (c) => !previous.actionItems.some((p) => sameTask(p, c)),
  );
  const newDecisions = current.decisions.filter(
    (d) =>
      d.status === 'confirmed' &&
      !previous.decisions.some(
        (p) => p.status === 'confirmed' && similarity(p.text, d.text) >= 0.6,
      ),
  );
  const stillOpen = previous.openQuestions.filter(
    (q) =>
      current.openQuestions.some((c) => similarity(c.question, q.question) >= 0.4) ||
      !current.decisions.some(
        (d) => d.status === 'confirmed' && similarity(d.text, q.question) >= 0.3,
      ),
  );
  const newQuestions = current.openQuestions.filter(
    (c) => !previous.openQuestions.some((q) => similarity(c.question, q.question) >= 0.4),
  );
  return {
    completedTasks,
    outstandingTasks,
    newTasks,
    newDecisions,
    changedDeadlines,
    stillOpen,
    newQuestions,
  };
}
