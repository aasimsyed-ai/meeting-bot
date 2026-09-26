/**
 * Real audio -> transcript -> notes, with the actual speech engine.
 * Runs only when models are available:
 *   MEETING_ASSISTANT_TEST_MODELS=<dir with silero_vad.onnx, wespeaker_en_voxceleb_resnet34.onnx, and the speech model: parakeet-v3 by default, or MEETING_ASSISTANT_TEST_ASR_MODEL>
 *   MEETING_ASSISTANT_TEST_WAV=<16 kHz wav made by scripts/synth-meeting.mjs>
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  analyzeMeeting,
  RulesExtractor,
  segmentId,
  type TranscriptSegment,
} from '@meeting-assistant/core';
import { phoenixWeekly } from '@meeting-assistant/core/fixtures';
import { SpeechEngine } from '../src/main/transcription/engine';
import { modelPaths } from '../src/main/transcription/models';
import { labelFor } from '../src/main/capture/labels';

const models = process.env.MEETING_ASSISTANT_TEST_MODELS;
const wav = process.env.MEETING_ASSISTANT_TEST_WAV;

describe.skipIf(!models || !wav)('speech engine on synthetic meeting audio', () => {
  it('transcribes, separates speakers and produces the expected notes', async () => {
    const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as {
      readWave(p: string): { samples: Float32Array; sampleRate: number };
    };
    const audio = sherpa.readWave(wav!);
    expect(audio.sampleRate).toBe(16000);
    const engine = await SpeechEngine.create(
      modelPaths(
        models!,
        (process.env.MEETING_ASSISTANT_TEST_ASR_MODEL || 'parakeet-v3') as 'parakeet-v3',
      ),
      {
        numThreads: 2,
      },
    );
    const t0 = performance.now();
    const out = [];
    for (let i = 0; i < audio.samples.length; i += 1600)
      out.push(...engine.push('system', audio.samples.subarray(i, i + 1600)));
    out.push(...engine.flush());
    const live = new Set(out.map((s) => s.speakerKey)).size;
    const final = new Map(engine.finalizeSpeakers().map((l) => [l.startMs, l.speakerKey]));
    for (const s of out) s.speakerKey = final.get(s.startMs) ?? s.speakerKey;
    console.log('live speakers:', live);
    const seconds = audio.samples.length / 16000;
    const ms = performance.now() - t0;
    console.log(
      `transcribed ${seconds.toFixed(0)} s of audio in ${(ms / 1000).toFixed(1)} s (${(seconds / (ms / 1000)).toFixed(1)}x real time), ${out.length} segments`,
    );

    // Synthetic audio only, so printing the transcript is safe and makes CI failures debuggable.
    console.log(out.map((s) => `${s.speakerKey}: ${s.text}`).join('\n'));
    const text = out
      .map((s) => s.text)
      .join(' ')
      .toLowerCase();
    for (const phrase of ['deployment', 'monday', 'firewall', 'migration', 'approval'])
      expect(text).toContain(phrase);

    const speakers = new Set(out.map((s) => s.speakerKey));
    console.log('speakers found:', speakers.size);
    expect(speakers.size).toBeGreaterThanOrEqual(3);
    expect(speakers.size).toBeLessThanOrEqual(6);

    const labels = new Map<string, string>();
    const segments: TranscriptSegment[] = out.map((s, i) => ({
      id: segmentId(i + 1),
      startMs: s.startMs,
      endMs: s.endMs,
      speakerId: s.speakerKey,
      speaker: labelFor(s.speakerKey, labels),
      text: s.text,
      channel: 'system',
    }));
    const r = await analyzeMeeting(
      { meeting: { ...phoenixWeekly.meeting, participants: [] }, segments },
      { extractor: new RulesExtractor(), now: () => new Date('2026-09-21T15:00:00Z') },
    );
    console.log(
      'decisions:',
      r.notes.decisions.filter((d) => d.status === 'confirmed').map((d) => d.text),
    );
    console.log(
      'tasks:',
      r.notes.actionItems.map((a) => `${a.task} | ${a.owner} | ${a.deadline?.date ?? '-'}`),
    );
    expect(r.notes.decisions.some((d) => d.status === 'confirmed' && /monday/i.test(d.text))).toBe(
      true,
    );
    const firewall = r.notes.actionItems.find((a) => /firewall/i.test(a.task));
    expect(firewall?.owner).toMatch(/^Speaker \d$/);
    expect(firewall?.deadline?.date).toBe('2026-09-24');
    // No real names can appear: none were ever said as speaker labels.
    expect(r.notes.actionItems.every((a) => !a.owner || /^Speaker \d$/.test(a.owner))).toBe(true);
  }, 300_000);
});
