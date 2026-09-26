import { useState } from 'react';
import { ArrowRight, CheckCircle2, Mic, Sparkles } from 'lucide-react';
import { PLATFORM_LABELS, type Platform } from '@meeting-assistant/core/ui';
import { call, ApiError } from '../api';
import { lastStatusAt, useApp } from '../App';
import { navigate } from '../lib/router';
import { formatDate, formatDue, formatDuration, formatElapsed, greeting } from '../lib/format';
import { useQuery, useTicker } from '../lib/hooks';
import { Empty, LevelMeter, Notice, Skeleton, useToast } from '../components/ui';
import { ModelNotice } from './shared';
import type {
  CaptureProblem,
  CaptureStatus,
  ChannelHealth,
  ScreenHealth,
} from '../../shared/types';
import { captureHeadline } from '../../shared/capture-label';

const PLATFORMS: Platform[] = ['teams', 'zoom', 'meet', 'slack', 'other'];

export function Home() {
  const { capture } = useApp();
  if (capture.state !== 'idle') return <LiveMeeting />;
  return <Idle />;
}

function Idle() {
  const { settings, detected, setCapture, info } = useApp();
  const toast = useToast();
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [starting, setStarting] = useState(false);
  const meetings = useQuery(() => call('meetings:list'), [], ['meetings-changed']);
  const tasks = useQuery(
    () => call('tasks:list', { scope: 'mine', status: 'open' }),
    [],
    ['tasks-changed', 'meetings-changed'],
  );

  const start = async (
    opts: { platform?: Platform; title?: string; source?: 'live' | 'demo' } = {},
  ) => {
    setStarting(true);
    try {
      setCapture(await call('capture:start', opts));
    } catch (e) {
      toast(
        e instanceof ApiError ? e.message : 'Could not start taking notes. Please try again.',
        'error',
      );
    } finally {
      setStarting(false);
    }
  };

  const recent = (meetings.data ?? []).slice(0, 4);
  const interrupted = (meetings.data ?? []).filter((m) => m.status === 'interrupted');
  const processing = (meetings.data ?? []).filter((m) => m.status === 'processing');

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{greeting(settings.profile.name)}</h1>
          <p className="sub">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
      </header>

      {info.hasSampleData && (
        <div className="sample-banner">
          <Sparkles size={14} aria-hidden /> You are looking at sample meetings from Acme Demo
          Corporation. Remove them any time in Settings.
        </div>
      )}

      {interrupted.map((m) => (
        <Notice
          key={m.id}
          tone="warning"
          action={
            <button
              className="btn btn-sm"
              onClick={() =>
                void call('meetings:recover', m.id).then(() => navigate(`/meetings/${m.id}`))
              }
            >
              Recover notes
            </button>
          }
        >
          “{m.title}” was interrupted before it finished. What was captured is saved.
        </Notice>
      ))}

      {detected && (
        <div className="card">
          <div className="card-body row" style={{ gap: 14 }}>
            <span className="rec-dot paused" style={{ background: 'var(--success)' }} aria-hidden />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {PLATFORM_LABELS[detected.platform]} meeting detected
              </div>
              <div className="muted small">{detected.title || detected.windowTitle}</div>
            </div>
            <button
              className="btn btn-primary"
              disabled={starting}
              onClick={() =>
                void start({ platform: detected.platform, title: detected.title || undefined })
              }
            >
              Take notes <ArrowRight size={14} aria-hidden />
            </button>
          </div>
        </div>
      )}

      <section className="card hero" aria-labelledby="start-heading">
        <div className="stack" style={{ gap: 6 }}>
          <h2 id="start-heading" style={{ fontSize: 18 }}>
            Ready when your meeting is
          </h2>
          <p className="muted">
            Works with Teams, Zoom, Google Meet, Slack huddles and any other meeting app. Join your
            meeting, then start.
          </p>
        </div>
        <button
          className="btn btn-primary btn-lg"
          disabled={starting}
          onClick={() => void start(platform ? { platform } : {})}
        >
          <Mic size={18} aria-hidden />
          {starting ? 'Starting…' : 'Start taking notes'}
        </button>
        <div className="stack" style={{ gap: 8 }}>
          <span className="small muted" id="platform-label">
            Meeting app (optional)
          </span>
          <div className="platforms" role="group" aria-labelledby="platform-label">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                className="chip"
                aria-pressed={platform === p}
                onClick={() => setPlatform(platform === p ? null : p)}
              >
                {PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginLeft: -10 }}
          onClick={() => void start({ source: 'demo' })}
        >
          <Sparkles size={14} aria-hidden /> Try a sample meeting (no microphone needed)
        </button>
      </section>

      <ModelNotice />

      {processing.map((m) => (
        <Notice
          key={m.id}
          tone="accent"
          action={
            <a className="btn btn-sm" href={`#/meetings/${m.id}`}>
              View
            </a>
          }
        >
          Preparing notes for “{m.title}”…
        </Notice>
      ))}

      <div className="grid-2">
        <section className="card" aria-labelledby="recent-heading">
          <div className="card-header">
            <h2 id="recent-heading">Recent meetings</h2>
            <a className="btn btn-ghost btn-sm" href="#/meetings">
              See all
            </a>
          </div>
          <div className="list" style={{ marginTop: 8 }}>
            {meetings.loading && !meetings.data ? (
              <div className="card-body">
                <Skeleton />
              </div>
            ) : recent.length === 0 ? (
              <Empty title="No meetings yet">
                Your notes will appear here after your first meeting.
              </Empty>
            ) : (
              recent.map((m) => (
                <a key={m.id} className="list-item" href={`#/meetings/${m.id}`}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="title">{m.title}</div>
                    <div className="meta">
                      {formatDate(m.startedAt)}
                      {m.durationMs ? ` · ${formatDuration(m.durationMs)}` : ''}
                    </div>
                  </div>
                  {m.isSample && <span className="badge badge-accent">Sample</span>}
                  {m.status === 'processing' && <span className="badge">Preparing</span>}
                  {m.status === 'failed' && (
                    <span className="badge badge-danger">Needs attention</span>
                  )}
                </a>
              ))
            )}
          </div>
        </section>

        <section className="card" aria-labelledby="tasks-heading">
          <div className="card-header">
            <h2 id="tasks-heading">My open tasks</h2>
            <a className="btn btn-ghost btn-sm" href="#/tasks">
              See all
            </a>
          </div>
          <div className="list" style={{ marginTop: 8 }}>
            {tasks.loading && !tasks.data ? (
              <div className="card-body">
                <Skeleton />
              </div>
            ) : (tasks.data ?? []).length === 0 ? (
              <Empty icon={<CheckCircle2 size={20} aria-hidden />} title="Nothing on your plate">
                Tasks assigned to you in meetings show up here.
              </Empty>
            ) : (
              (tasks.data ?? []).slice(0, 5).map((t) => (
                <a
                  key={`${t.meetingId}-${t.id}`}
                  className="list-item"
                  href={`#/meetings/${t.meetingId}`}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="title">{t.task}</div>
                    <div className="meta">{t.meetingTitle}</div>
                  </div>
                  {t.deadline?.date && (
                    <span className={`badge ${t.overdue ? 'badge-danger' : ''}`}>
                      {t.overdue ? 'Overdue' : formatDue(t.deadline.date)}
                    </span>
                  )}
                </a>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function channelState(c: ChannelHealth, demo: boolean): string {
  if (demo) return 'Simulated';
  if (!c.enabled) return c.problem ? 'Not available' : 'Off';
  if (c.receiving) return 'Listening';
  return c.problem ? 'No audio' : 'Waiting for audio…';
}

const SCREEN_STATE: Record<ScreenHealth['state'], string> = {
  off: 'Off',
  looking: 'Looking for the meeting window',
  reading: 'Reading slides',
  denied: 'Needs permission',
  unavailable: 'Not available',
};

function screenState(s: ScreenHealth, demo: boolean): string {
  if (demo) return 'Simulated';
  if (s.state === 'reading' && s.keyframes > 0) return `Reading slides (${s.keyframes} saved)`;
  return SCREEN_STATE[s.state];
}

/** Problems a "Try again" can fix without stopping the meeting. */
const RETRYABLE = new Set<CaptureProblem['code']>([
  'mic_denied',
  'mic_lost',
  'mic_muted',
  'system_audio_unavailable',
  'system_audio_lost',
]);

function problemAction(
  p: CaptureProblem,
  handlers: { resume: () => void; retry: () => void; stop: () => void },
) {
  const retry = RETRYABLE.has(p.code) ? (
    <button className="btn btn-sm" onClick={handlers.retry}>
      Try again
    </button>
  ) : null;
  if (!p.action) return retry ?? undefined;
  const run = () => {
    switch (p.action!.kind) {
      case 'open_mic_settings':
        return void call('permissions:openSettings', 'microphone');
      case 'open_screen_settings':
        return void call('permissions:openSettings', 'screen');
      case 'open_audio_settings':
        return void call('permissions:openSettings', 'systemAudio');
      case 'download_models':
        return void call('models:download');
      case 'resume':
        return handlers.resume();
      case 'retry_audio':
        return handlers.retry();
      case 'stop':
        return handlers.stop();
    }
  };
  return (
    <span className="row" style={{ gap: 6 }}>
      <button className="btn btn-sm" onClick={run}>
        {p.action.label}
      </button>
      {retry}
    </span>
  );
}

export function LiveMeeting() {
  const { capture, setCapture } = useApp();
  const toast = useToast();
  const [showTranscript, setShowTranscript] = useState(true);
  const [title, setTitle] = useState(capture.title);
  useTicker(1000, capture.state === 'capturing');
  const elapsed =
    capture.elapsedMs + (capture.state === 'capturing' ? Date.now() - lastStatusAt(capture) : 0);
  const paused = capture.state === 'paused';
  const demo = capture.source === 'demo';
  const mac = navigator.userAgent.includes('Mac');
  const headline = demo ? { text: 'Taking notes', tone: 'rec' } : captureHeadline(capture);

  const act = async (fn: () => Promise<CaptureStatus>) => {
    try {
      setCapture(await fn());
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That did not work. Please try again.', 'error');
    }
  };
  const stop = async () => {
    const s = await call('capture:stop');
    setCapture(s);
    if (s.meetingId) navigate(`/meetings/${s.meetingId}`);
  };
  const saveTitle = () => {
    if (capture.meetingId && title.trim() && title.trim() !== capture.title)
      void call('meetings:rename', capture.meetingId, title.trim());
  };

  return (
    <div className="page">
      {demo && (
        <div className="sample-banner">
          <Sparkles size={14} aria-hidden /> Sample meeting: a recorded conversation is played
          through the app. Nothing is being recorded.
        </div>
      )}
      <section className="card live" aria-labelledby="live-title">
        <div className="live-header">
          <span className={`rec-dot ${headline.tone}`} aria-hidden />
          <div className="live-state" aria-live="polite">
            {headline.text}
          </div>
          <span className="spacer" />
          <span className="badge">
            {capture.platform === 'other'
              ? 'Any meeting app'
              : capture.platform === 'meet'
                ? 'Google Meet'
                : capture.platform[0]!.toUpperCase() + capture.platform.slice(1)}
          </span>
        </div>
        <label className="sr-only" htmlFor="live-title">
          Meeting name
        </label>
        <input
          id="live-title"
          className="live-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="row" style={{ gap: 16 }}>
          <div className="live-timer" aria-label={`Elapsed ${formatElapsed(elapsed)}`}>
            {formatElapsed(elapsed)}
          </div>
          <span className="spacer" />
          <button
            className="btn btn-lg"
            disabled={capture.state === 'stopping'}
            onClick={() => void act(() => call(paused ? 'capture:resume' : 'capture:pause'))}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            className="btn btn-lg btn-danger-solid"
            disabled={capture.state === 'stopping'}
            onClick={() => void stop()}
          >
            Stop
          </button>
        </div>
        <div className="meters">
          <LevelMeter
            label="You"
            level={demo ? 0.3 : capture.mic.level}
            state={channelState(capture.mic, demo)}
          />
          <LevelMeter
            label="Meeting audio"
            level={demo ? 0.5 : capture.system.level}
            state={channelState(capture.system, demo)}
          />
          <div className="meter">
            <div className="row small">
              <span style={{ fontWeight: 600 }}>Screen</span>
              <span className="spacer" />
              <span className="muted">{screenState(capture.screen, demo)}</span>
            </div>
            <div className="small muted">Text on slides only, never video.</div>
          </div>
        </div>
        {capture.hearing === 'none' && !demo && capture.state === 'capturing' && (
          <Notice tone="warning">
            No audio is coming in, so nothing is being written down right now. Check the notices
            below, or stop and start again.
          </Notice>
        )}
        {capture.problems.map((p) => (
          <Notice
            key={p.code}
            tone={p.code === 'silence' || p.code === 'models_missing' ? 'info' : 'warning'}
            action={problemAction(p, {
              resume: () => void act(() => call('capture:resume')),
              retry: () => void act(() => call('capture:retryAudio')),
              stop: () => void stop(),
            })}
          >
            {p.message}
          </Notice>
        ))}
        <div className="stack" style={{ gap: 8 }}>
          <div className="row">
            <h3>Live transcript</h3>
            <span className="muted small">{capture.segmentsCount} lines</span>
            <span className="spacer" />
            <button
              className="btn btn-ghost btn-sm"
              aria-expanded={showTranscript}
              onClick={() => setShowTranscript((s) => !s)}
            >
              {showTranscript ? 'Hide' : 'Show'}
            </button>
          </div>
          {showTranscript && (
            <div className="transcript-live" aria-live="polite">
              {capture.lastLines.length === 0 ? (
                <span className="muted">
                  Words will appear here a few seconds after people speak.
                </span>
              ) : (
                capture.lastLines.map((l, i) => (
                  <div key={`${l.startMs}-${i}`}>
                    <strong>{l.speaker}:</strong> {l.text}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <p className="small muted">
          Shortcuts: <span className="kbd">{mac ? '⌘⇧,' : 'Ctrl+Shift+,'}</span> pause,{' '}
          <span className="kbd">{mac ? '⌘⇧.' : 'Ctrl+Shift+.'}</span> stop. You can close this
          window; notes keep going and you can stop from the {mac ? 'menu bar' : 'tray'} icon.
        </p>
      </section>
    </div>
  );
}
