import { useEffect, useRef, useState } from 'react';
import { MessageCircleQuestion, Search as SearchIcon } from 'lucide-react';
import type { AnswerItem } from '@meeting-assistant/core/ui';
import { call } from '../api';
import { navigate, queryParam } from '../lib/router';
import { formatDate, formatDue, formatTimestamp } from '../lib/format';
import { Empty, ErrorState, Snippet, Spinner } from '../components/ui';
import type { SearchResult } from '../../shared/types';

const EXAMPLES = [
  'What did we decide about deployment?',
  'What tasks were assigned to me?',
  'What is still unresolved?',
  'firewall',
];

const KIND_LABEL: Record<string, string> = {
  segment: 'Transcript',
  decision: 'Decision',
  action: 'Task',
  topic: 'Topic',
  question: 'Open question',
  risk: 'Risk',
  title: 'Meeting',
};

export function Search({ path }: { path: string }) {
  const initial = queryParam(path, 'q') ?? '';
  const [text, setText] = useState(initial);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const run = async (q: string) => {
    const query = q.trim();
    if (!query) {
      setResult(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await call('search:query', query));
    } catch {
      setError('Search did not work this time. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    input.current?.focus();
    if (initial) void run(initial);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (q: string) => {
    setText(q);
    navigate(`/search?q=${encodeURIComponent(q)}`);
    void run(q);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Search</h1>
          <p className="sub">Find anything that was said, or ask a question about your meetings.</p>
        </div>
      </header>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <div className="search-box">
          <SearchIcon size={18} className="muted" aria-hidden />
          <label htmlFor="search-input" className="sr-only">
            Search or ask a question
          </label>
          <input
            id="search-input"
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search or ask, e.g. What did we decide about deployment?"
            autoComplete="off"
          />
          {busy && <Spinner />}
        </div>
      </form>

      {!result && !busy && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => submit(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}

      {error && <ErrorState message={error} />}

      {result?.answer && (
        <section className="card" aria-labelledby="answer-heading">
          <div className="card-header">
            <div className="row">
              <MessageCircleQuestion size={16} className="muted" aria-hidden />
              <h2 id="answer-heading">{result.answer.text}</h2>
            </div>
          </div>
          <div className="list" style={{ marginTop: 8 }}>
            {result.answer.items.length === 0 ? (
              <div className="card-body muted small">
                Answers only come from your saved meetings. Nothing is guessed.
              </div>
            ) : (
              result.answer.items.map((item, i) => <AnswerRow key={i} item={item} />)
            )}
          </div>
        </section>
      )}

      {result && (
        <section className="stack" aria-labelledby="results-heading">
          <h2 id="results-heading" className="section-title">
            {result.hits.length
              ? `${result.hits.length} ${result.hits.length === 1 ? 'match' : 'matches'}`
              : 'Matches'}
          </h2>
          <div className="card">
            {result.hits.length === 0 ? (
              <Empty title="No matches">Try fewer or different words.</Empty>
            ) : (
              <div className="list">
                {result.hits.map((h, i) => (
                  <a
                    key={i}
                    className="list-item"
                    href={`#/meetings/${h.meetingId}${h.kind === 'segment' ? '' : ''}`}
                    style={{ alignItems: 'flex-start' }}
                  >
                    <span className="badge" style={{ marginTop: 2 }}>
                      {KIND_LABEL[h.kind] ?? h.kind}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div>
                        <Snippet text={h.snippet} />
                      </div>
                      <div className="meta">
                        {h.meetingTitle} · {formatDate(h.startedAt)}
                        {h.startMs !== null ? ` · ${formatTimestamp(h.startMs)}` : ''}
                      </div>
                    </div>
                    {h.isSample && <span className="badge badge-accent">Sample</span>}
                  </a>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function AnswerRow({ item }: { item: AnswerItem }) {
  const target =
    item.kind === 'segment' && item.segmentIds[0]
      ? `#/meetings/${item.meetingId}?t=${item.segmentIds[0]}`
      : `#/meetings/${item.meetingId}`;
  return (
    <a className="list-item" href={target} style={{ alignItems: 'flex-start' }}>
      <span className="badge badge-accent" style={{ marginTop: 2 }}>
        {KIND_LABEL[item.kind === 'action' ? 'action' : item.kind] ?? item.kind}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="title">{item.text}</div>
        <div className="meta">
          {item.owner ? `${item.owner} · ` : item.kind === 'action' ? 'Owner needs review · ' : ''}
          {item.deadline
            ? `Due ${/^\d{4}-/.test(item.deadline) ? formatDue(item.deadline) : item.deadline} · `
            : ''}
          Source: {item.meetingTitle}, {item.date} at {formatTimestamp(item.startMs)}
          {item.status === 'completed' ? ' · Done' : ''}
        </div>
      </div>
    </a>
  );
}
