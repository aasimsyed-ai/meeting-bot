import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  CheckSquare,
  Home as HomeIcon,
  ListVideo,
  Pause,
  Play,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Square,
} from 'lucide-react';
import { call, platform } from './api';
import { match, navigate, useRoute } from './lib/router';
import { formatElapsed } from './lib/format';
import { useAppEvent, useTicker } from './lib/hooks';
import { ToastProvider, useToast } from './components/ui';
import { Home } from './views/Home';
import { Meetings } from './views/Meetings';
import { MeetingDetail } from './views/MeetingDetail';
import { Tasks } from './views/Tasks';
import { Search } from './views/Search';
import { SettingsView } from './views/Settings';
import { Onboarding } from './views/Onboarding';
import type {
  AppInfo,
  CaptureStatus,
  DetectedMeeting,
  ModelStatus,
  Settings,
  SettingsPatch,
} from '../shared/types';

interface AppState {
  info: AppInfo;
  settings: Settings;
  capture: CaptureStatus;
  detected: DetectedMeeting | null;
  model: ModelStatus;
  updateSettings: (patch: SettingsPatch) => Promise<Settings>;
  refreshInfo: () => void;
  setCapture: (s: CaptureStatus) => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('App state not ready');
  return ctx;
}

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const toast = useToast();
  const [info, setInfo] = useState<AppInfo>();
  const [settings, setSettings] = useState<Settings>();
  const [capture, setCapture] = useState<CaptureStatus>();
  const [detected, setDetected] = useState<DetectedMeeting | null>(null);
  const [model, setModel] = useState<ModelStatus>();
  const [failed, setFailed] = useState<string | null>(null);

  const refreshInfo = useCallback(() => void call('app:info').then(setInfo), []);

  useEffect(() => {
    Promise.all([
      call('app:info'),
      call('settings:get'),
      call('capture:status'),
      call('detection:current'),
      call('models:status'),
    ]).then(
      ([i, s, c, d, m]) => {
        setInfo(i);
        setSettings(s);
        setCapture(c);
        setDetected(d);
        setModel(m);
      },
      () => setFailed('Meeting Assistant could not start properly. Please restart the app.'),
    );
  }, []);

  useAppEvent((e) => {
    if (e.type === 'capture') setCapture(e.status);
    else if (e.type === 'detected-meeting') setDetected(e.meeting);
    else if (e.type === 'model') setModel(e.status);
    else if (e.type === 'navigate') navigate(e.to);
    else if (e.type === 'notice') toast(e.message, e.tone);
    else if (e.type === 'update')
      toast(
        e.state === 'downloaded'
          ? `Version ${e.version} is ready. It installs when you quit.`
          : `Version ${e.version} is available and downloading.`,
        'info',
      );
    else if (e.type === 'meetings-changed') refreshInfo();
  });

  // Theme follows the setting, or the system when set to "system".
  useEffect(() => {
    if (!settings) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark =
        settings.appearance === 'dark' || (settings.appearance === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings]);

  const updateSettings = useCallback(async (patch: SettingsPatch) => {
    const s = await call('settings:update', patch);
    setSettings(s);
    return s;
  }, []);

  if (failed)
    return (
      <div className="onboarding">
        <p>{failed}</p>
      </div>
    );
  if (!info || !settings || !capture || !model)
    return <div className="onboarding" aria-busy="true" />;

  const state: AppState = {
    info,
    settings,
    capture,
    detected,
    model,
    updateSettings,
    refreshInfo,
    setCapture,
  };
  return (
    <AppContext.Provider value={state}>
      {settings.onboardingComplete ? <Layout /> : <Onboarding />}
    </AppContext.Provider>
  );
}

const NAV = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/meetings', label: 'Meetings', icon: ListVideo },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/search', label: 'Search', icon: SearchIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

function Layout() {
  const path = useRoute();
  const { capture } = useApp();
  const active = (to: string) =>
    to === '/'
      ? path === '/'
      : path === to || path.startsWith(`${to}/`) || path.startsWith(`${to}?`);

  let page;
  const meeting = match(path, '/meetings/:id');
  if (meeting) page = <MeetingDetail id={meeting.id!} path={path} />;
  else if (active('/meetings')) page = <Meetings />;
  else if (active('/tasks')) page = <Tasks />;
  else if (active('/search')) page = <Search path={path} />;
  else if (active('/settings')) page = <SettingsView />;
  else page = <Home />;

  return (
    <div className={`app platform-${platform()}`}>
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            >
              <path d="M5 7h14M5 12h10M5 17h7" />
            </svg>
          </span>
          Meeting Assistant
        </div>
        {NAV.map(({ to, label, icon: Icon }) => (
          <a
            key={to}
            href={`#${to}`}
            className="nav-item"
            aria-current={active(to) ? 'page' : undefined}
          >
            <Icon size={16} aria-hidden />
            {label}
          </a>
        ))}
        <div className="sidebar-footer">{capture.state !== 'idle' && <CapturePill />}</div>
      </nav>
      <main className="main" id="main">
        {page}
      </main>
    </div>
  );
}

/** Always visible while notes are being taken, on every page. */
function CapturePill() {
  const { capture, setCapture } = useApp();
  const toast = useToast();
  useTicker(1000, capture.state === 'capturing');
  const elapsed =
    capture.elapsedMs + (capture.state === 'capturing' ? Date.now() - lastStatusAt(capture) : 0);
  const paused = capture.state === 'paused';
  const stop = async () => {
    const s = await call('capture:stop');
    setCapture(s);
    if (s.meetingId) navigate(`/meetings/${s.meetingId}`);
    toast('Notes stopped. Preparing your summary…', 'info');
  };
  return (
    <div className="capture-pill" aria-live="polite">
      <div className="status">
        <span className={`rec-dot${paused ? ' paused' : ''}`} aria-hidden />
        {capture.state === 'stopping' ? 'Finishing…' : paused ? 'Paused' : 'Taking notes'}
        <span className="time">{formatElapsed(elapsed)}</span>
      </div>
      <div className="row">
        <button
          className="btn btn-sm"
          style={{ flex: 1 }}
          onClick={() => void call(paused ? 'capture:resume' : 'capture:pause').then(setCapture)}
          disabled={capture.state === 'stopping'}
        >
          {paused ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          className="btn btn-sm btn-danger"
          style={{ flex: 1 }}
          onClick={() => void stop()}
          disabled={capture.state === 'stopping'}
        >
          <Square size={12} aria-hidden />
          Stop
        </button>
      </div>
    </div>
  );
}

/** Capture status carries elapsed time at the moment it was sent; keep the clock moving between updates. */
const statusTimes = new WeakMap<CaptureStatus, number>();
export function lastStatusAt(s: CaptureStatus): number {
  let t = statusTimes.get(s);
  if (t === undefined) {
    t = Date.now();
    statusTimes.set(s, t);
  }
  return t;
}
