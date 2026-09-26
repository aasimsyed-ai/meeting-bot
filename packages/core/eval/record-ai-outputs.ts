/**
 * Records the reference outputs the mock AI provider replays for the fixture
 * meetings (fixtures/ai-outputs.json). They come from the offline engine, not from
 * a real language model, and are labelled that way. Re-run only on purpose:
 *
 *   node --experimental-strip-types eval/record-ai-outputs.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_FIXTURES } from '../fixtures/index.ts';
import { HOLDOUT_FIXTURES } from '../fixtures/holdout.ts';
import { RulesExtractor } from '../src/extract/rules.ts';
import { transcriptFingerprint } from '../src/extract/mock.ts';

const rules = new RulesExtractor();
const out = [];
for (const fx of [...ALL_FIXTURES, ...HOLDOUT_FIXTURES]) {
  out.push({
    id: fx.id,
    source: 'offline-rules-engine (reference output, not a real language model)',
    fingerprint: transcriptFingerprint(fx.segments),
    output: await rules.extract({ meeting: fx.meeting, segments: fx.segments, screen: fx.screen }),
  });
}
const file = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/ai-outputs.json');
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`recorded ${out.length} reference outputs to ${file}`);
