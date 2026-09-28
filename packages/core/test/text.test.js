// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { words, shingles, terms, jaccard, isEmptyCalorie, isClarification, isTrivialPrompt, specificity, paragraphs } from '../src/text.js';

test('jaccard: identical sets are 1, disjoint are 0', () => {
  const a = shingles(words('write me a haiku about rain'));
  const b = shingles(words('write me a haiku about rain'));
  const c = shingles(words('summarize this quarterly report'));
  assert.equal(jaccard(a, b), 1);
  assert.equal(jaccard(a, c), 0);
});

test('terms share content words across rephrasings', () => {
  const a = terms(words('Refactor the payment service to retry failed webhooks'));
  const b = terms(words('The payment webhooks should retry when they fail; refactor the service'));
  assert.ok(jaccard(a, b) > 0.3);
});

test('empty-calorie messages', () => {
  assert.ok(isEmptyCalorie('ok thanks!'));
  assert.ok(isEmptyCalorie('Continue'));
  assert.ok(!isEmptyCalorie('thanks, now do the same for the French version'));
});

test('clarification detection ignores long answers that end with an offer', () => {
  assert.ok(isClarification('Which file do you mean — the config or the schema?', 10));
  const long = 'Here is the plan. '.repeat(30) + 'Want me to draft it?';
  assert.ok(!isClarification(long, 120));
});

test('trivial prompts are short single-line prose', () => {
  assert.ok(isTrivialPrompt('what is the capital of peru', 6));
  assert.ok(!isTrivialPrompt('fix this\nfunction f() {}', 4));
});

test('specificity saturates at four signals', () => {
  const vague = 'tell me about marketing';
  const precise = 'You are a senior editor. Rewrite this for a non-technical audience in at most 120 words, as bullet points, and avoid jargon. For example, replace "latency" with "delay".';
  assert.equal(specificity(vague), 0);
  assert.equal(specificity(precise), 1);
});

test('paragraphs keep only fingerprint-worthy blocks', () => {
  const p = paragraphs('short\n\n' + 'x'.repeat(50) + '\n' + 'y'.repeat(39));
  assert.equal(p.length, 1);
});
