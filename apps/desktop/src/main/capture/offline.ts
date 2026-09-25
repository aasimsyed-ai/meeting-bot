import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { segmentId, type Principal } from '@meeting-assistant/core';
import type { Repo } from '../db/repo';
import { audioFiles, SAMPLE_RATE, type SpeechSegment, type Transcriber } from './session';
import { labelFor } from './labels';

/**
 * Transcribe the audio saved during a meeting. Used when live transcription
 * could not run (speech engine still downloading, engine failure, crash).
 * Returns the number of transcript lines added.
 */
export async function transcribeSavedAudio(opts: {
  repo: Repo;
  principal: Principal;
  meetingId: string;
  audioRoot: string;
  transcriber: Transcriber;
  onProgress?: (fraction: number) => void;
}): Promise<number> {
  const { repo, principal, meetingId } = opts;
  const files = audioFiles(opts.audioRoot, meetingId);
  const existing = repo.segments(principal, meetingId);
  const labels = new Map(repo.speakers(principal, meetingId).map((s) => [s.speakerId, s.label]));
  let count = existing.length;
  const lastEnd = existing.reduce((n, s) => Math.max(n, s.endMs), 0);
  const collected: SpeechSegment[] = [];
  opts.transcriber.onSegment((s) => collected.push(s));
  await opts.transcriber.start();

  const readers = (['mic', 'system'] as const)
    .filter((c) => files[c])
    .map((c) => ({
      channel: c,
      fd: openSync(files[c]!, 'r'),
      size: statSync(files[c]!).size,
      pos: 0,
    }));
  const total = readers.reduce((n, r) => n + r.size, 0) || 1;
  const chunkBytes = SAMPLE_RATE * 2; // one second of 16-bit audio
  const buf = Buffer.alloc(chunkBytes);
  try {
    // Interleave channels second by second so both stay on the same timeline.
    while (readers.some((r) => r.pos < r.size)) {
      for (const r of readers) {
        if (r.pos >= r.size) continue;
        const n = readSync(r.fd, buf, 0, chunkBytes, r.pos);
        r.pos += n;
        const samples = new Float32Array(Math.floor(n / 2));
        for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(i * 2) / 32768;
        opts.transcriber.push(r.channel, samples);
      }
      opts.onProgress?.(readers.reduce((n, r) => n + r.pos, 0) / total);
      await new Promise((r) => setImmediate(r));
    }
    await opts.transcriber.flush();
    const labels = new Map(
      ((await opts.transcriber.finalizeSpeakers?.()) ?? []).map((l) => [l.startMs, l.speakerKey]),
    );
    for (const s of collected)
      if (s.channel === 'system' && labels.has(s.startMs)) s.speakerKey = labels.get(s.startMs)!;
  } finally {
    for (const r of readers) closeSync(r.fd);
    await opts.transcriber.stop();
  }

  // Keep what was already transcribed live; add only speech after it.
  const fresh = collected
    .filter((s) => s.startMs >= lastEnd - 500)
    .sort((a, b) => a.startMs - b.startMs);
  repo.appendSegments(
    principal,
    meetingId,
    fresh.map((s) => ({
      id: segmentId(++count),
      startMs: s.startMs,
      endMs: s.endMs,
      speakerId: s.speakerKey,
      speaker: labelFor(s.speakerKey, labels),
      text: s.text,
      channel: s.channel,
    })),
  );
  return fresh.length;
}
