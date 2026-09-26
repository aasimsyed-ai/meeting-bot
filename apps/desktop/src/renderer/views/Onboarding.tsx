import { useEffect, useState } from 'react';
import { Check, Download, Lock, Mic, Monitor, Sparkles, Volume2 } from 'lucide-react';
import { call } from '../api';
import { useApp } from '../App';
import { useToast } from '../components/ui';
import { mb } from './shared';
import type { PermissionKind, PermissionState, PermissionStatus } from '../../shared/types';

type Step = 'welcome' | 'about' | 'permissions' | 'engine' | 'ready';
const ORDER: Step[] = ['welcome', 'about', 'permissions', 'engine', 'ready'];

export function Onboarding() {
  const { settings, updateSettings, model, refreshInfo } = useApp();
  const toast = useToast();
  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState(settings.profile.name);
  const [email, setEmail] = useState(settings.profile.email);
  const [perms, setPerms] = useState<PermissionStatus | null>(null);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const idx = ORDER.indexOf(step);
  const mac = navigator.userAgent.includes('Mac');

  useEffect(() => {
    if (step === 'permissions') void call('permissions:get').then(setPerms);
  }, [step]);

  const finish = async () => updateSettings({ onboardingComplete: true });
  const trySamples = async () => {
    setLoadingSamples(true);
    try {
      await call('data:loadSamples');
      refreshInfo();
      await finish();
      toast(
        'Sample meetings added. They are clearly marked and you can remove them in Settings.',
        'success',
      );
    } finally {
      setLoadingSamples(false);
    }
  };

  const request = async (kind: PermissionKind) => setPerms(await call('permissions:request', kind));

  return (
    <div className="onboarding">
      <div className="card onboarding-card">
        <div className="steps" aria-label={`Step ${idx + 1} of ${ORDER.length}`}>
          {ORDER.map((s, i) => (
            <span key={s} className={i <= idx ? 'done' : ''} />
          ))}
        </div>

        {step === 'welcome' && (
          <>
            <div className="stack" style={{ gap: 10 }}>
              <h1>Meeting notes, done for you</h1>
              <p className="muted" style={{ fontSize: 15 }}>
                Meeting Assistant listens to your meetings and gives you a clear summary, the
                decisions made, who is doing what by when, and a follow-up email ready to send.
              </p>
            </div>
            <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 10 }}>
              <li className="row">
                <Check size={16} color="var(--success)" aria-hidden /> Works with Teams, Zoom,
                Google Meet, Slack and any other meeting app
              </li>
              <li className="row">
                <Lock size={16} color="var(--success)" aria-hidden /> Private by default: speech is
                transcribed on this computer
              </li>
              <li className="row">
                <Check size={16} color="var(--success)" aria-hidden /> You are always in control: it
                only listens when you say so, and shows it clearly
              </li>
            </ul>
            <div className="row">
              <button className="btn btn-primary btn-lg" onClick={() => setStep('about')}>
                Get started
              </button>
              <button
                className="btn btn-ghost"
                disabled={loadingSamples}
                onClick={() => void trySamples()}
              >
                <Sparkles size={14} aria-hidden />{' '}
                {loadingSamples ? 'Loading samples…' : 'Explore with sample meetings'}
              </button>
            </div>
          </>
        )}

        {step === 'about' && (
          <form
            className="stack"
            style={{ gap: 18 }}
            onSubmit={(e) => {
              e.preventDefault();
              void updateSettings({ profile: { name, email } }).then(() => setStep('permissions'));
            }}
          >
            <div className="stack" style={{ gap: 6 }}>
              <h1>What should we call you?</h1>
              <p className="muted">
                This stays on this computer. It helps find the tasks that are yours and signs your
                follow-up emails.
              </p>
            </div>
            <div className="field">
              <label htmlFor="ob-name">Your name</label>
              <input
                id="ob-name"
                className="input"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Morgan"
              />
            </div>
            <div className="field">
              <label htmlFor="ob-email">Work email (optional)</label>
              <input
                id="ob-email"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@company.com"
              />
              <span className="hint">
                Used to warn you before emailing people outside your organization.
              </span>
            </div>
            <div className="row">
              <button className="btn btn-primary" type="submit">
                Continue
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setStep('permissions')}
              >
                Skip
              </button>
            </div>
          </form>
        )}

        {step === 'permissions' && (
          <>
            <div className="stack" style={{ gap: 6 }}>
              <h1>Let it hear your meetings</h1>
              <p className="muted">
                Your {mac ? 'Mac' : 'computer'} will ask once. You can change this any time.
              </p>
            </div>
            <div>
              <Perm
                icon={<Mic size={16} aria-hidden />}
                title="Microphone"
                why="To capture what you say."
                state={perms?.microphone}
                help={perms?.help.microphone}
                onAllow={() => void request('microphone')}
                onOpen={() => void call('permissions:openSettings', 'microphone')}
              />
              <Perm
                icon={<Volume2 size={16} aria-hidden />}
                title="Meeting audio"
                why="To hear the other people in the meeting."
                state={perms?.systemAudio}
                help={perms?.help.systemAudio}
                onAllow={() => void request('systemAudio')}
                onOpen={() => void call('permissions:openSettings', 'systemAudio')}
              />
              {mac && (
                <Perm
                  icon={<Monitor size={16} aria-hidden />}
                  title="Screen (optional)"
                  why="To notice which meeting you are in and read the text on shared slides."
                  state={perms?.screen}
                  help={perms?.help.screen}
                  onAllow={() => void request('screen')}
                  onOpen={() => void call('permissions:openSettings', 'screen')}
                />
              )}
            </div>
            <div className="row">
              <button className="btn btn-primary" onClick={() => setStep('engine')}>
                Continue
              </button>
              <span className="small muted">
                Missing something? You can still continue and fix it later in Settings.
              </span>
            </div>
          </>
        )}

        {step === 'engine' && (
          <>
            <div className="stack" style={{ gap: 6 }}>
              <h1>Download the speech engine</h1>
              <p className="muted">
                To turn speech into text privately on this computer, Meeting Assistant needs a
                one-time download ({mb(model.totalBytes)}).
              </p>
            </div>
            {model.ready ? (
              <div className="notice notice-success">
                <Check size={16} aria-hidden /> The speech engine is ready.
              </div>
            ) : model.downloading ? (
              <div className="stack" style={{ gap: 8 }}>
                <div
                  className="progress"
                  role="progressbar"
                  aria-label="Download progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(model.progress * 100)}
                >
                  <div style={{ width: `${model.progress * 100}%` }} />
                </div>
                <span className="small muted">
                  {Math.round(model.progress * 100)}%. You can continue; it keeps downloading in the
                  background.
                </span>
              </div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {model.error && <div className="notice notice-warning">{model.error}</div>}
                <button
                  className="btn"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => void call('models:download')}
                >
                  <Download size={14} aria-hidden /> {model.error ? 'Try again' : 'Download now'}
                </button>
              </div>
            )}
            <div className="row">
              <button className="btn btn-primary" onClick={() => setStep('ready')}>
                {model.ready || model.downloading ? 'Continue' : 'Later'}
              </button>
            </div>
          </>
        )}

        {step === 'ready' && (
          <>
            <div className="stack" style={{ gap: 6 }}>
              <h1>You are ready</h1>
              <p className="muted" style={{ fontSize: 15 }}>
                When a meeting starts, open Meeting Assistant and press{' '}
                <strong>Start taking notes</strong>. When it ends, press <strong>Stop</strong>. Your
                notes are ready a moment later.
              </p>
              <p className="small muted">
                Let people know when you are taking notes. In some places, everyone in a
                conversation has to agree before it is recorded.
              </p>
            </div>
            <div className="row">
              <button className="btn btn-primary btn-lg" onClick={() => void finish()}>
                Open Meeting Assistant
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Perm({
  icon,
  title,
  why,
  state,
  help,
  onAllow,
  onOpen,
}: {
  icon: React.ReactNode;
  title: string;
  why: string;
  state?: PermissionState;
  help?: string;
  onAllow: () => void;
  onOpen: () => void;
}) {
  const granted = state === 'granted';
  return (
    <div className="perm">
      <span className="icon">{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div className="small muted">{why}</div>
        {help && !granted && (
          <div className="small" style={{ marginTop: 6, color: 'var(--warning)' }}>
            {help}
          </div>
        )}
      </div>
      {granted ? (
        <span className="badge badge-success">
          <Check size={12} aria-hidden /> Allowed
        </span>
      ) : state === 'denied' || state === 'restricted' ? (
        <button className="btn btn-sm" onClick={onOpen}>
          Fix in Settings
        </button>
      ) : state === 'unsupported' ? (
        <span className="badge">Not available</span>
      ) : (
        <button className="btn btn-sm" onClick={onAllow}>
          Allow
        </button>
      )}
    </div>
  );
}
