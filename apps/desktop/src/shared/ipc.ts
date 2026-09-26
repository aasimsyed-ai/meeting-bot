import { z } from 'zod';
import type { Answer } from '@meeting-assistant/core';
import type {
  AppInfo,
  CaptureStatus,
  DetectedMeeting,
  EmailDraftRow,
  EmailResult,
  MeetingDetail,
  MeetingSummary,
  ModelStatus,
  PermissionStatus,
  SearchResult,
  Settings,
  TaskRow,
} from './types';

/**
 * Every call from the UI goes through one of these channels. Arguments are
 * validated in the main process with these schemas before anything runs.
 */
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const platform = z.enum(['teams', 'zoom', 'meet', 'slack', 'other']);
const text = (max: number) => z.string().max(max);
const permission = z.enum(['microphone', 'screen', 'systemAudio']);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const settingsPatch = z
  .object({
    profile: z
      .object({ name: text(120), email: text(254) })
      .partial()
      .strict(),
    onboardingComplete: z.boolean(),
    capture: z
      .object({
        detectMeetings: z.boolean(),
        screenContext: z.boolean(),
        systemAudio: z.boolean(),
        micDeviceId: text(300).nullable(),
      })
      .partial()
      .strict(),
    transcription: z
      .object({ model: z.enum(['moonshine-base-en', 'moonshine-tiny-en', 'parakeet-v3']) })
      .partial()
      .strict(),
    ai: z
      .object({
        mode: z.enum(['basic', 'local', 'claude']),
        localUrl: z
          .string()
          .max(300)
          .regex(/^https?:\/\/[^\s]+$/),
        localModel: text(200),
      })
      .partial()
      .strict(),
    privacy: z
      .object({
        deleteAudioAfterProcessing: z.boolean(),
        keepMeetingsDays: z.union([z.literal(0), z.literal(30), z.literal(90), z.literal(365)]),
      })
      .partial()
      .strict(),
    notifications: z.boolean(),
    appearance: z.enum(['system', 'light', 'dark']),
  })
  .partial()
  .strict();

const participant = z
  .object({
    name: text(120).min(1),
    email: text(254).nullable().optional(),
    role: z.enum(['organizer', 'required', 'optional']).optional(),
  })
  .strict();

export const IPC_SCHEMAS = {
  'app:info': z.tuple([]),
  'app:showLogs': z.tuple([]),
  'app:checkUpdates': z.tuple([]),
  'settings:get': z.tuple([]),
  'settings:update': z.tuple([settingsPatch]),
  'settings:setClaudeKey': z.tuple([text(400).nullable()]),
  'permissions:get': z.tuple([]),
  'permissions:request': z.tuple([permission]),
  'permissions:openSettings': z.tuple([permission]),
  'models:status': z.tuple([]),
  'models:download': z.tuple([]),
  'models:cancel': z.tuple([]),
  'capture:start': z.tuple([
    z
      .object({
        platform: platform.optional(),
        title: text(200).optional(),
        source: z.enum(['live', 'demo']).optional(),
      })
      .strict(),
  ]),
  'capture:pause': z.tuple([]),
  'capture:resume': z.tuple([]),
  'capture:stop': z.tuple([]),
  'capture:status': z.tuple([]),
  'detection:current': z.tuple([]),
  'meetings:list': z.tuple([]),
  'meetings:get': z.tuple([id]),
  'meetings:rename': z.tuple([id, text(200).min(1)]),
  'meetings:renameSpeaker': z.tuple([id, text(80).min(1), text(120).nullable()]),
  'meetings:setParticipants': z.tuple([id, z.array(participant).max(200)]),
  'meetings:analyze': z.tuple([id, z.enum(['basic', 'local', 'claude']).optional()]),
  'meetings:delete': z.tuple([id]),
  'meetings:deleteTranscript': z.tuple([id]),
  'meetings:recover': z.tuple([id]),
  'tasks:list': z.tuple([
    z
      .object({
        scope: z.enum(['mine', 'all']),
        status: z.enum(['open', 'in_progress', 'blocked', 'completed', 'overdue', 'all']),
      })
      .strict(),
  ]),
  'tasks:update': z.tuple([
    id,
    id,
    z
      .object({
        task: text(500).min(1),
        owner: text(120).nullable(),
        deadlineDate: isoDate.nullable(),
        status: z.enum(['open', 'in_progress', 'blocked', 'completed']),
      })
      .partial()
      .strict(),
  ]),
  'tasks:add': z.tuple([id, text(500).min(1)]),
  'email:get': z.tuple([id]),
  'email:update': z.tuple([
    id,
    z
      .object({
        subject: text(300),
        body: text(50_000),
        to: z
          .array(
            z
              .object({
                name: text(120),
                email: text(254),
                role: z.enum(['organizer', 'required', 'optional']),
                external: z.boolean(),
              })
              .strict(),
          )
          .max(200),
      })
      .partial()
      .strict(),
  ]),
  'email:open': z.tuple([id]),
  'email:copy': z.tuple([id]),
  'search:query': z.tuple([text(500)]),
  'data:deleteAll': z.tuple([z.literal('DELETE')]),
  'data:loadSamples': z.tuple([]),
  'data:removeSamples': z.tuple([]),
} as const;

export type Channel = keyof typeof IPC_SCHEMAS;
export type ArgsOf<C extends Channel> = z.infer<(typeof IPC_SCHEMAS)[C]>;

export interface Results {
  'app:info': AppInfo;
  'app:showLogs': void;
  'app:checkUpdates': {
    state: 'disabled' | 'checking' | 'up-to-date' | 'available';
    message: string;
  };
  'settings:get': Settings;
  'settings:update': Settings;
  'settings:setClaudeKey': { stored: boolean; persistent: boolean; message: string };
  'permissions:get': PermissionStatus;
  'permissions:request': PermissionStatus;
  'permissions:openSettings': void;
  'models:status': ModelStatus;
  'models:download': ModelStatus;
  'models:cancel': ModelStatus;
  'capture:start': CaptureStatus;
  'capture:pause': CaptureStatus;
  'capture:resume': CaptureStatus;
  'capture:stop': CaptureStatus;
  'capture:status': CaptureStatus;
  'detection:current': DetectedMeeting | null;
  'meetings:list': MeetingSummary[];
  'meetings:get': MeetingDetail;
  'meetings:rename': void;
  'meetings:renameSpeaker': void;
  'meetings:setParticipants': void;
  'meetings:analyze': void;
  'meetings:delete': void;
  'meetings:deleteTranscript': void;
  'meetings:recover': void;
  'tasks:list': TaskRow[];
  'tasks:update': TaskRow;
  'tasks:add': TaskRow;
  'email:get': EmailDraftRow | null;
  'email:update': EmailDraftRow;
  'email:open': EmailResult;
  'email:copy': EmailResult;
  'search:query': SearchResult;
  'data:deleteAll': void;
  'data:loadSamples': void;
  'data:removeSamples': void;
}

/** Answer type re-exported for the renderer. */
export type { Answer };

/** Errors sent to the renderer carry only a safe, plain-language message. */
export interface IpcErrorPayload {
  __ipcError: true;
  message: string;
  code: string;
}

export * from './channels';
