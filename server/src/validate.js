// @ts-check
/**
 * @module validate
 *
 * The server's side of the privacy boundary. Incoming session objects are
 * rebuilt field by field from an allow-list; anything not on it — including
 * any string the client might have added — is dropped on the floor.
 */
import { NUMERIC_FIELDS, MONOTONIC_FIELDS } from '@tokenscore/core/features';

/** @typedef {import('@tokenscore/core/features').ConversationFeatures} ConversationFeatures */

const ID = /^[a-z0-9]{1,24}:[0-9a-f]{1,16}$/;
const PLATFORM = /^[a-z0-9-]{1,24}$/;
const TIERS = new Set(['light', 'standard', 'heavy', 'unknown']);
const MAX_TOKENS = 50_000_000;

/**
 * @param {unknown} input
 * @returns {ConversationFeatures|null} null when the shape is unusable
 */
export function validateSession(input) {
  if (!input || typeof input !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (input);
  const conversationId = typeof o.conversationId === 'string' && ID.test(o.conversationId) ? o.conversationId : null;
  const platform = typeof o.platform === 'string' && PLATFORM.test(o.platform) ? o.platform : null;
  if (!conversationId || !platform) return null;

  const out = /** @type {Record<string, unknown>} */ ({
    conversationId,
    platform,
    modelTier: TIERS.has(/** @type {string} */ (o.modelTier)) ? o.modelTier : 'unknown',
    inProject: o.inProject === true,
  });
  for (const k of NUMERIC_FIELDS) {
    const v = o[k];
    out[k] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, MAX_TOKENS) : 0;
  }
  if (!out.turns) return null;
  return /** @type {ConversationFeatures} */ (out);
}

/**
 * A conversation is re-sent as a whole each time it settles, so the newest
 * snapshot wins — except for UI event counters, which live in page memory and
 * reset on reload. Those are merged with max().
 * @param {ConversationFeatures|null} prev
 * @param {ConversationFeatures} next
 * @returns {ConversationFeatures}
 */
export function mergeSession(prev, next) {
  if (!prev) return next;
  const out = { ...next, startedAt: Math.min(prev.startedAt || next.startedAt, next.startedAt) };
  for (const k of MONOTONIC_FIELDS) out[k] = Math.max(prev[k], next[k]);
  return out;
}
