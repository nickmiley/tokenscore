// @ts-check
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTokenizer, estimateTokens } from '../src/tokenizer.js';
import { deriveMessage, aggregateConversation, emptyEvents } from '../src/features.js';

/** @type {import('../src/features.js').ConversationMeta} */
const meta = { conversationId: 'chatgpt:abc', platform: 'chatgpt', modelTier: 'heavy', inProject: false, startedAt: 0 };

before(() => setTokenizer((t) => t.length)); // deterministic: 1 token per char
after(() => setTokenizer(estimateTokens));

test('effective tokens model context resends', () => {
  const stats = [
    deriveMessage('user', 'a'.repeat(10)),
    deriveMessage('assistant', 'b'.repeat(20)),
    deriveMessage('user', 'c'.repeat(5)),
    deriveMessage('assistant', 'd'.repeat(15)),
  ];
  const f = aggregateConversation(stats, emptyEvents(), meta, 1);
  // turn 1: ctx 10 → 10; reply 20 → 30; turn 2: ctx 35 → 65; reply 15 → 80
  assert.equal(f.effectiveTokens, 80);
  assert.equal(f.visibleTokens, 50);
  assert.equal(f.contextTokens, 50);
  assert.equal(f.turns, 2);
  assert.equal(f.firstTurnUserTokens, 10);
});

test('empty-calorie, trivial-on-heavy, near-duplicate and re-paste are counted', () => {
  const block = 'This is a paragraph that is comfortably longer than forty characters.';
  const stats = [
    deriveMessage('user', `Summarize this:\n${block}`),
    deriveMessage('assistant', 'Sure, here is a summary.'),
    deriveMessage('user', `Summarize this:\n${block}`),
    deriveMessage('user', 'ok'),
    deriveMessage('user', 'what is 2 plus 2'),
  ];
  const f = aggregateConversation(stats, emptyEvents(), meta, 1);
  assert.equal(f.nearDuplicatePrompts, 1);
  assert.equal(f.repastedTokens, block.length);
  assert.equal(f.emptyCalorieTurns, 1);
  assert.equal(f.trivialPromptsOnHeavy, 2);
});

test('events are carried through', () => {
  const f = aggregateConversation([deriveMessage('user', 'hi')], { ...emptyEvents(), copyEvents: 3 }, meta, 1);
  assert.equal(f.copyEvents, 3);
});
