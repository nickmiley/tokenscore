// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateWindow, scoreWindow, CATEGORY_WEIGHTS, FACTORS } from '../src/scoring.js';

/** @returns {import('../src/features.js').ConversationFeatures} */
function session(over = {}) {
  return {
    conversationId: 'x', platform: 'chatgpt', modelTier: 'standard', inProject: true, startedAt: 0, updatedAt: 0,
    turns: 5, assistantMessages: 5, userTokens: 500, assistantTokens: 1500, visibleTokens: 2000, effectiveTokens: 5000,
    contextTokens: 2000, firstTurnUserTokens: 350, emptyCalorieTurns: 0, nearDuplicatePrompts: 0, repastedTokens: 0,
    topicShifts: 0, substantivePrompts: 4, specificitySum: 3.6, clarifications: 0, trivialPromptsOnHeavy: 0,
    regenerations: 0, stops: 0, edits: 0, copyEvents: 3, copiedTokens: 900, ...over,
  };
}
const ctx = { verbosityRatio: 1, trendSlope: 0 };

test('category weights sum to one and every factor has a category', () => {
  const sum = Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  for (const f of FACTORS) assert.ok(f.category in CATEGORY_WEIGHTS, f.code);
});

test('a tidy user outscores a wasteful one', () => {
  const tidy = scoreWindow(aggregateWindow([session(), session(), session(), session()]), ctx);
  const messy = scoreWindow(aggregateWindow([
    session({ effectiveTokens: 40000, emptyCalorieTurns: 2, regenerations: 2, nearDuplicatePrompts: 2,
      repastedTokens: 300, specificitySum: 0.5, clarifications: 2, copyEvents: 0, copiedTokens: 0, inProject: false }),
  ]), { verbosityRatio: 2.5, trendSlope: -8 });
  assert.ok(tidy.raw > messy.raw, `${tidy.raw} vs ${messy.raw}`);
  assert.ok(tidy.raw <= 100 && messy.raw >= 0);
  assert.ok(messy.reasons.length === 3);
  assert.ok(tidy.strengths.length > 0);
  for (const v of Object.values(tidy.categories)) assert.ok(v >= 0 && v <= 100);
});

test('reasons never reveal weights', () => {
  const s = scoreWindow(aggregateWindow([session()]), ctx);
  for (const r of s.reasons) assert.deepEqual(Object.keys(r), ['code', 'tip']);
  for (const f of s.factors) assert.deepEqual(Object.keys(f), ['code', 'category', 'score']);
});
