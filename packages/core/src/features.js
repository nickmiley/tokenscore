// @ts-check
/**
 * @module features
 *
 * Turns a conversation into a numeric feature vector.
 *
 * This is the privacy boundary of the system. Everything in this module runs
 * inside the chat page; only the resulting numbers ever leave it. Message text
 * is consumed by {@link deriveMessage} and not retained.
 */
import { countTokens } from './tokenizer.js';
import {
  hash32, words, shingles, terms, jaccard, paragraphs,
  isEmptyCalorie, isTrivialPrompt, isClarification, specificity,
} from './text.js';

/** @typedef {'user'|'assistant'} Role */
/** @typedef {'light'|'standard'|'heavy'|'unknown'} ModelTier */

/** Prompts with fewer words than this are not judged for specificity or topic. */
export const SUBSTANTIVE_WORDS = 15;
/** Consecutive prompts at or above this 3-shingle Jaccard are near-duplicates. */
export const NEAR_DUPLICATE = 0.6;
/** Consecutive substantive prompts at or below this content-word Jaccard are a topic shift. */
export const TOPIC_SHIFT = 0.05;

/**
 * Per-message statistics. Computed once per text change and cached by the
 * tracker. Sets are only populated for user messages; assistant text is
 * never fingerprinted beyond its paragraph hashes.
 *
 * @typedef {object} MessageStats
 * @property {Role} role
 * @property {number} tokens
 * @property {number} words
 * @property {Set<number>} shingles      user only
 * @property {Set<number>} terms         user only
 * @property {Array<[number, number]>} paragraphs  [hash, tokens] per paragraph ≥ 40 chars
 * @property {number} specificity        user only, 0..1
 * @property {boolean} emptyCalorie      user only
 * @property {boolean} trivial           user only
 * @property {boolean} clarification     assistant only
 */

const EMPTY_SET = new Set();

/**
 * Derive statistics for one message. The text is not stored.
 * @param {Role} role
 * @param {string} text
 * @returns {MessageStats}
 */
export function deriveMessage(role, text) {
  const w = words(text);
  const paras = paragraphs(text).map((p) => /** @type {[number, number]} */ ([hash32(p), countTokens(p)]));
  const isUser = role === 'user';
  return {
    role,
    tokens: countTokens(text),
    words: w.length,
    shingles: isUser ? shingles(w) : EMPTY_SET,
    terms: isUser ? terms(w) : EMPTY_SET,
    paragraphs: paras,
    specificity: isUser ? specificity(text) : 0,
    emptyCalorie: isUser && isEmptyCalorie(text),
    trivial: isUser && isTrivialPrompt(text, w.length),
    clarification: !isUser && isClarification(text, w.length),
  };
}

/**
 * Counters captured from UI interaction. Cumulative per conversation.
 * @typedef {object} ConversationEvents
 * @property {number} regenerations
 * @property {number} stops
 * @property {number} edits
 * @property {number} copyEvents
 * @property {number} copiedTokens
 */

/** @returns {ConversationEvents} */
export function emptyEvents() {
  return { regenerations: 0, stops: 0, edits: 0, copyEvents: 0, copiedTokens: 0 };
}

/**
 * @typedef {object} ConversationMeta
 * @property {string} conversationId  opaque, already hashed
 * @property {string} platform
 * @property {ModelTier} modelTier
 * @property {boolean} inProject
 * @property {number} startedAt
 */

/**
 * The feature vector for one conversation. Every field is a plain number,
 * boolean or short identifier so it can be validated by allow-list on the
 * server (see server/src/validate.js).
 *
 * @typedef {object} ConversationFeatures
 * @property {string} conversationId
 * @property {string} platform
 * @property {ModelTier} modelTier
 * @property {boolean} inProject
 * @property {number} startedAt
 * @property {number} updatedAt
 * @property {number} turns                 user messages
 * @property {number} assistantMessages
 * @property {number} userTokens
 * @property {number} assistantTokens
 * @property {number} visibleTokens         userTokens + assistantTokens
 * @property {number} effectiveTokens       Σ per turn (context sent + output generated) — what actually costs
 * @property {number} contextTokens         current context size; drives the in-page nudge
 * @property {number} firstTurnUserTokens
 * @property {number} emptyCalorieTurns
 * @property {number} nearDuplicatePrompts
 * @property {number} repastedTokens
 * @property {number} topicShifts
 * @property {number} substantivePrompts
 * @property {number} specificitySum
 * @property {number} clarifications
 * @property {number} trivialPromptsOnHeavy
 * @property {number} regenerations
 * @property {number} stops
 * @property {number} edits
 * @property {number} copyEvents
 * @property {number} copiedTokens
 */

/** Numeric feature fields, in schema order. Shared with the server's validator. */
export const NUMERIC_FIELDS = /** @type {const} */ ([
  'startedAt', 'updatedAt', 'turns', 'assistantMessages', 'userTokens', 'assistantTokens',
  'visibleTokens', 'effectiveTokens', 'contextTokens', 'firstTurnUserTokens', 'emptyCalorieTurns',
  'nearDuplicatePrompts', 'repastedTokens', 'topicShifts', 'substantivePrompts', 'specificitySum',
  'clarifications', 'trivialPromptsOnHeavy', 'regenerations', 'stops', 'edits', 'copyEvents', 'copiedTokens',
]);

/** Counters that only ever grow within a conversation; merged with max() on the server. */
export const MONOTONIC_FIELDS = /** @type {const} */ (['regenerations', 'stops', 'edits', 'copyEvents', 'copiedTokens']);

/**
 * Aggregate an ordered list of message stats into conversation features.
 *
 * Effective tokens model how chat APIs bill: each user turn sends the entire
 * context so far (input), then the reply is generated (output). A 20-turn
 * thread that grows 1k tokens per turn therefore costs ~200k effective tokens
 * even though only ~20k are visible.
 *
 * @param {MessageStats[]} stats
 * @param {ConversationEvents} events
 * @param {ConversationMeta} meta
 * @param {number} [now]
 * @returns {ConversationFeatures}
 */
export function aggregateConversation(stats, events, meta, now = Date.now()) {
  const f = /** @type {ConversationFeatures} */ ({
    conversationId: meta.conversationId,
    platform: meta.platform,
    modelTier: meta.modelTier,
    inProject: meta.inProject,
    startedAt: meta.startedAt,
    updatedAt: now,
    turns: 0, assistantMessages: 0, userTokens: 0, assistantTokens: 0, visibleTokens: 0,
    effectiveTokens: 0, contextTokens: 0, firstTurnUserTokens: 0, emptyCalorieTurns: 0,
    nearDuplicatePrompts: 0, repastedTokens: 0, topicShifts: 0, substantivePrompts: 0,
    specificitySum: 0, clarifications: 0, trivialPromptsOnHeavy: 0,
    ...events,
  });

  const seen = new Set();
  let ctx = 0;
  /** @type {MessageStats|null} */ let prevUser = null;
  /** @type {MessageStats|null} */ let prevSubstantive = null;

  for (const m of stats) {
    if (m.role === 'user') {
      f.turns++;
      f.userTokens += m.tokens;
      ctx += m.tokens;
      f.effectiveTokens += ctx;
      if (f.turns === 1) f.firstTurnUserTokens = m.tokens;
      if (m.emptyCalorie) f.emptyCalorieTurns++;
      if (m.trivial && meta.modelTier === 'heavy') f.trivialPromptsOnHeavy++;
      if (prevUser && m.words >= 5 && prevUser.words >= 5 && jaccard(m.shingles, prevUser.shingles) >= NEAR_DUPLICATE) {
        f.nearDuplicatePrompts++;
      }
      if (m.words >= SUBSTANTIVE_WORDS) {
        f.substantivePrompts++;
        f.specificitySum += m.specificity;
        if (prevSubstantive && jaccard(m.terms, prevSubstantive.terms) <= TOPIC_SHIFT) f.topicShifts++;
        prevSubstantive = m;
      }
      for (const [h, t] of m.paragraphs) if (seen.has(h)) f.repastedTokens += t;
      prevUser = m;
    } else {
      f.assistantMessages++;
      f.assistantTokens += m.tokens;
      f.effectiveTokens += m.tokens;
      ctx += m.tokens;
      if (m.clarification) f.clarifications++;
    }
    for (const [h] of m.paragraphs) seen.add(h);
  }

  f.visibleTokens = f.userTokens + f.assistantTokens;
  f.contextTokens = ctx;
  return f;
}
