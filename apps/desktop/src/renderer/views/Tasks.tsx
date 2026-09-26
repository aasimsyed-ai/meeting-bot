import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { ApiError, call } from '../api';
import { useApp } from '../App';
import { useQuery } from '../lib/hooks';
import { Empty, ErrorState, Skeleton, useToast } from '../components/ui';
import { TaskRowView, type TaskPatchUi } from './MeetingDetail';
import type { TaskFilter, TaskRow } from '../../shared/types';

const STATUSES: { id: TaskFilter['status']; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'completed', label: 'Completed' },
];

export function Tasks() {
  const { settings } = useApp();
  const toast = useToast();
  const [scope, setScope] = useState<TaskFilter['scope']>(settings.profile.name ? 'mine' : 'all');
  const [status, setStatus] = useState<TaskFilter['status']>('open');
  const q = useQuery(
    () => call('tasks:list', { scope, status }),
    [scope, status],
    ['tasks-changed', 'meetings-changed'],
  );

  const save = async (t: TaskRow, patch: TaskPatchUi) => {
    try {
      await call('tasks:update', t.meetingId, t.id, patch);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save the task.', 'error');
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Tasks</h1>
          <p className="sub">
            Action items from your meetings. Edit anything that is not quite right.
          </p>
        </div>
        <div className="row" role="group" aria-label="Whose tasks">
          <button
            className="chip"
            aria-pressed={scope === 'mine'}
            onClick={() => setScope('mine')}
            disabled={!settings.profile.name}
          >
            Mine
          </button>
          <button className="chip" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            Everyone
          </button>
        </div>
      </header>
      {!settings.profile.name && scope === 'all' && (
        <p className="small muted">Add your name in Settings to see the tasks assigned to you.</p>
      )}
      <div className="tabs" role="tablist" aria-label="Task status">
        {STATUSES.map((s) => (
          <button
            key={s.id}
            role="tab"
            className="tab"
            aria-selected={status === s.id}
            onClick={() => setStatus(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {q.error && <ErrorState message={q.error} onRetry={q.reload} />}
      <section className="card">
        {q.loading && !q.data ? (
          <div className="card-body">
            <Skeleton lines={4} />
          </div>
        ) : (q.data ?? []).length === 0 ? (
          <Empty
            icon={<CheckCircle2 size={22} aria-hidden />}
            title={
              status === 'completed'
                ? 'Nothing completed yet'
                : status === 'overdue'
                  ? 'Nothing overdue'
                  : 'No tasks here'
            }
          >
            {status === 'open' ? 'Tasks from your meetings will show up here.' : undefined}
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <span className="sr-only">Done</span>
                </th>
                <th>Task</th>
                <th style={{ width: 160 }}>Owner</th>
                <th style={{ width: 150 }}>Due</th>
                <th style={{ width: 150 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((t) => (
                <TaskRowView
                  key={`${t.meetingId}-${t.id}`}
                  t={t}
                  onSave={(p) => void save(t, p)}
                  showMeeting
                  showStatus
                />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
