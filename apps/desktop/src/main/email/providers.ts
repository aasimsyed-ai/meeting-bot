import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMailto, isValidEmail } from '@meeting-assistant/core';
import type { EmailDraftRow, EmailResult } from '../../shared/types';

/**
 * Replaceable email layer. The default opens a draft in the user's own mail
 * app, so the user always reviews and presses Send there. Nothing is ever
 * reported as "sent" unless a provider actually sent it.
 */
export interface EmailProvider {
  readonly id: 'mailapp' | 'mock' | 'gmail' | 'outlook';
  readonly label: string;
  createDraft(draft: EmailDraftRow): Promise<EmailResult>;
  /** Only providers with real sending (OAuth mail APIs) implement send. */
  send?(draft: EmailDraftRow): Promise<EmailResult>;
  getUser?(): Promise<{ name: string; email: string } | null>;
}

export interface MailAppDeps {
  openExternal: (url: string) => Promise<void>;
  copyText: (text: string) => void;
  platform: NodeJS.Platform;
}

/** Some mail apps (notably on Windows) truncate long mailto links. */
const MAX_MAILTO = 1900;

export class MailAppProvider implements EmailProvider {
  readonly id = 'mailapp' as const;
  readonly label = 'Your email app';

  constructor(private readonly deps: MailAppDeps) {}

  async createDraft(draft: EmailDraftRow): Promise<EmailResult> {
    const to = draft.to.filter((r) => isValidEmail(r.email));
    const full = buildMailto({ subject: draft.subject, body: draft.body, to });
    if (full.length <= MAX_MAILTO || this.deps.platform === 'darwin') {
      await this.deps.openExternal(full);
      return {
        status: 'opened_in_mail_app',
        message: 'The email is open in your email app. Review it and press Send there.',
      };
    }
    // Too long for a link: open recipients and subject, put the body on the clipboard.
    this.deps.copyText(draft.body);
    await this.deps.openExternal(buildMailto({ subject: draft.subject, body: '', to }, false));
    return {
      status: 'opened_in_mail_app',
      bodyCopied: true,
      message:
        'Your email app is open with the recipients and subject. The summary is copied, so paste it into the message, then press Send.',
    };
  }
}

/** Test and demo provider: records the email in a local outbox. Never sends anything. */
export class MockEmailProvider implements EmailProvider {
  readonly id = 'mock' as const;
  readonly label = 'Test outbox (nothing is sent)';

  constructor(private readonly outboxDir: string) {}

  async createDraft(draft: EmailDraftRow): Promise<EmailResult> {
    mkdirSync(this.outboxDir, { recursive: true });
    const file = join(this.outboxDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        { to: draft.to, subject: draft.subject, body: draft.body, note: 'MOCK: not sent' },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    return {
      status: 'mock_sent',
      message: 'Test mode: the email was saved to the test outbox. No email was sent.',
    };
  }
}
