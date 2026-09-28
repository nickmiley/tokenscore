// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentileRanks, updateRating, isRated, RATING, RD, jitter } from '../src/rating.js';

test('percentile ranks: mid-rank ties, shrinkage on small cohorts', () => {
  const p = percentileRanks([10, 20, 20, 40], 0);
  assert.deepEqual(p, [0, 0.5, 0.5, 1]);
  const [lone] = percentileRanks([42]);
  assert.equal(lone, 0.5);
  const [lo, hi] = percentileRanks([1, 2]);
  assert.ok(lo > 0.3 && hi < 0.7, 'two users should not span the whole scale');
});

test('cold start converges and becomes rated after three active weeks', () => {
  let r = updateRating(null, 0.9);
  assert.equal(r.rating, RATING.min + (RATING.max - RATING.min) * 0.9);
  assert.ok(!isRated(r.rd));
  r = updateRating(r, 0.9);
  r = updateRating(r, 0.9);
  assert.ok(isRated(r.rd));
});

test('established ratings move slowly and inactivity grows uncertainty', () => {
  let r = { rating: 700, rd: RD.floor };
  const moved = updateRating(r, 0.1);
  assert.ok(moved.rating > 600, 'one bad week should not crater a settled rating');
  const idle = updateRating(r, null);
  assert.ok(idle.rd > r.rd && idle.rating === r.rating);
});

test('jitter is deterministic and bounded', () => {
  assert.equal(jitter('u1:2026-W39'), jitter('u1:2026-W39'));
  for (let i = 0; i < 200; i++) assert.ok(Math.abs(jitter(`k${i}`)) <= 2);
});
