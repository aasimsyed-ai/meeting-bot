// Synthesizes a fixture meeting as speech (one voice per speaker) for audio
// pipeline tests. Needs the sherpa-onnx VITS LibriTTS model (see README).
//   node scripts/synth-meeting.mjs <tts-model-dir> <out.wav> [fixture-id]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sherpa = require('sherpa-onnx-node');

const [ttsDir, out, fixtureId = 'phoenix-weekly'] = process.argv.slice(2);
if (!ttsDir || !out) {
  console.error('usage: node scripts/synth-meeting.mjs <tts-model-dir> <out.wav> [fixture-id]');
  process.exit(1);
}
const { ALL_FIXTURES } = await import('@meeting-assistant/core/fixtures');
const fx = ALL_FIXTURES.find((f) => f.id === fixtureId);
const tts = new sherpa.OfflineTts({
  model: {
    vits: {
      model: `${ttsDir}/en_US-libritts_r-medium.onnx`,
      tokens: `${ttsDir}/tokens.txt`,
      dataDir: `${ttsDir}/espeak-ng-data`,
    },
    numThreads: 2,
  },
  maxNumSentences: 2,
});
// Distinct LibriTTS voices, assigned in order of first appearance.
const VOICES = [10, 200, 450, 700, 88, 311];
const voiceOf = new Map();
const parts = [];
const truth = [];
let cursor = 0;
for (const seg of fx.segments) {
  if (!voiceOf.has(seg.speakerId)) voiceOf.set(seg.speakerId, VOICES[voiceOf.size % VOICES.length]);
  const a = tts.generate({ text: seg.text, sid: voiceOf.get(seg.speakerId), speed: 1.05 });
  const gap = Math.round(tts.sampleRate * 0.7);
  truth.push({
    speakerId: seg.speakerId,
    startMs: Math.round((cursor / tts.sampleRate) * 1000),
    endMs: Math.round(((cursor + a.samples.length) / tts.sampleRate) * 1000),
    text: seg.text,
  });
  cursor += a.samples.length + gap;
  parts.push(a.samples, new Float32Array(gap));
}
const total = parts.reduce((n, p) => n + p.length, 0);
const all = new Float32Array(total);
let o = 0;
for (const p of parts) {
  all.set(p, o);
  o += p.length;
}
const rs = new sherpa.LinearResampler(tts.sampleRate, 16000);
sherpa.writeWave(out, { samples: rs.flush(all), sampleRate: 16000 });
const { writeFileSync } = await import('node:fs');
writeFileSync(out.replace(/\.wav$/, '.json'), JSON.stringify(truth, null, 2));
console.log(`wrote ${out}: ${(total / tts.sampleRate).toFixed(1)} s, ${voiceOf.size} voices`);
