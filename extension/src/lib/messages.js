// @ts-check
/**
 * @module lib/messages
 * Message types exchanged over chrome.runtime between content script,
 * background worker and popup. Payload shapes are documented at each sender.
 */
export const MSG = Object.freeze({
  /** content → background: { features: ConversationFeatures } */
  SESSION_UPSERT: 'session:upsert',
  /** popup → content: {} → ConversationFeatures | null for the active tab */
  RECEIPT_GET: 'receipt:get',
  /** popup → background: {} → { score, error? } after syncing */
  SYNC_NOW: 'sync:now',
  /** popup → background: { cohort } → leaderboard payload */
  LEADERBOARD_GET: 'leaderboard:get',
  /** popup → background: {} → { teams: [{ teamId, name, members }] } */
  TEAMS_GET: 'teams:get',
  /** options → background: { displayName, role } → { userId, apiKey } */
  REGISTER: 'register',
});

/**
 * Promise wrapper around chrome.runtime.sendMessage.
 * @template T
 * @param {string} type
 * @param {object} [payload]
 * @returns {Promise<T>}
 */
export function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}
