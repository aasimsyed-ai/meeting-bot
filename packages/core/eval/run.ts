/**
 * AI evaluation against the Acme ground-truth meetings.
 *
 *   pnpm eval                             offline engine (default, free)
 *   pnpm eval -- --engine mock            full AI path with the deterministic mock provider (free)
 *   pnpm eval -- --engine local-llm       a local model server, e.g. Ollama (free; needs
 *                                         MEETING_ASSISTANT_LLM_BASE_URL and _MODEL)
 *   pnpm eval -- --engine claude          optional paid API (needs ANTHROPIC_API_KEY)
 *
 * Writes eval/results/<engine>-<set>.json and prints a summary table.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_FIXTURES, RECORDED_AI_OUTPUTS } from '../fixtures/index.ts';
import { HOLDOUT_FIXTURES } from '../fixtures/holdout.ts';
import { analyzeMeeting } from '../src/pipeline.ts';
import {
  AI_PROVIDERS,
  aiConfigFromEnv,
  createExtractor,
  type AiProviderId,
} from '../src/extract/provider.ts';
import type { Extractor } from '../src/extract/schema.ts';
import { aggregate, RULES_THRESHOLDS, scoreFixture, type FixtureScore } from './metrics.ts';

const here = dirname(fileURLToPath(import.meta.url));
const engineArg = (
  process.argv.includes('--engine') ? process.argv[process.argv.indexOf('--engine') + 1] : 'rules'
) as AiProviderId;
const verbose = process.argv.includes('--verbose');
const holdout = process.argv.includes('--holdout');
const FIXTURES = holdout ? HOLDOUT_FIXTURES : ALL_FIXTURES;
const setName = holdout ? 'holdout' : 'dev';

function makeExtractor(): Extractor | null {
  if (!AI_PROVIDERS.includes(engineArg)) throw new Error(`Unknown engine: ${engineArg}`);
  const choice = createExtractor(
    { ...aiConfigFromEnv(process.env), provider: engineArg },
    { recorded: RECORDED_AI_OUTPUTS },
  );
  if (choice.unavailable) {
    console.log(
      `NOT RUN: ${choice.unavailable.replace(' Notes were made with the offline engine.', '')}`,
    );
    return null;
  }
  return choice.extractor;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function main() {
  const extractor = makeExtractor();
  if (!extractor) return;
  const scores: FixtureScore[] = [];
  const started = Date.now();
  console.log(`Evaluating ${FIXTURES.length} ${setName} meetings with the ${engineArg} engine\n`);
  for (const fx of FIXTURES) {
    const t0 = Date.now();
    const result = await analyzeMeeting(
      { meeting: fx.meeting, segments: fx.segments, screen: fx.screen },
      { extractor, now: () => new Date('2026-09-25T12:00:00-04:00') },
    );
    const s = scoreFixture(fx, result.notes, result.email);
    scores.push(s);
    const flag = s.violations.length ? ' ⚠' : '';
    console.log(
      `${fx.id.padEnd(32)} dec ${s.decisions.tp}/${s.decisions.tp + s.decisions.fn} (+${s.decisions.fp})  ` +
        `tasks ${s.actions.tp}/${s.actions.tp + s.actions.fn} (+${s.actions.fp})  owner ${s.ownerCorrect}/${s.ownerChecked}  ` +
        `due ${s.deadlineCorrect}/${s.deadlineChecked}  ${Date.now() - t0}ms${flag}`,
    );
    if (verbose || s.violations.length)
      for (const line of [...s.violations, ...(verbose ? s.failures : [])])
        console.log(`    - ${line}`);
  }
  const agg = aggregate(scores);
  console.log('\nAggregate');
  for (const [k, v] of Object.entries(agg))
    console.log(`  ${k.padEnd(26)} ${k === 'violations' ? v : pct(v)}`);
  console.log(`  total time                 ${Date.now() - started} ms`);

  const failedGates =
    (engineArg === 'rules' || engineArg === 'mock') && !holdout
      ? Object.entries(RULES_THRESHOLDS).filter(
          ([k, min]) => (agg as unknown as Record<string, number>)[k]! < min!,
        )
      : [];
  if (agg.violations > 0) failedGates.push(['violations', 0]);
  mkdirSync(join(here, 'results'), { recursive: true });
  writeFileSync(
    join(here, 'results', `${engineArg}-${setName}.json`),
    JSON.stringify(
      {
        engine: engineArg,
        set: setName,
        model: extractor.model ?? null,
        promptVersion: extractor.promptVersion,
        date: new Date().toISOString(),
        aggregate: agg,
        scores,
      },
      null,
      2,
    ),
  );
  if (failedGates.length) {
    console.log(`\nQUALITY GATE FAILED: ${failedGates.map(([k]) => k).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nQuality gate passed.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
