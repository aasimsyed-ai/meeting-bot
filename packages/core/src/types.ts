/**
 * Core domain types. Everything the AI produces carries evidence pointing back
 * to transcript segments, and uncertainty is explicit (needsReview) instead of guessed.
 */

export type Platform = 'teams' | 'zoom' | 'meet' | 'slack' | 'other';

export const PLATFORM_LABELS: Record<Platform, string> = {
  teams: 'Microsoft Teams',
  zoom: 'Zoom',
  meet: 'Google Meet',
  slack: 'Slack Huddle',
  other: 'Other',
};

export type ParticipantRole = 'organizer' | 'required' | 'optional';

export interface Participant {
  name: string;
  email?: string | null;
  role?: ParticipantRole;
}

/** Where a transcript segment's audio came from. */
export type Channel = 'mic' | 'system' | 'import';

export interface TranscriptSegment {
  /** Stable id within the meeting, e.g. "s0012". */
  id: string;
  startMs: number;
  endMs: number;
  /** Raw speaker key from capture/diarization, e.g. "mic", "spk-2". */
  speakerId: string;
  /** Display label: a confirmed name, or "Speaker 2". Never an invented name. */
  speaker: string;
  text: string;
  channel?: Channel;
}

export interface MeetingContext {
  id: string;
  title: string;
  /** ISO 8601 start time, with offset. */
  startedAt: string;
  /** IANA time zone the meeting happened in (used for relative deadlines). */
  timeZone?: string;
  platform?: Platform;
  participants: Participant[];
  /** The person using the app (the note taker). */
  user: { name: string; email?: string | null };
}

/** Secondary evidence captured from the screen (OCR of keyframes). */
export interface ScreenNote {
  atMs: number;
  text: string;
  windowTitle?: string;
}

export type Confidence = 'high' | 'medium' | 'low';
export type Priority = 'high' | 'medium' | 'low';

export interface Evidence {
  segmentIds: string[];
  /** Start time of the first cited segment. */
  startMs: number;
  /** Verbatim text of the cited segments (trimmed), for the "Why?" view. */
  quote: string;
}

export interface Deadline {
  /** Exactly what was said, e.g. "by Friday". */
  phrase: string;
  /** Normalized calendar date YYYY-MM-DD, or null when it cannot be pinned down. */
  date: string | null;
  /** True when the phrase is vague ("next week") and the date is a best estimate. */
  approximate: boolean;
  needsReview: boolean;
}

export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'blocked';

export interface ActionItem {
  id: string;
  task: string;
  /** null means nobody was clearly assigned: shown as "Needs review". */
  owner: string | null;
  deadline: Deadline | null;
  priority: Priority;
  confidence: Confidence;
  needsReview: boolean;
  status: TaskStatus;
  evidence: Evidence;
}

export type DecisionStatus = 'confirmed' | 'possible' | 'discussion';

export interface Decision {
  id: string;
  text: string;
  status: DecisionStatus;
  evidence: Evidence;
}

export interface Topic {
  id: string;
  title: string;
  summary: string;
  evidence: Evidence;
}

export interface OpenQuestion {
  id: string;
  question: string;
  evidence: Evidence;
}

export interface Risk {
  id: string;
  text: string;
  evidence: Evidence;
}

/** Which engine produced the notes. Only 'claude' needs a paid account, and it is optional. */
export type EngineKind = 'rules' | 'mock' | 'local-llm' | 'claude';

export interface EngineInfo {
  kind: EngineKind;
  model?: string;
  promptVersion: string;
}

export interface MeetingNotes {
  tldr: string;
  topics: Topic[];
  decisions: Decision[];
  actionItems: ActionItem[];
  openQuestions: OpenQuestion[];
  risks: Risk[];
  engine: EngineInfo;
  generatedAt: string;
  /** Plain-language notes about quality, e.g. "The transcript is very short." */
  warnings: string[];
}

export interface EmailRecipient {
  name: string;
  email: string;
  role: ParticipantRole;
  external: boolean;
}

export interface EmailDraft {
  subject: string;
  body: string;
  to: EmailRecipient[];
  warnings: string[];
}
