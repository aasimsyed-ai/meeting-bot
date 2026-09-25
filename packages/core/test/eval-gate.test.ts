import { describe, expect, it } from 'vitest';
import { ALL_FIXTURES, generateLongMeeting } from '../fixtures/index.ts';
import { HOLDOUT_FIXTURES } from '../fixtures/holdout.ts';
import { analyzeMeeting } from '../src/pipeline.ts';
import { RulesExtractor } from '../src/extract/rules.ts';
import { aggregate, RULES_THRESHOLDS, scoreFixture } from '../eval/metrics.ts';

const NOW = () => new Date('2026-09-25T12:00:00-04:00');

async function scoreAll(fixtures: typeof ALL_FIXTURES) {
  const scores = [];
  for (const fx of fixtures) {
    const r = await analyzeMeeting(
      { meeting: fx.meeting, segments: fx.segments, screen: fx.screen },
      { extractor: new RulesExtractor(), now: NOW },
    );
    scores.push(scoreFixture(fx, r.notes, r.email));
  }
  return scores;
}

describe('AI quality gate (offline engine)', () => {
  it('meets the minimum bar on the development set with zero violations', async () => {
    const scores = await scoreAll(ALL_FIXTURES);
    const agg = aggregate(scores);
    expect(scores.flatMap((s) => s.violations)).toEqual([]);
    expect(agg.hallucinationRate).toBe(0);
    for (const [metric, min] of Object.entries(RULES_THRESHOLDS)) {
      expect(agg[metric as keyof typeof agg], metric).toBeGreaterThanOrEqual(min!);
    }
  });

  it('never hallucinates or leaks on the held-out set', async () => {
    const scores = await scoreAll(HOLDOUT_FIXTURES);
    expect(scores.flatMap((s) => s.violations)).toEqual([]);
    expect(aggregate(scores).hallucinationRate).toBe(0);
  });
});

describe('performance', () => {
  it.each([
    [5, 6],
    [30, 10],
    [60, 10],
    [120, 50],
  ])('analyzes a %i-minute meeting with %i participants quickly', async (minutes, participants) => {
    const fx = generateLongMeeting({ minutes, participants });
    const t0 = performance.now();
    const r = await analyzeMeeting(
      { meeting: fx.meeting, segments: fx.segments },
      { extractor: new RulesExtractor(), now: NOW },
    );
    const ms = performance.now() - t0;
    expect(r.notes.actionItems.length).toBeGreaterThanOrEqual(6);
    expect(ms).toBeLessThan(5000);
  });
});
