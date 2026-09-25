import { useEffect, useState } from 'react';
import { Copy, ExternalLink, X } from 'lucide-react';
import { emailDomain, isValidEmail, type EmailRecipient } from '@meeting-assistant/core/ui';
import { ApiError, call } from '../api';
import { useApp } from '../App';
import { Modal, Notice, Skeleton, useToast } from '../components/ui';
import type { EmailDraftRow } from '../../shared/types';

/** Generate, review, approve, then the user sends. Never sent automatically. */
export function EmailReview({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const { settings, info } = useApp();
  const toast = useToast();
  const [draft, setDraft] = useState<EmailDraftRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newRecipient, setNewRecipient] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mock = info.emailMode === 'mock';

  useEffect(() => {
    call('email:get', meetingId).then(setDraft, (e) =>
      setError(e instanceof ApiError ? e.message : 'Could not load the email.'),
    );
  }, [meetingId]);

  const myDomain = isValidEmail(settings.profile.email) ? emailDomain(settings.profile.email) : '';
  const external = draft?.to.filter((r) => r.external) ?? [];

  const persist = async (patch: Partial<Pick<EmailDraftRow, 'subject' | 'body' | 'to'>>) => {
    try {
      setDraft(await call('email:update', meetingId, patch));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save your changes.', 'error');
    }
  };

  const addRecipient = () => {
    const email = newRecipient.trim().toLowerCase();
    if (!draft || !isValidEmail(email)) {
      toast('That email address does not look right.', 'warning');
      return;
    }
    if (draft.to.some((r) => r.email === email)) return setNewRecipient('');
    const r: EmailRecipient = {
      name: email.split('@')[0]!,
      email,
      role: 'required',
      external: myDomain ? emailDomain(email) !== myDomain : false,
    };
    void persist({ to: [...draft.to, r] });
    setNewRecipient('');
  };

  const open = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await persist({ subject: draft.subject, body: draft.body });
      const r = await call('email:open', meetingId);
      setResult(r.message);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not open your email app.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!draft) return;
    await persist({ subject: draft.subject, body: draft.body });
    const r = await call('email:copy', meetingId);
    toast(r.message, 'success');
  };

  return (
    <Modal
      title="Review follow-up email"
      onClose={onClose}
      footer={
        draft && (
          <>
            <button className="btn" onClick={() => void copy()}>
              <Copy size={14} aria-hidden /> Copy
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || draft.to.length === 0}
              onClick={() => void open()}
            >
              <ExternalLink size={14} aria-hidden />{' '}
              {mock ? 'Save to test outbox' : 'Open in email app'}
            </button>
          </>
        )
      }
    >
      {error && <Notice tone="danger">{error}</Notice>}
      {!draft && !error && <Skeleton lines={6} />}
      {draft && (
        <>
          {mock && (
            <Notice tone="accent">
              Test mode: emails are saved to a local test outbox and never sent.
            </Notice>
          )}
          {result && <Notice tone="success">{result}</Notice>}
          {external.length > 0 && (
            <Notice tone="warning">
              External recipients detected: {external.map((r) => r.email).join(', ')}. Make sure
              they should receive these notes.
            </Notice>
          )}
          {draft.warnings
            .filter((w) => !w.startsWith('External recipients'))
            .map((w) => (
              <Notice key={w}>{w}</Notice>
            ))}
          <div className="field">
            <span className="label" id="to-label">
              To
            </span>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }} aria-labelledby="to-label">
              {draft.to.length === 0 && (
                <span className="muted small">Add at least one recipient.</span>
              )}
              {draft.to.map((r) => (
                <span key={r.email} className={`recipient${r.external ? ' external' : ''}`}>
                  {r.external && '⚠ '}
                  {r.name && r.name !== r.email.split('@')[0] ? `${r.name} <${r.email}>` : r.email}
                  <button
                    className="btn btn-ghost btn-sm btn-icon"
                    style={{ height: 20, width: 20 }}
                    aria-label={`Remove ${r.email}`}
                    onClick={() =>
                      void persist({ to: draft.to.filter((x) => x.email !== r.email) })
                    }
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                addRecipient();
              }}
            >
              <label className="sr-only" htmlFor="add-recipient">
                Add recipient email
              </label>
              <input
                id="add-recipient"
                className="input"
                type="email"
                placeholder="Add an email address"
                value={newRecipient}
                onChange={(e) => setNewRecipient(e.target.value)}
              />
              <button className="btn" type="submit">
                Add
              </button>
            </form>
          </div>
          <div className="field">
            <label htmlFor="email-subject">Subject</label>
            <input
              id="email-subject"
              className="input"
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              onBlur={() => void persist({ subject: draft.subject })}
            />
          </div>
          <div className="field">
            <label htmlFor="email-body">Message</label>
            <textarea
              id="email-body"
              className="textarea"
              rows={14}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              onBlur={() => void persist({ body: draft.body })}
            />
            <span className="hint">
              You send it yourself from your email app, after reviewing it.
            </span>
          </div>
        </>
      )}
    </Modal>
  );
}
