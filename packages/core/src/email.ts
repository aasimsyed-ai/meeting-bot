import type { EmailDraft, EmailRecipient, MeetingContext, MeetingNotes } from './types.ts';
import { firstName } from './text.ts';
import { formatFriendlyDate, localDate, toIsoDate } from './time.ts';

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim()) && email.length <= 254;
}

export function emailDomain(email: string): string {
  return email.trim().toLowerCase().split('@')[1] ?? '';
}

/**
 * Participants with a valid email, excluding the note taker. Anyone outside the
 * note taker's email domain is marked external.
 */
export function resolveRecipients(meeting: MeetingContext): {
  to: EmailRecipient[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const userEmail = meeting.user.email?.trim().toLowerCase() ?? '';
  const userDomain = userEmail && isValidEmail(userEmail) ? emailDomain(userEmail) : '';
  const seen = new Set<string>();
  const to: EmailRecipient[] = [];
  let missing = 0;
  for (const p of meeting.participants) {
    const email = p.email?.trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      if (p.name && p.name !== meeting.user.name) missing++;
      continue;
    }
    if (email === userEmail || seen.has(email)) continue;
    seen.add(email);
    to.push({
      name: p.name,
      email,
      role: p.role ?? 'required',
      external: userDomain ? emailDomain(email) !== userDomain : false,
    });
  }
  const external = to.filter((r) => r.external);
  if (external.length)
    warnings.push(
      `External recipients detected: ${external.map((r) => r.email).join(', ')}. Check that they should receive these notes.`,
    );
  if (!userDomain && to.length)
    warnings.push('Add your email address in Settings so external recipients can be detected.');
  if (missing)
    warnings.push(
      `${missing} ${missing === 1 ? 'person has' : 'people have'} no email address and ${missing === 1 ? 'was' : 'were'} not added.`,
    );
  return { to, warnings };
}

function bullet(lines: string[]): string {
  return lines.map((l) => `• ${l}`).join('\n');
}

/** Plain-text follow-up email built only from validated notes. Never sent without the user's approval. */
export function composeFollowUpEmail(
  notes: MeetingNotes,
  meeting: MeetingContext,
  now: Date = new Date(),
): EmailDraft {
  const { to, warnings } = resolveRecipients(meeting);
  const meetingDay = toIsoDate(localDate(meeting.startedAt, meeting.timeZone));
  const today = toIsoDate(localDate(now.toISOString(), meeting.timeZone));
  const when =
    meetingDay === today ? "today's meeting" : `our meeting on ${formatFriendlyDate(meetingDay)}`;

  const sections: string[] = [`Hi everyone,`, `Here is a summary of ${when}.`];
  if (notes.tldr) sections.push(`Summary\n${notes.tldr}`);

  const confirmed = notes.decisions.filter((d) => d.status === 'confirmed');
  if (confirmed.length) sections.push(`Key Decisions\n${bullet(confirmed.map((d) => d.text))}`);

  if (notes.actionItems.length) {
    const lines = notes.actionItems.map((a) => {
      const owner = a.owner ?? 'Owner to be confirmed';
      const due = a.deadline?.date
        ? `due ${formatFriendlyDate(a.deadline.date)}`
        : a.deadline
          ? a.deadline.phrase
          : '';
      return `${a.task} (${owner}${due ? `, ${due}` : ''})`;
    });
    sections.push(`Action Items\n${bullet(lines)}`);
  }

  if (notes.openQuestions.length)
    sections.push(`Open Questions\n${bullet(notes.openQuestions.map((q) => q.question))}`);

  const next: string[] = [];
  const owners = [
    ...new Set(notes.actionItems.map((a) => a.owner).filter((o): o is string => Boolean(o))),
  ];
  if (owners.length)
    next.push(`${owners.map(firstName).join(', ')}: please confirm your action items and dates.`);
  if (notes.actionItems.some((a) => !a.owner))
    next.push('Some action items still need an owner. Reply if you can take one.');
  if (notes.openQuestions.length)
    next.push('Let me know if you have answers to the open questions.');
  if (!next.length) next.push('Reply if anything here needs correcting.');
  sections.push(`Next Steps\n${bullet(next)}`);

  sections.push(`Best,\n${meeting.user.name || 'Me'}`);

  if (notes.actionItems.some((a) => a.needsReview))
    warnings.push(
      'Some action items are marked "Needs review". You may want to check them before sending.',
    );

  return {
    subject: `Meeting Summary — ${meeting.title}`,
    body: sections.join('\n\n'),
    to,
    warnings,
  };
}

/** A mailto: URL. Callers must check its length; some mail apps cut very long links. */
export function buildMailto(
  draft: Pick<EmailDraft, 'subject' | 'body'> & { to: { email: string }[] },
  includeBody = true,
): string {
  const to = draft.to
    .map((r) => r.email)
    .filter(isValidEmail)
    .join(',');
  const params = [`subject=${encodeURIComponent(draft.subject)}`];
  if (includeBody) params.push(`body=${encodeURIComponent(draft.body.replace(/\n/g, '\r\n'))}`);
  return `mailto:${encodeURIComponent(to).replace(/%2C/g, ',').replace(/%40/g, '@')}?${params.join('&')}`;
}
