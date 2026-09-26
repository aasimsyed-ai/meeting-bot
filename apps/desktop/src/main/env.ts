import { aiConfigFromEnv, type AiProviderConfig } from '@meeting-assistant/core';
import type { AppEnv } from '../shared/types';

/**
 * Environment separation. Tests and development never share data with a
 * real installation, and automated tests can never send real email.
 */
export interface Env {
  appEnv: AppEnv;
  /** Overrides the data folder (tests use a temporary folder). */
  dataDir: string | null;
  emailMode: 'mailapp' | 'mock';
  /** Test-only: pretend OS permissions are granted, so CI can run the full flow. */
  fakePermissions: boolean;
  /** Test-only: a fixed "now" so dates in tests are stable. */
  fixedNow: string | null;
  /** Test-only: speed up simulated meetings. */
  demoSpeed: number;
  claudeApiKey: string | null;
  /**
   * Developer override of the notes engine (MEETING_ASSISTANT_AI_PROVIDER). Null means
   * use the Settings choice. Tests may only pick the offline or mock engine.
   */
  aiOverride: AiProviderConfig | null;
  /** Test-only: a 16 kHz WAV streamed in real time as meeting audio. */
  testMeetingAudio: string | null;
  /** Test-only: run meeting detection, which tests normally leave off (capture harness). */
  detectInTest: boolean;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env, isPackaged = false): Env {
  const appEnv: AppEnv =
    source.MEETING_ASSISTANT_ENV === 'test'
      ? 'test'
      : source.MEETING_ASSISTANT_ENV === 'development' ||
          (!isPackaged && source.NODE_ENV !== 'production')
        ? 'development'
        : 'production';
  const isTest = appEnv === 'test';
  return {
    appEnv,
    dataDir: source.MEETING_ASSISTANT_DATA_DIR || null,
    // Tests are always mock, whatever else is set.
    emailMode: isTest || source.EMAIL_MODE === 'mock' ? 'mock' : 'mailapp',
    fakePermissions: isTest && source.MEETING_ASSISTANT_FAKE_PERMISSIONS === '1',
    fixedNow: isTest ? source.MEETING_ASSISTANT_NOW || null : null,
    demoSpeed: Math.max(1, Math.min(200, Number(source.MEETING_ASSISTANT_DEMO_SPEED) || 1)),
    // Never used in tests, so automated runs cannot call a paid API by accident.
    claudeApiKey: isTest ? null : source.ANTHROPIC_API_KEY || null,
    aiOverride: aiOverride(source, isTest),
    testMeetingAudio: isTest ? source.MEETING_ASSISTANT_TEST_MEETING_AUDIO || null : null,
    detectInTest: isTest && source.MEETING_ASSISTANT_TEST_DETECTION === '1',
  };
}

export function nowFrom(env: Env): () => Date {
  return env.fixedNow ? () => new Date(env.fixedNow!) : () => new Date();
}

function aiOverride(source: NodeJS.ProcessEnv, isTest: boolean): AiProviderConfig | null {
  if (!source.MEETING_ASSISTANT_AI_PROVIDER) return null;
  const cfg = aiConfigFromEnv(source);
  if (isTest && cfg.provider !== 'rules' && cfg.provider !== 'mock') return { provider: 'rules' };
  return isTest ? { provider: cfg.provider } : cfg;
}
