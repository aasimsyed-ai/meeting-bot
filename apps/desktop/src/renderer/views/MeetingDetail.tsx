import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Mail,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import { PLATFORM_LABELS, type Evidence } from '@meeting-assistant/core/ui';
import { ApiError, call } from '../api';
import { queryParam } from '../lib/router';
import { formatDate, formatDue, formatDuration, formatTimestamp } from '../lib/format';
import { useAppEvent, useQuery } from '../lib/hooks';
import {
  Empty,
  ErrorState,
  Modal,
  Notice,
  Skeleton,
  Spinner,
  WhyButton,
  useToast,
} from '../components/ui';
import { EmailReview } from './EmailReview';
import { ModelNotice } from './shared';
import type { MeetingDetail as Detail, ProcessingInfo, TaskRow } from '../../shared/types';

export function MeetingDetail({ id, path }: { id: string; path: string }) {
  const toast = useToast();
  const q = useQuery(() => call('meetings:get', id), [id], ['meetings-changed', 'tasks-changed']);
  const [processing, setProcessing] = useState<ProcessingInfo | null>(null);
  const [tab, setTab] = useState<'summary' | 'transcript'>(
    queryParam(path, 't') ? 'transcript' : 'summary',
  );
  const [highlight, setHighlight] = useState<string | null>(queryParam(path, 't'));
  const [emailOpen, setEmailOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<'meeting' | 'transcript' | null>(null);

  useEffect(() => setProcessing(q.data?.processing ?? null), [q.data]);
  useAppEvent((e) => {
    if (e.type === 'processing' && e.meetingId === id) {
      setProcessing(e.info);
      if (!e.info) q.reload();
    }
  });

  if (q.error) {
    return (
      <div className="page">
        <BackLink />
        <ErrorState message={q.error} onRetry={q.reload} />
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="page">
        <BackLink />
        <Skeleton lines={6} />
      </div>
    );
  }
  const d = q.data;
  const m = d.summary;
  const showEvidence = (e: Evidence) => {
    setHighlight(e.segmentIds[0] ?? null);
    setTab('transcript');
  };
  const analyzeAgain = async (mode?: 'basic' | 'claude') => {
    try {
      await call('meetings:analyze', id, mode);
      toast('Analyzing the meeting again…');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not start the analysis.', 'error');
    }
  };

  return (
    <div className="page">
      <BackLink />
      <header className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <TitleEditor id={id} title={m.title} />
          <span className="spacer" />
          {m.isSample && <span className="badge badge-accent">Sample</span>}
        </div>
        <p className="muted">
          {formatDate(m.startedAt)}
          {m.durationMs ? ` · ${formatDuration(m.durationMs)}` : ''} · {PLATFORM_LABELS[m.platform]}
          {d.notes &&
            ` · ${d.notes.engine.kind === 'claude' ? 'Analyzed with Claude' : 'Analyzed on this device'}`}
        </p>
      </header>

      {m.status === 'processing' || processing ? (
        <ProcessingPanel info={processing} />
      ) : m.status === 'interrupted' ? (
        <Notice
          tone="warning"
          action={
            <button className="btn btn-sm" onClick={() => void call('meetings:recover', id)}>
              Recover notes
            </button>
          }
        >
          This meeting was interrupted before it finished. The transcript captured so far is saved.
        </Notice>
      ) : m.status === 'failed' ? (
        <Notice
          tone="danger"
          action={
            <button className="btn btn-sm" onClick={() => void analyzeAgain()}>
              Try again
            </button>
          }
        >
          {d.processing?.error ??
            'Meeting processing failed. Your transcript is saved, so you can try again.'}
        </Notice>
      ) : null}

      {d.notes && d.notes.warnings.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {d.notes.warnings.map((w) => (
            <Notice key={w} tone="info">
              {w}
            </Notice>
          ))}
        </div>
      )}

      {(d.notes || d.segments.length > 0) && (
        <div className="tabs" role="tablist">
          <button
            className="tab"
            role="tab"
            aria-selected={tab === 'summary'}
            onClick={() => setTab('summary')}
          >
            Summary
          </button>
          <button
            className="tab"
            role="tab"
            aria-selected={tab === 'transcript'}
            onClick={() => setTab('transcript')}
          >
            Transcript{' '}
            {d.segments.length > 0 && <span className="muted">({d.segments.length})</span>}
          </button>
        </div>
      )}

      {tab === 'summary' && d.notes && (
        <Summary detail={d} onEvidence={showEvidence} onEmail={() => setEmailOpen(true)} />
      )}
      {tab === 'summary' && !d.notes && m.status === 'ready' && (
        <Empty title="No notes yet">Analyze the meeting to create notes.</Empty>
      )}
      {tab === 'transcript' && <Transcript detail={d} highlight={highlight} />}

      <section
        className="row"
        style={{ flexWrap: 'wrap', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}
      >
        {d.notes && (
          <button className="btn btn-sm" onClick={() => void analyzeAgain()}>
            <RefreshCw size={13} aria-hidden /> Analyze again
          </button>
        )}
        <span className="spacer" />
        {d.segments.length > 0 && (
          <button
            className="btn btn-sm btn-ghost btn-danger"
            onClick={() => setConfirmDelete('transcript')}
          >
            Delete transcript
          </button>
        )}
        <button
          className="btn btn-sm btn-ghost btn-danger"
          onClick={() => setConfirmDelete('meeting')}
        >
          <Trash2 size={13} aria-hidden /> Delete meeting
        </button>
      </section>

      {emailOpen && <EmailReview meetingId={id} onClose={() => setEmailOpen(false)} />}
      {confirmDelete && (
        <ConfirmDelete
          kind={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            if (confirmDelete === 'meeting') {
              await call('meetings:delete', id);
              toast('Meeting deleted.', 'success');
              window.location.hash = '/meetings';
            } else {
              await call('meetings:deleteTranscript', id);
              toast('Transcript and audio deleted. Your notes are kept.', 'success');
              setConfirmDelete(null);
              setTab('summary');
              q.reload();
            }
          }}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <a
      className="btn btn-ghost btn-sm"
      style={{ alignSelf: 'flex-start', marginLeft: -10 }}
      href="#/meetings"
    >
      <ArrowLeft size={14} aria-hidden /> Meetings
    </a>
  );
}

function TitleEditor({ id, title }: { id: string; title: string }) {
  const [value, setValue] = useState(title);
  useEffect(() => setValue(title), [title]);
  return (
    <>
      <label htmlFor="meeting-title" className="sr-only">
        Meeting name
      </label>
      <input
        id="meeting-title"
        className="live-title"
        style={{ fontSize: 26, fontWeight: 650 }}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() =>
          value.trim() && value.trim() !== title && void call('meetings:rename', id, value.trim())
        }
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </>
  );
}

const STAGES: { id: string; label: string }[] = [
  { id: 'preparing', label: 'Reading the transcript' },
  { id: 'analyzing', label: 'Finding decisions and action items' },
  { id: 'checking', label: 'Checking everything against the transcript' },
  { id: 'drafting', label: 'Writing the follow-up email' },
];

function ProcessingPanel({ info }: { info: ProcessingInfo | null }) {
  if (info?.stage === 'waiting-for-speech-engine') {
    return (
      <div className="stack">
        <Notice tone="accent">
          Your meeting audio is saved. It will be transcribed as soon as the speech engine is ready.
        </Notice>
        <ModelNotice compact />
      </div>
    );
  }
  if (info?.stage === 'transcribing')
    return (
      <div className="card card-body">
        <Spinner label="Transcribing the meeting audio…" />
      </div>
    );
  if (info?.stage === 'failed') return <Notice tone="danger">{info.error}</Notice>;
  const current = STAGES.findIndex((s) => s.id === info?.stage);
  return (
    <section className="card card-body stack" aria-live="polite" aria-busy="true">
      <h2>Preparing your notes</h2>
      <div className="stage-list">
        {STAGES.map((s, i) => (
          <div
            key={s.id}
            className={`stage ${i < current ? 'done' : i === current ? 'active' : ''}`}
          >
            {i < current ? (
              <Check size={16} aria-hidden />
            ) : i === current ? (
              <span className="spinner" aria-hidden />
            ) : (
              <span style={{ width: 16 }} />
            )}
            {s.label}
          </div>
        ))}
      </div>
    </section>
  );
}

function Summary({
  detail,
  onEvidence,
  onEmail,
}: {
  detail: Detail;
  onEvidence: (e: Evidence) => void;
  onEmail: () => void;
}) {
  const n = detail.notes!;
  const confirmed = n.decisions.filter((d) => d.status === 'confirmed');
  const other = n.decisions.filter((d) => d.status !== 'confirmed');
  const [showOther, setShowOther] = useState(false);
  return (
    <div className="stack" style={{ gap: 24 }}>
      <section className="section" aria-labelledby="tldr">
        <h2 id="tldr" className="section-title">
          TL;DR
        </h2>
        <p className="tldr">{n.tldr}</p>
      </section>

      <section className="section" aria-labelledby="decisions">
        <h2 id="decisions" className="section-title">
          Decisions
        </h2>
        <div className="card">
          {confirmed.length === 0 ? (
            <div className="card-body muted">No decisions were confirmed in this meeting.</div>
          ) : (
            <ul className="bullets" style={{ padding: '6px 0' }}>
              {confirmed.map((d) => (
                <li key={d.id}>
                  <div className="content">
                    {d.text} <WhyButton evidence={d.evidence} onShow={onEvidence} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {other.length > 0 && (
          <>
            <button
              className="btn btn-ghost btn-sm"
              style={{ alignSelf: 'flex-start', marginLeft: -10 }}
              aria-expanded={showOther}
              onClick={() => setShowOther((s) => !s)}
            >
              {showOther ? (
                <ChevronDown size={14} aria-hidden />
              ) : (
                <ChevronRight size={14} aria-hidden />
              )}{' '}
              Discussed but not decided ({other.length})
            </button>
            {showOther && (
              <ul className="bullets card" style={{ padding: '6px 0' }}>
                {other.map((d) => (
                  <li key={d.id}>
                    <div className="content muted">
                      {d.text} <WhyButton evidence={d.evidence} onShow={onEvidence} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <TasksSection meetingId={detail.summary.id} tasks={n.actionItems} onEvidence={onEvidence} />

      {n.openQuestions.length > 0 && (
        <section className="section" aria-labelledby="questions">
          <h2 id="questions" className="section-title">
            Open questions
          </h2>
          <ul className="bullets card" style={{ padding: '6px 0' }}>
            {n.openQuestions.map((q) => (
              <li key={q.id}>
                <div className="content">
                  {q.question} <WhyButton evidence={q.evidence} onShow={onEvidence} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {n.risks.length > 0 && (
        <section className="section" aria-labelledby="risks">
          <h2 id="risks" className="section-title">
            Risks and blockers
          </h2>
          <ul className="bullets card" style={{ padding: '6px 0' }}>
            {n.risks.map((r) => (
              <li key={r.id}>
                <div className="content">
                  {r.text} <WhyButton evidence={r.evidence} onShow={onEvidence} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.recurring && <Changes detail={detail} />}

      <section className="section" aria-labelledby="followup">
        <h2 id="followup" className="section-title">
          Follow-up
        </h2>
        <div className="card card-body row" style={{ gap: 14 }}>
          <Mail size={18} className="muted" aria-hidden />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{detail.email?.subject ?? 'Follow-up email'}</div>
            <div className="small muted">
              {detail.email?.status === 'opened_in_mail_app'
                ? 'Opened in your email app.'
                : detail.email?.status === 'mock_sent'
                  ? 'Saved to the test outbox (not sent).'
                  : detail.email?.to.length
                    ? `Ready to review, for ${detail.email.to.length} ${detail.email.to.length === 1 ? 'person' : 'people'}.`
                    : 'Ready to review. Add recipients before sending.'}
              {detail.email?.to.some((r) => r.external) && (
                <span className="badge badge-warning" style={{ marginLeft: 8 }}>
                  External recipients
                </span>
              )}
            </div>
          </div>
          <button className="btn btn-primary" onClick={onEmail} disabled={!detail.email}>
            Review email
          </button>
        </div>
      </section>

      {n.topics.length > 0 && (
        <section className="section" aria-labelledby="discussion">
          <h2 id="discussion" className="section-title">
            Discussion
          </h2>
          <div className="card">
            {n.topics.map((t, i) => (
              <div
                key={t.id}
                className="card-body"
                style={{ borderTop: i ? '1px solid var(--border)' : undefined }}
              >
                <div className="row">
                  <h3>{t.title}</h3>
                  <span className="muted small">{formatTimestamp(t.evidence.startMs)}</span>
                </div>
                <p className="muted" style={{ marginTop: 4 }}>
                  {t.summary}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TasksSection({
  meetingId,
  tasks,
  onEvidence,
}: {
  meetingId: string;
  tasks: TaskRow[];
  onEvidence: (e: Evidence) => void;
}) {
  const toast = useToast();
  const [adding, setAdding] = useState('');
  const save = async (t: TaskRow, patch: TaskPatchUi) => {
    try {
      await call('tasks:update', meetingId, t.id, patch);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save the task.', 'error');
    }
  };
  return (
    <section className="section" aria-labelledby="actions">
      <h2 id="actions" className="section-title">
        Action items
      </h2>
      <div className="card">
        {tasks.length === 0 ? (
          <div className="card-body muted">No action items were agreed in this meeting.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <span className="sr-only">Done</span>
                </th>
                <th>Task</th>
                <th style={{ width: 180 }}>Owner</th>
                <th style={{ width: 150 }}>Due</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <TaskRowView
                  key={t.id}
                  t={t}
                  onSave={(p) => void save(t, p)}
                  onEvidence={onEvidence}
                />
              ))}
            </tbody>
          </table>
        )}
        <form
          className="row"
          style={{ padding: '10px 20px', borderTop: '1px solid var(--border)' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!adding.trim()) return;
            void call('tasks:add', meetingId, adding.trim()).then(() => setAdding(''));
          }}
        >
          <label htmlFor={`add-${meetingId}`} className="sr-only">
            Add a task
          </label>
          <input
            id={`add-${meetingId}`}
            className="input"
            placeholder="Add a task"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          />
          <button className="btn" type="submit" disabled={!adding.trim()}>
            Add
          </button>
        </form>
      </div>
    </section>
  );
}

export type TaskPatchUi = {
  task?: string;
  owner?: string | null;
  deadlineDate?: string | null;
  status?: TaskRow['status'];
};

export function TaskRowView({
  t,
  onSave,
  onEvidence,
  showMeeting,
  showStatus,
}: {
  t: TaskRow;
  onSave: (p: TaskPatchUi) => void;
  onEvidence?: (e: Evidence) => void;
  showMeeting?: boolean;
  showStatus?: boolean;
}) {
  const [task, setTask] = useState(t.task);
  const [owner, setOwner] = useState(t.owner ?? '');
  useEffect(() => {
    setTask(t.task);
    setOwner(t.owner ?? '');
  }, [t.task, t.owner]);
  const done = t.status === 'completed';
  return (
    <tr className={done ? 'task-done' : undefined}>
      <td>
        <button
          className="check"
          role="checkbox"
          aria-checked={done}
          aria-label={done ? `Mark "${t.task}" as not done` : `Mark "${t.task}" as done`}
          onClick={() => onSave({ status: done ? 'open' : 'completed' })}
        >
          {done && <Check size={12} strokeWidth={3} aria-hidden />}
        </button>
      </td>
      <td>
        <input
          className="inline-edit task-text"
          aria-label="Task"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onBlur={() => task.trim() && task.trim() !== t.task && onSave({ task: task.trim() })}
        />
        <div className="row small" style={{ marginTop: 2, gap: 6, flexWrap: 'wrap' }}>
          {t.needsReview && <span className="badge badge-warning">Needs review</span>}
          {t.status === 'blocked' && <span className="badge badge-danger">Blocked</span>}
          {t.status === 'in_progress' && <span className="badge badge-accent">In progress</span>}
          {t.priority === 'high' && !done && <span className="badge">High priority</span>}
          {showMeeting && (
            <a className="muted" href={`#/meetings/${t.meetingId}`}>
              {t.meetingTitle}
            </a>
          )}
          {t.evidence.segmentIds.length > 0 && (
            <WhyButton evidence={t.evidence} onShow={onEvidence} />
          )}
        </div>
      </td>
      <td>
        <input
          className="inline-edit"
          aria-label="Owner"
          placeholder="Needs review"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          onBlur={() => owner.trim() !== (t.owner ?? '') && onSave({ owner: owner.trim() || null })}
        />
      </td>
      <td>
        <input
          type="date"
          className="inline-edit"
          aria-label="Due date"
          value={t.deadline?.date ?? ''}
          onChange={(e) => onSave({ deadlineDate: e.target.value || null })}
          style={{ color: t.overdue ? 'var(--danger)' : undefined }}
        />
        <div className="small muted" style={{ marginTop: 2 }}>
          {t.deadline
            ? t.overdue
              ? 'Overdue'
              : t.deadline.date
                ? t.deadline.approximate || t.deadline.needsReview
                  ? `Said “${t.deadline.phrase}”, please check`
                  : `“${t.deadline.phrase}”`
                : `Said “${t.deadline.phrase}”`
            : 'Not specified'}
        </div>
      </td>
      {showStatus && (
        <td>
          <select
            className="select"
            style={{ height: 30 }}
            value={t.status}
            onChange={(e) => onSave({ status: e.target.value as TaskRow['status'] })}
            aria-label={`Status of "${t.task}"`}
          >
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="blocked">Blocked</option>
            <option value="completed">Completed</option>
          </select>
        </td>
      )}
    </tr>
  );
}

function Changes({ detail }: { detail: Detail }) {
  const r = detail.recurring!;
  const diff = r.diff;
  const rows: [string, string[]][] = [
    ['Completed since last time', diff.completedTasks.map((t) => t.task)],
    [
      'Still open from last time',
      diff.outstandingTasks.map((t) => `${t.task}${t.owner ? ` (${t.owner})` : ''}`),
    ],
    [
      'Deadlines that changed',
      diff.changedDeadlines.map(
        (c) =>
          `${c.task.task}: ${c.before?.date ? formatDue(c.before.date) : 'none'} → ${c.after?.date ? formatDue(c.after.date) : 'none'}`,
      ),
    ],
    ['New tasks', diff.newTasks.map((t) => t.task)],
    ['New decisions', diff.newDecisions.map((d) => d.text)],
    ['Still unresolved', diff.stillOpen.map((q) => q.question)],
  ];
  const shown = rows.filter(([, items]) => items.length);
  if (!shown.length) return null;
  return (
    <section className="section" aria-labelledby="changes">
      <h2 id="changes" className="section-title">
        What changed since last time
      </h2>
      <div className="card card-body stack">
        <p className="small muted">
          Compared with{' '}
          <a href={`#/meetings/${r.previous.id}`}>{formatDate(r.previous.startedAt)}</a>.
        </p>
        {shown.map(([label, items]) => (
          <div key={label}>
            <h3 style={{ fontSize: 13 }}>{label}</h3>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {items.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Transcript({ detail, highlight }: { detail: Detail; highlight: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    if (highlight)
      ref.current
        ?.querySelector(`[data-seg="${CSS.escape(highlight)}"]`)
        ?.scrollIntoView({ block: 'center' });
  }, [highlight]);
  if (detail.segments.length === 0) {
    return (
      <Empty title="No transcript">
        {detail.notes
          ? 'The transcript for this meeting was deleted.'
          : 'Nothing was transcribed for this meeting.'}
      </Empty>
    );
  }
  const speakers = detail.speakers.filter((s) => s.segments > 0);
  const saveName = async (speakerId: string) => {
    try {
      await call('meetings:renameSpeaker', detail.summary.id, speakerId, name.trim() || null);
      toast('Speaker renamed. Updating the notes…', 'success');
      setEditing(null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not rename the speaker.', 'error');
    }
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card card-body stack" style={{ gap: 10 }} aria-labelledby="speakers">
        <div className="row">
          <Users size={16} className="muted" aria-hidden />
          <h2 id="speakers">Speakers</h2>
          <span className="small muted">
            Name a speaker to use their name in the notes. This only changes this meeting.
          </span>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {speakers.map((s) =>
            editing === s.speakerId ? (
              <form
                key={s.speakerId}
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveName(s.speakerId);
                }}
              >
                <label className="sr-only" htmlFor={`spk-${s.speakerId}`}>
                  Name for {s.label}
                </label>
                <input
                  id={`spk-${s.speakerId}`}
                  className="input"
                  style={{ width: 180, height: 30 }}
                  placeholder={s.label}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <button className="btn btn-sm btn-primary" type="submit">
                  Save
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  type="button"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                key={s.speakerId}
                className="chip"
                onClick={() => {
                  setEditing(s.speakerId);
                  setName(s.name ?? '');
                }}
              >
                {s.name ? `${s.label} → ${s.name}` : s.label}
                <span className="muted small">{s.segments}</span>
              </button>
            ),
          )}
        </div>
      </section>
      <div className="card" ref={ref}>
        {detail.segments.map((s) => (
          <div
            key={s.id}
            data-seg={s.id}
            className={`segment${s.id === highlight ? ' highlight' : ''}`}
          >
            <div className="ts">{formatTimestamp(s.startMs)}</div>
            <div>
              <div className="who">{s.speaker}</div>
              <div>{s.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfirmDelete({
  kind,
  onCancel,
  onConfirm,
}: {
  kind: 'meeting' | 'transcript';
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={kind === 'meeting' ? 'Delete this meeting?' : 'Delete the transcript?'}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-danger-solid"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(() => setBusy(false));
            }}
          >
            {kind === 'meeting' ? 'Delete meeting' : 'Delete transcript'}
          </button>
        </>
      }
    >
      <p>
        {kind === 'meeting'
          ? 'The notes, tasks, transcript, audio and email draft for this meeting will be permanently deleted from this computer.'
          : 'The transcript, audio and quoted evidence will be permanently deleted. The summary, decisions and tasks are kept.'}
      </p>
    </Modal>
  );
}
