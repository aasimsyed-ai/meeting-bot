import type {
  ActionItem,
  Answer,
  EmailRecipient,
  MeetingNotes,
  Participant,
  Platform,
  RecurringDiff,
  ScreenNote,
  TaskStatus,
  TranscriptSegment,
} from '@meeting-assistant/core';

export type AppEnv = 'development' | 'test' | 'production';

export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  osVersion: string;
  env: AppEnv;
  emailMode: 'mailapp' | 'mock';
  dataDir: string;
  hasSampleData: boolean;
  claudeAvailable: boolean;
  secureStorage: boolean;
}

// ---------------------------------------------------------------- Settings

/** basic: offline engine (default). local: a free local model server. claude: optional, own key. */
export type AiMode = 'basic' | 'local' | 'claude';
export type ModelId = 'moonshine-base-en' | 'moonshine-tiny-en' | 'parakeet-v3';

export interface Settings {
  profile: { name: string; email: string };
  onboardingComplete: boolean;
  capture: {
    detectMeetings: boolean;
    screenContext: boolean;
    systemAudio: boolean;
    micDeviceId: string | null;
  };
  transcription: { model: ModelId };
  ai: { mode: AiMode; hasClaudeKey: boolean; localUrl: string; localModel: string };
  privacy: { deleteAudioAfterProcessing: boolean; keepMeetingsDays: 0 | 30 | 90 | 365 };
  notifications: boolean;
  appearance: 'system' | 'light' | 'dark';
}

export type SettingsPatch = {
  profile?: Partial<Settings['profile']>;
  onboardingComplete?: boolean;
  capture?: Partial<Settings['capture']>;
  transcription?: Partial<Settings['transcription']>;
  ai?: { mode?: AiMode; localUrl?: string; localModel?: string };
  privacy?: Partial<Settings['privacy']>;
  notifications?: boolean;
  appearance?: Settings['appearance'];
};

// ---------------------------------------------------------------- Permissions

export type PermissionState =
  'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown' | 'unsupported';

export interface PermissionStatus {
  microphone: PermissionState;
  screen: PermissionState;
  systemAudio: PermissionState;
  /** Plain-language guidance per permission when something is missing. */
  help: Partial<Record<'microphone' | 'screen' | 'systemAudio', string>>;
}

export type PermissionKind = 'microphone' | 'screen' | 'systemAudio';

// ---------------------------------------------------------------- Speech models

export interface ModelStatus {
  model: ModelId;
  ready: boolean;
  downloading: boolean;
  /** 0..1 */
  progress: number;
  totalBytes: number;
  error: string | null;
}

// ---------------------------------------------------------------- Capture

export type CaptureState = 'idle' | 'starting' | 'capturing' | 'paused' | 'stopping';
export type CaptureSource = 'live' | 'demo';

export interface ChannelHealth {
  enabled: boolean;
  receiving: boolean;
  /** 0..1 smoothed level for the meter */
  level: number;
  problem: string | null;
}

export type ProblemCode =
  | 'mic_denied'
  | 'mic_lost'
  | 'system_audio_unavailable'
  | 'system_audio_lost'
  | 'silence'
  | 'screen_denied'
  | 'models_missing'
  | 'transcriber_failed'
  | 'asleep'
  | 'mic_muted'
  | 'meeting_ended';

export interface CaptureProblem {
  code: ProblemCode;
  message: string;
  action?: {
    label: string;
    kind:
      | 'open_mic_settings'
      | 'open_screen_settings'
      | 'open_audio_settings'
      | 'download_models'
      | 'resume'
      | 'retry_audio'
      | 'stop';
  };
}

export type Hearing = 'ok' | 'partial' | 'none' | 'starting';

export interface ScreenHealth {
  enabled: boolean;
  /**
   * off: turned off in Settings. looking: no meeting window found yet. reading: watching the
   * meeting window for new slides. denied: no screen permission. unavailable: cannot read here.
   */
  state: 'off' | 'looking' | 'reading' | 'denied' | 'unavailable';
  /** Slides or screens whose text was saved. */
  keyframes: number;
}

export interface CaptureStatus {
  state: CaptureState;
  source: CaptureSource;
  meetingId: string | null;
  title: string;
  platform: Platform;
  startedAt: string | null;
  elapsedMs: number;
  mic: ChannelHealth;
  system: ChannelHealth;
  /**
   * Whether audio is actually arriving: 'ok' all sources, 'partial' at least one,
   * 'none' nothing (the app must not claim to be taking notes), 'starting' first seconds.
   */
  hearing: Hearing;
  screen: ScreenHealth;
  segmentsCount: number;
  lastLines: { speaker: string; text: string; startMs: number }[];
  problems: CaptureProblem[];
}

export interface StartCaptureOptions {
  platform?: Platform;
  title?: string;
  source?: CaptureSource;
}

export interface DetectedMeeting {
  platform: Platform;
  title: string;
  windowTitle: string;
}

// ---------------------------------------------------------------- Meetings

export type MeetingStatus =
  'capturing' | 'paused' | 'processing' | 'ready' | 'failed' | 'interrupted';

export interface MeetingSummary {
  id: string;
  title: string;
  platform: Platform;
  status: MeetingStatus;
  startedAt: string;
  durationMs: number;
  isSample: boolean;
  tldr: string | null;
  openTasks: number;
  decisions: number;
}

export interface SpeakerRow {
  speakerId: string;
  label: string;
  name: string | null;
  segments: number;
}

export interface TaskRow extends ActionItem {
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  overdue: boolean;
  edited: boolean;
  isSample: boolean;
}

export type EmailStatus = 'draft' | 'opened_in_mail_app' | 'mock_sent' | 'sent';

export interface EmailDraftRow {
  subject: string;
  body: string;
  to: EmailRecipient[];
  warnings: string[];
  status: EmailStatus;
  updatedAt: string;
}

export interface ProcessingInfo {
  stage: string;
  label: string;
  error: string | null;
  retryable: boolean;
}

export interface MeetingDetail {
  summary: MeetingSummary;
  timeZone: string | null;
  participants: Participant[];
  notes: (MeetingNotes & { actionItems: TaskRow[] }) | null;
  segments: TranscriptSegment[];
  speakers: SpeakerRow[];
  email: EmailDraftRow | null;
  processing: ProcessingInfo | null;
  recurring: {
    previous: { id: string; title: string; startedAt: string };
    diff: RecurringDiff;
  } | null;
  /** Text read from slides or shared screens, in meeting order. */
  screen: ScreenNote[];
  hasAudio: boolean;
}

export interface TaskPatch {
  task?: string;
  owner?: string | null;
  deadlineDate?: string | null;
  status?: TaskStatus;
}

export type TaskFilter = {
  scope: 'mine' | 'all';
  status: 'open' | 'in_progress' | 'blocked' | 'completed' | 'overdue' | 'all';
};

// ---------------------------------------------------------------- Search

export interface SearchHit {
  meetingId: string;
  meetingTitle: string;
  startedAt: string;
  kind: 'segment' | 'decision' | 'action' | 'topic' | 'question' | 'risk' | 'title';
  /** Snippet with \u0001 and \u0002 marking highlighted terms. Plain text only. */
  snippet: string;
  startMs: number | null;
  isSample: boolean;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  answer: Answer | null;
}

// ---------------------------------------------------------------- Email

export interface EmailResult {
  status: EmailStatus;
  message: string;
  bodyCopied?: boolean;
}

// ---------------------------------------------------------------- Events

export type AppEvent =
  | { type: 'capture'; status: CaptureStatus }
  | { type: 'processing'; meetingId: string; info: ProcessingInfo | null }
  | { type: 'meetings-changed' }
  | { type: 'tasks-changed' }
  | { type: 'detected-meeting'; meeting: DetectedMeeting | null }
  | { type: 'model'; status: ModelStatus }
  | { type: 'navigate'; to: string }
  | { type: 'notice'; tone: 'info' | 'success' | 'warning' | 'error'; message: string }
  | { type: 'update'; state: 'available' | 'downloaded'; version: string };
