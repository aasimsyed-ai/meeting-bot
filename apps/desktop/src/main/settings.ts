import type { Repo } from './db/repo';
import type { SecretStore } from './secrets';
import type { Settings, SettingsPatch } from '../shared/types';

export const DEFAULT_SETTINGS: Omit<Settings, 'ai'> & { ai: { mode: Settings['ai']['mode'] } } = {
  profile: { name: '', email: '' },
  onboardingComplete: false,
  capture: { detectMeetings: true, screenContext: false, systemAudio: true, micDeviceId: null },
  transcription: { model: 'moonshine-base-en' },
  ai: { mode: 'basic' },
  privacy: { deleteAudioAfterProcessing: true, keepMeetingsDays: 0 },
  notifications: true,
  appearance: 'system',
};

type Stored = typeof DEFAULT_SETTINGS;

/** Minimal settings stored as one JSON document; secrets live in SecretStore. */
export class SettingsService {
  private cache: Stored | null = null;
  private readonly listeners = new Set<(s: Settings) => void>();

  constructor(
    private readonly repo: Repo,
    private readonly secrets: SecretStore,
    private readonly envClaudeKey: string | null,
  ) {}

  private load(): Stored {
    if (this.cache) return this.cache;
    let parsed: Partial<Stored> = {};
    try {
      parsed = JSON.parse(this.repo.getSetting('settings') ?? '{}') as Partial<Stored>;
    } catch {
      parsed = {};
    }
    this.cache = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      profile: { ...DEFAULT_SETTINGS.profile, ...parsed.profile },
      capture: { ...DEFAULT_SETTINGS.capture, ...parsed.capture },
      transcription: { ...DEFAULT_SETTINGS.transcription, ...parsed.transcription },
      ai: { ...DEFAULT_SETTINGS.ai, ...parsed.ai },
      privacy: { ...DEFAULT_SETTINGS.privacy, ...parsed.privacy },
    };
    return this.cache;
  }

  claudeKey(): string | null {
    return this.secrets.get('claude-api-key') ?? this.envClaudeKey;
  }

  get(): Settings {
    const s = this.load();
    return { ...s, ai: { mode: s.ai.mode, hasClaudeKey: Boolean(this.claudeKey()) } };
  }

  update(patch: SettingsPatch): Settings {
    const s = this.load();
    const next: Stored = {
      ...s,
      ...(patch.onboardingComplete !== undefined
        ? { onboardingComplete: patch.onboardingComplete }
        : {}),
      ...(patch.notifications !== undefined ? { notifications: patch.notifications } : {}),
      ...(patch.appearance !== undefined ? { appearance: patch.appearance } : {}),
      profile: { ...s.profile, ...patch.profile },
      capture: { ...s.capture, ...patch.capture },
      transcription: { ...s.transcription, ...patch.transcription },
      ai: { ...s.ai, ...patch.ai },
      privacy: { ...s.privacy, ...patch.privacy },
    };
    next.profile.name = next.profile.name.trim();
    next.profile.email = next.profile.email.trim().toLowerCase();
    this.repo.setSetting('settings', JSON.stringify(next));
    this.cache = next;
    const out = this.get();
    for (const l of this.listeners) l(out);
    return out;
  }

  onChange(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
