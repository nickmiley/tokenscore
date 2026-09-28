// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens } from '../src/tokenizer.js';

test('short prose is roughly one token per word', () => {
  assert.equal(estimateTokens('Hello world'), 2);
  assert.equal(estimateTokens(''), 0);
});

test('long words split, digits group by three, newlines count once per run', () => {
  assert.equal(estimateTokens('internationalization'), 4);
  assert.equal(estimateTokens('123456'), 2);
  assert.equal(estimateTokens('a\n\n\nb'), 3);
});

test('a 100-word paragraph lands near 130 tokens', () => {
  const para = 'The quick brown fox jumps over the lazy dog while considering the remarkable implications of computational efficiency. '.repeat(6);
  const words = para.trim().split(/\s+/).length;
  const t = estimateTokens(para);
  assert.ok(t > words * 1.05 && t < words * 1.6, `${t} tokens for ${words} words`);
});

test('code costs more per character than prose', () => {
  const code = 'const x = arr.map((v) => ({ id: v.id, n: v.n * 2 }));';
  const prose = 'const values are mapped to objects with an id and a doubled number';
  assert.ok(estimateTokens(code) / code.length > estimateTokens(prose) / prose.length);
});
