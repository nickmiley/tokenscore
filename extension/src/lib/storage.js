// @ts-check
/**
 * @module lib/storage
 * Typed access to chrome.storage.local. Keys:
 *   settings  user preferences and credentials
 *   sessions  { [conversationId]: { features, dirty } } awaiting or already synced
 *   score     last /v1/me/score payload plus fetchedAt
 */

/**
 * @typedef {object} Settings
 * @property {boolean} enabled          consent given; nothing is observed until true
 * @property {boolean} nudges           show the in-page long-thread nudge
 * @property {number} nudgeThreshold    context tokens at which to nudge
 * @property {string} serverUrl
 * @property {string} apiKey
 * @property {string} displayName
 * @property {string} userId
 */

/** @type {Settings} */
export const DEFAULT_SETTINGS = {
  enabled: false,
  nudges: true,
  nudgeThreshold: 30_000,
  serverUrl: 'http://localhost:8787',
  apiKey: '',
  displayName: '',
  userId: '',
};

/** @returns {Promise<Settings>} */
export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

/** @param {Partial<Settings>} patch */
export async function updateSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/** @typedef {import('@tokenscore/core/features').ConversationFeatures} ConversationFeatures */
/** @typedef {Record<string, { features: ConversationFeatures, dirty: boolean }>} SessionMap */

/** @returns {Promise<SessionMap>} */
export async function getSessions() {
  const { sessions } = await chrome.storage.local.get('sessions');
  return sessions ?? {};
}

/** @param {SessionMap} sessions */
export function setSessions(sessions) {
  return chrome.storage.local.set({ sessions });
}

/** @param {ConversationFeatures} features */
export async function upsertSession(features) {
  const sessions = await getSessions();
  sessions[features.conversationId] = { features, dirty: true };
  await setSessions(sessions);
}

/** @returns {Promise<any>} */
export async function getScore() {
  const { score } = await chrome.storage.local.get('score');
  return score ?? null;
}

/** @param {any} score */
export function setScore(score) {
  return chrome.storage.local.set({ score: { ...score, fetchedAt: Date.now() } });
}
