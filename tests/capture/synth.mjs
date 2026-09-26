// Turns a capture scenario into audio for the capture harness:
//   meeting.wav  what the meeting app plays (remote people)
//   mic.wav      what the user says into the microphone, with a quiet room-noise floor
//   mic-idle.wav room noise only, for the microphone before the meeting starts
//   timeline.json when each line is spoken, for slides and for checking results
// Both tracks have the same length, so they stay in step when played together.
//
//   node tests/capture/synth.mjs <scenario.json> <tts-model-dir> <out-dir>
//
// Needs the sherpa-onnx VITS LibriTTS model (free, see tests/capture/README.md).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
const sherpa = require('sherpa-onnx-node');

const [scenarioPath, ttsDir, outDir] = process.argv.slice(2);
if (!scenarioPath || !ttsDir || !outDir) {
  console.error('usage: node tests/capture/synth.mjs <scenario.json> <tts-model-dir> <out-dir>');
  process.exit(1);
}
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const tts = new sherpa.OfflineTts({
  model: {
    vits: {
      model: `${ttsDir}/en_US-libritts_r-medium.onnx`,
      tokens: `${ttsDir}/tokens.txt`,
      dataDir: `${ttsDir}/espeak-ng-data`,
      // Nearly no sampling noise: the same scenario gives nearly the same audio every run.
      noiseScale: 0.0001,
      noiseScaleW: 0.0001,
    },
    numThreads: 2,
  },
  maxNumSentences: 2,
});

const RATE = 16000;
const rs = (samples) => {
  const r = new sherpa.LinearResampler(tts.sampleRate, RATE);
  return r.flush(samples);
};
const LEAD_IN = 1.5 * RATE;
const GAP = Math.round((scenario.gapSeconds ?? 0.7) * RATE);

// Render every line once, then lay them out on one timeline.
const rendered = scenario.lines.map((line) => {
  const sid = scenario.voices[line.speaker] ?? 0;
  // "say": how a person would pronounce the line, when the TTS reads it differently
  // (for example acronyms: "Q A" for "QA"). "text" stays the written form.
  const a = tts.generate({ text: line.say ?? line.text, sid, speed: line.speed ?? 1.05 });
  return { ...line, samples: rs(a.samples) };
});
let cursor = LEAD_IN;
const timeline = [];
for (const r of rendered) {
  // "overlap": this line starts before the previous one ends (an interruption).
  const start = r.overlapSeconds
    ? Math.max(0, cursor - GAP - Math.round(r.overlapSeconds * RATE))
    : cursor;
  timeline.push({
    speaker: r.speaker,
    channel: r.channel,
    text: r.text,
    startMs: Math.round((start / RATE) * 1000),
    endMs: Math.round(((start + r.samples.length) / RATE) * 1000),
    start,
  });
  cursor = Math.max(cursor, start + r.samples.length + GAP);
}
const total = cursor + 2 * RATE;
const meeting = new Float32Array(total);
const mic = new Float32Array(total);

// Deterministic noise, so runs are repeatable.
let seed = 42;
const noise = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff - 0.5;
};
const meetingNoise = scenario.meetingNoise ?? 0.002;
const micNoise = scenario.micNoise ?? 0.002;
for (let i = 0; i < total; i++) {
  meeting[i] = noise() * meetingNoise;
  mic[i] = noise() * micNoise;
}
for (let i = 0; i < rendered.length; i++) {
  const track = rendered[i].channel === 'mic' ? mic : meeting;
  const s = rendered[i].samples;
  const at = timeline[i].start;
  for (let j = 0; j < s.length && at + j < total; j++) track[at + j] += s[j];
}

mkdirSync(outDir, { recursive: true });
sherpa.writeWave(join(outDir, 'meeting.wav'), { samples: meeting, sampleRate: RATE });
sherpa.writeWave(join(outDir, 'mic.wav'), { samples: mic, sampleRate: RATE });
// Room noise only, looped into the microphone before and after the meeting (real
// microphones are never perfectly silent).
sherpa.writeWave(join(outDir, 'mic-idle.wav'), {
  samples: mic.slice(0, LEAD_IN),
  sampleRate: RATE,
});
writeFileSync(
  join(outDir, 'timeline.json'),
  JSON.stringify(
    {
      scenario: scenario.id,
      durationMs: Math.round((total / RATE) * 1000),
      lines: timeline.map((l) => ({
        speaker: l.speaker,
        channel: l.channel,
        text: l.text,
        startMs: l.startMs,
        endMs: l.endMs,
      })),
    },
    null,
    2,
  ),
);
console.log(
  `wrote ${outDir}: ${(total / RATE).toFixed(1)} s, ${rendered.length} lines, ${
    new Set(rendered.map((r) => r.speaker)).size
  } voices`,
);
