import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, call } from '../api';
import { useApp } from '../App';
import { Modal, Notice, Switch, useToast } from '../components/ui';
import { ModelNotice } from './shared';
import type { ModelId, PermissionStatus, Settings } from '../../shared/types';

function Section({
  title,
  children,
  description,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="section" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      {description && <p className="small muted">{description}</p>}
      <div className="card">{children}</div>
    </section>
  );
}

function Row({
  title,
  hint,
  children,
  htmlFor,
}: {
  title: string;
  hint?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="setting-row">
      <div className="text">
        {htmlFor ? (
          <label htmlFor={htmlFor} style={{ fontWeight: 550 }}>
            {title}
          </label>
        ) : (
          <div style={{ fontWeight: 550 }}>{title}</div>
        )}
        {hint && <div className="hint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

const MODELS: { id: ModelId; label: string; hint: string }[] = [
  {
    id: 'moonshine-base-en',
    label: 'Standard (English)',
    hint: 'Best accuracy for English. 280 MB.',
  },
  {
    id: 'moonshine-tiny-en',
    label: 'Fast (English)',
    hint: 'Smaller download for older computers. 135 MB.',
  },
  {
    id: 'parakeet-v3',
    label: 'Multilingual',
    hint: 'English and 24 other European languages. 515 MB.',
  },
];

export function SettingsView() {
  const { settings, updateSettings, info, refreshInfo } = useApp();
  const toast = useToast();
  const [name, setName] = useState(settings.profile.name);
  const [email, setEmail] = useState(settings.profile.email);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [perms, setPerms] = useState<PermissionStatus | null>(null);
  const [key, setKey] = useState('');
  const [localUrl, setLocalUrl] = useState(settings.ai.localUrl);
  const [localModel, setLocalModel] = useState(settings.ai.localModel);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call('permissions:get').then(setPerms);
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) =>
        setMics(
          d.filter(
            (x) =>
              x.kind === 'audioinput' &&
              x.deviceId !== 'default' &&
              x.deviceId !== 'communications',
          ),
        ),
      )
      .catch(() => setMics([]));
  }, []);

  const save = async (patch: Parameters<typeof updateSettings>[0], message?: string) => {
    try {
      await updateSettings(patch);
      if (message) toast(message, 'success');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save that setting.', 'error');
    }
  };

  const saveKey = async (value: string | null) => {
    const r = await call('settings:setClaudeKey', value);
    toast(r.message, r.stored || value === null ? 'success' : 'warning');
    if (r.stored) setKey('');
    refreshInfo();
    await updateSettings({});
  };

  const privacy = settings.privacy;
  return (
    <div className="page page-narrow">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="sub">
            Everything stays on this computer unless you choose Claude for analysis.
          </p>
        </div>
      </header>

      <Section title="You">
        <Row
          title="Name"
          hint="Used to find your tasks and to sign follow-up emails."
          htmlFor="name"
        >
          <input
            id="name"
            className="input"
            style={{ width: 240 }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() =>
              name !== settings.profile.name && void save({ profile: { name } }, 'Name saved.')
            }
          />
        </Row>
        <Row
          title="Work email"
          hint="Used to spot recipients outside your organization."
          htmlFor="email"
        >
          <input
            id="email"
            className="input"
            style={{ width: 240 }}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() =>
              email !== settings.profile.email && void save({ profile: { email } }, 'Email saved.')
            }
          />
        </Row>
      </Section>

      <Section title="Capture">
        <Row
          title="Notice meetings"
          hint="Suggests taking notes when a Teams, Zoom, Meet or Slack call is open. It never starts on its own."
        >
          <Switch
            label="Notice meetings"
            checked={settings.capture.detectMeetings}
            onChange={(v) => void save({ capture: { detectMeetings: v } })}
          />
        </Row>
        <Row
          title="Meeting audio"
          hint="Hear the other people in the meeting, not just your microphone."
        >
          <Switch
            label="Meeting audio"
            checked={settings.capture.systemAudio}
            onChange={(v) => void save({ capture: { systemAudio: v } })}
          />
        </Row>
        <Row
          title="Read slides"
          hint="Reads the text on slides and shared screens in the meeting window, on this computer. Only the text is kept, never pictures or video."
        >
          <Switch
            label="Read slides"
            checked={settings.capture.screenContext}
            onChange={(v) => void save({ capture: { screenContext: v } })}
          />
        </Row>
        <Row title="Microphone" htmlFor="mic">
          <select
            id="mic"
            className="select"
            style={{ width: 240 }}
            value={settings.capture.micDeviceId ?? ''}
            onChange={(e) => void save({ capture: { micDeviceId: e.target.value || null } })}
          >
            <option value="">System default</option>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label || 'Microphone'}
              </option>
            ))}
          </select>
        </Row>
        {perms &&
          (['microphone', 'systemAudio', 'screen'] as const)
            .filter((k) => perms.help[k])
            .map((k) => (
              <div key={k} className="setting-row">
                <Notice
                  tone="warning"
                  action={
                    <button
                      className="btn btn-sm"
                      onClick={() => void call('permissions:openSettings', k)}
                    >
                      Open settings
                    </button>
                  }
                >
                  {perms.help[k]}
                </Notice>
              </div>
            ))}
      </Section>

      <Section
        title="Transcription"
        description="Speech is turned into text on this computer. Nothing is uploaded."
      >
        <Row title="Speech engine" htmlFor="model">
          <select
            id="model"
            className="select"
            style={{ width: 240 }}
            value={settings.transcription.model}
            onChange={(e) => void save({ transcription: { model: e.target.value as ModelId } })}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Row>
        <div className="setting-row">
          <div className="text hint">
            {MODELS.find((m) => m.id === settings.transcription.model)?.hint}
          </div>
        </div>
        <div className="setting-row" style={{ display: 'block' }}>
          <ModelNotice compact />
        </div>
      </Section>

      <Section title="Notes" description="How meetings are turned into notes.">
        <Row
          title="On this computer"
          hint="Private and free. Good at clear decisions and commitments; may miss subtle ones."
        >
          <input
            type="radio"
            name="ai"
            aria-label="Analyze on this computer"
            checked={settings.ai.mode === 'basic'}
            onChange={() => void save({ ai: { mode: 'basic' } })}
          />
        </Row>
        <Row
          title="Local AI server (free)"
          hint="Uses a language model running on this computer, such as Ollama or LM Studio. Nothing leaves your computer. If the server is not running, notes are made with the offline engine."
        >
          <input
            type="radio"
            name="ai"
            aria-label="Analyze with a local AI server"
            disabled={!settings.ai.localModel}
            checked={settings.ai.mode === 'local'}
            onChange={() => void save({ ai: { mode: 'local' } })}
          />
        </Row>
        <div className="setting-row">
          <form
            className="row"
            style={{ flex: 1, flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              void save(
                { ai: { localUrl: localUrl.trim(), localModel: localModel.trim() } },
                'Local AI settings saved.',
              );
            }}
          >
            <label htmlFor="local-url" className="sr-only">
              Local AI server address
            </label>
            <input
              id="local-url"
              className="input"
              style={{ flex: 2, minWidth: 220 }}
              placeholder="http://localhost:11434/v1"
              value={localUrl}
              onChange={(e) => setLocalUrl(e.target.value)}
            />
            <label htmlFor="local-model" className="sr-only">
              Local AI model name
            </label>
            <input
              id="local-model"
              className="input"
              style={{ flex: 1, minWidth: 160 }}
              placeholder="Model, e.g. qwen2.5:7b-instruct"
              value={localModel}
              onChange={(e) => setLocalModel(e.target.value)}
            />
            <button
              className="btn"
              type="submit"
              disabled={!/^https?:\/\/\S+$/.test(localUrl.trim()) || !localModel.trim()}
            >
              Save
            </button>
          </form>
        </div>
        <Row
          title="Claude (optional, your own key)"
          hint={
            settings.ai.hasClaudeKey
              ? 'The transcript is sent to Anthropic for analysis. If Claude is unavailable, notes are made on this computer.'
              : 'Optional and not needed for any feature. Needs your own paid Claude API key; the transcript is sent to Anthropic for analysis.'
          }
        >
          <input
            type="radio"
            name="ai"
            aria-label="Analyze with Claude"
            disabled={!settings.ai.hasClaudeKey}
            checked={settings.ai.mode === 'claude'}
            onChange={() => void save({ ai: { mode: 'claude' } })}
          />
        </Row>
        <div className="setting-row">
          <form
            className="row"
            style={{ flex: 1 }}
            onSubmit={(e) => {
              e.preventDefault();
              void saveKey(key);
            }}
          >
            <label htmlFor="claude-key" className="sr-only">
              Claude API key
            </label>
            <input
              id="claude-key"
              className="input"
              type="password"
              autoComplete="off"
              placeholder={settings.ai.hasClaudeKey ? 'Key saved' : 'Claude API key (sk-ant-…)'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button className="btn" type="submit" disabled={!key.trim()}>
              Save key
            </button>
            {settings.ai.hasClaudeKey && (
              <button
                className="btn btn-ghost btn-danger"
                type="button"
                onClick={() => void saveKey(null).then(() => save({ ai: { mode: 'basic' } }))}
              >
                Remove
              </button>
            )}
          </form>
        </div>
        {!info.secureStorage && (
          <div className="setting-row">
            <span className="hint">
              This computer has no secure keychain, so a saved key lasts only until you quit the
              app.
            </span>
          </div>
        )}
      </Section>

      <Section title="Privacy">
        <Row
          title="Delete audio after notes are ready"
          hint="Keeps only the transcript and notes. Recommended."
        >
          <Switch
            label="Delete audio after notes are ready"
            checked={privacy.deleteAudioAfterProcessing}
            onChange={(v) => void save({ privacy: { deleteAudioAfterProcessing: v } })}
          />
        </Row>
        <Row
          title="Keep meetings"
          htmlFor="retention"
          hint="Older meetings are deleted automatically."
        >
          <select
            id="retention"
            className="select"
            style={{ width: 160 }}
            value={privacy.keepMeetingsDays}
            onChange={(e) =>
              void save({
                privacy: {
                  keepMeetingsDays: Number(
                    e.target.value,
                  ) as Settings['privacy']['keepMeetingsDays'],
                },
              })
            }
          >
            <option value={0}>Forever</option>
            <option value={365}>1 year</option>
            <option value={90}>90 days</option>
            <option value={30}>30 days</option>
          </select>
        </Row>
        <Row title="Sample meetings" hint="Acme Demo Corporation meetings to explore the app.">
          {info.hasSampleData ? (
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void call('data:removeSamples').then(() => {
                  refreshInfo();
                  void updateSettings({});
                  toast('Sample meetings removed.', 'success');
                })
              }
            >
              Remove samples
            </button>
          ) : (
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void call('data:loadSamples')
                  .then(() => {
                    refreshInfo();
                    void updateSettings({});
                    toast('Sample meetings added.', 'success');
                  })
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? 'Adding…' : 'Add samples'}
            </button>
          )}
        </Row>
        <Row
          title="Delete all meeting data"
          hint="Meetings, transcripts, notes, tasks, audio and email drafts. This cannot be undone."
        >
          <button className="btn btn-danger" onClick={() => setConfirmAll(true)}>
            Delete everything
          </button>
        </Row>
      </Section>

      <Section title="General">
        <Row title="Notifications" hint="For meetings detected and summaries ready.">
          <Switch
            label="Notifications"
            checked={settings.notifications}
            onChange={(v) => void save({ notifications: v })}
          />
        </Row>
        <Row title="Appearance" htmlFor="theme">
          <select
            id="theme"
            className="select"
            style={{ width: 160 }}
            value={settings.appearance}
            onChange={(e) => void save({ appearance: e.target.value as Settings['appearance'] })}
          >
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Row>
        <Row
          title="Email"
          hint={
            info.emailMode === 'mock'
              ? 'Test mode: emails go to a local test outbox and are never sent.'
              : 'Follow-up emails open in your own email app, where you review and send them.'
          }
        />
        <Row title="Version" hint={`Meeting Assistant ${info.version}`}>
          <button
            className="btn"
            onClick={() => void call('app:checkUpdates').then((r) => toast(r.message))}
          >
            Check for updates
          </button>
        </Row>
        <Row
          title="Help with a problem"
          hint="The log file has technical details. It never contains what was said in meetings."
        >
          <button className="btn" onClick={() => void call('app:showLogs')}>
            Show log file
          </button>
        </Row>
      </Section>

      {confirmAll && <DeleteAll onClose={() => setConfirmAll(false)} />}
    </div>
  );
}

function DeleteAll({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const toast = useToast();
  const { refreshInfo } = useApp();
  return (
    <Modal
      title="Delete all meeting data?"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-danger-solid"
            disabled={text !== 'DELETE'}
            onClick={() =>
              void call('data:deleteAll', 'DELETE').then(() => {
                toast('All meeting data was deleted.', 'success');
                refreshInfo();
                onClose();
              })
            }
          >
            Delete everything
          </button>
        </>
      }
    >
      <p>
        Every meeting, transcript, note, task, audio file and email draft on this computer will be
        permanently deleted. Your settings are kept.
      </p>
      <div className="field">
        <label htmlFor="confirm-delete">Type DELETE to confirm</label>
        <input
          id="confirm-delete"
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
        />
      </div>
    </Modal>
  );
}
