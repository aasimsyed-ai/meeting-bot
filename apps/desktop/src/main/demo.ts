import { analyzeMeeting, RulesExtractor, type Principal } from '@meeting-assistant/core';
import { ALL_FIXTURES, DEMO_USER } from '@meeting-assistant/core/fixtures';
import type { Repo } from './db/repo';
import type { SettingsService } from './settings';

/**
 * Loads the Acme Demo Corporation meetings as clearly labelled sample data.
 * They go through the same analysis pipeline as real meetings (on-device
 * engine), so what you see is what the app really produces.
 */
export async function loadSampleData(
  repo: Repo,
  p: Principal,
  settings: SettingsService,
  now: () => Date,
): Promise<number> {
  const existing = new Set(repo.sampleMeetingIds(p));
  let added = 0;
  const profile = settings.get().profile;
  if (!profile.name) {
    repo.setSetting('profileBeforeSamples', JSON.stringify(profile));
    settings.update({ profile: { name: DEMO_USER.name, email: DEMO_USER.email } });
  }
  for (const fx of ALL_FIXTURES) {
    const id = `sample_${fx.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
    if (existing.has(id)) continue;
    const last = fx.segments[fx.segments.length - 1];
    repo.createMeeting(p, {
      id,
      title: fx.meeting.title,
      platform: fx.meeting.platform ?? 'other',
      startedAt: fx.meeting.startedAt,
      timeZone: fx.meeting.timeZone ?? null,
      source: 'sample',
      participants: fx.meeting.participants,
      status: 'processing',
    });
    repo.appendSegments(p, id, fx.segments);
    for (const note of fx.screen ?? []) repo.addScreenNote(p, id, note);
    const result = await analyzeMeeting(
      {
        meeting: { ...fx.meeting, id, user: DEMO_USER },
        segments: repo.segments(p, id),
        screen: fx.screen,
      },
      { extractor: new RulesExtractor(), now },
    );
    repo.saveAnalysis(p, id, result, repo.transcriptHash(p, id));
    repo.setStatus(p, id, 'ready', {
      durationMs: last ? last.endMs : 0,
      endedAt: fx.meeting.startedAt,
      stage: null,
    });
    added++;
  }
  return added;
}

export function removeSampleData(repo: Repo, p: Principal, settings: SettingsService): number {
  const ids = repo.sampleMeetingIds(p);
  for (const id of ids) repo.deleteMeeting(p, id);
  const before = repo.getSetting('profileBeforeSamples');
  if (before) {
    try {
      settings.update({ profile: JSON.parse(before) as { name: string; email: string } });
    } catch {
      // Keep the current profile if the saved one is unreadable.
    }
    repo.deleteSetting('profileBeforeSamples');
  }
  return ids.length;
}
