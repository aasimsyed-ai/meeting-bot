import { useMemo, useState } from 'react';
import { ListVideo, Sparkles } from 'lucide-react';
import { PLATFORM_LABELS } from '@meeting-assistant/core/ui';
import { call } from '../api';
import { useApp } from '../App';
import { formatDate, formatDuration } from '../lib/format';
import { useQuery } from '../lib/hooks';
import { Empty, ErrorState, Skeleton } from '../components/ui';
import type { MeetingSummary } from '../../shared/types';

function statusBadge(m: MeetingSummary) {
  if (m.status === 'capturing' || m.status === 'paused')
    return <span className="badge badge-danger">● Taking notes</span>;
  if (m.status === 'processing') return <span className="badge">Preparing notes</span>;
  if (m.status === 'failed') return <span className="badge badge-danger">Needs attention</span>;
  if (m.status === 'interrupted') return <span className="badge badge-warning">Interrupted</span>;
  return null;
}

export function Meetings() {
  const { info, refreshInfo } = useApp();
  const q = useQuery(() => call('meetings:list'), [], ['meetings-changed']);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (q.data ?? []).filter((m) => !f || m.title.toLowerCase().includes(f));
  }, [q.data, filter]);

  const loadSamples = async () => {
    setLoading(true);
    await call('data:loadSamples').finally(() => setLoading(false));
    refreshInfo();
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Meetings</h1>
          <p className="sub">Every meeting you took notes in, newest first.</p>
        </div>
        {(q.data?.length ?? 0) > 5 && (
          <input
            className="input"
            style={{ width: 240 }}
            placeholder="Filter by name"
            aria-label="Filter meetings by name"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
      </header>
      {q.error && <ErrorState message={q.error} onRetry={q.reload} />}
      <section className="card">
        {q.loading && !q.data ? (
          <div className="card-body">
            <Skeleton lines={5} />
          </div>
        ) : shown.length === 0 && !filter ? (
          <Empty
            icon={<ListVideo size={22} aria-hidden />}
            title="No meetings yet"
            action={
              !info.hasSampleData && (
                <button className="btn" disabled={loading} onClick={() => void loadSamples()}>
                  <Sparkles size={14} aria-hidden />{' '}
                  {loading ? 'Loading…' : 'Explore sample meetings'}
                </button>
              )
            }
          >
            Start taking notes from Home when your next meeting begins.
          </Empty>
        ) : shown.length === 0 ? (
          <Empty title="No meetings match that name" />
        ) : (
          <div className="list">
            {shown.map((m) => (
              <a key={m.id} className="list-item" href={`#/meetings/${m.id}`}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="title">{m.title}</div>
                  <div className="meta">
                    {formatDate(m.startedAt)}
                    {m.durationMs ? ` · ${formatDuration(m.durationMs)}` : ''} ·{' '}
                    {PLATFORM_LABELS[m.platform]}
                  </div>
                </div>
                {m.isSample && <span className="badge badge-accent">Sample</span>}
                {statusBadge(m)}
                {m.status === 'ready' && m.openTasks > 0 && (
                  <span className="badge">
                    {m.openTasks} open {m.openTasks === 1 ? 'task' : 'tasks'}
                  </span>
                )}
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
