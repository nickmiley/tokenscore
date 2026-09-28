// @ts-check
/**
 * @module background/index
 *
 * Service worker. Persists settled feature vectors from content scripts,
 * pushes dirty ones to the API on a 15-minute alarm (or on demand from the
 * popup), and caches the latest score. All network access lives here so the
 * content script never needs the server URL or the API key.
 */
import { MSG } from '../lib/messages.js';
import { createClient } from '../lib/api.js';
import { getSettings, updateSettings, getSessions, setSessions, upsertSession, getScore, setScore } from '../lib/storage.js';

const SYNC_ALARM = 'tokenscore:sync';
const SYNC_MINUTES = 15;
/** Local copies older than this are dropped after a successful push. */
const LOCAL_RETENTION_MS = 45 * 86_400_000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_MINUTES });
});
chrome.alarms.onAlarm.addListener((a) => { if (a.name === SYNC_ALARM) sync().catch(() => {}); });

/** @returns {Promise<{ score: any, error?: string }>} */
async function sync() {
  const settings = await getSettings();
  if (!settings.apiKey) return { score: await getScore(), error: 'not signed in' };
  const api = createClient(settings);
  try {
    const sessions = await getSessions();
    const dirty = Object.values(sessions).filter((s) => s.dirty).map((s) => s.features);
    if (dirty.length) {
      await api.pushSessions(dirty);
      const cutoff = Date.now() - LOCAL_RETENTION_MS;
      for (const [id, s] of Object.entries(sessions)) {
        if (s.features.updatedAt < cutoff) delete sessions[id];
        else s.dirty = false;
      }
      await setSessions(sessions);
    }
    const score = await api.score();
    await setScore(score);
    return { score: await getScore() };
  } catch (e) {
    return { score: await getScore(), error: /** @type {Error} */ (e).message };
  }
}

/** @type {Record<string, (msg: any) => Promise<unknown>>} */
const handlers = {
  [MSG.SESSION_UPSERT]: async ({ features }) => { await upsertSession(features); return true; },
  [MSG.SYNC_NOW]: () => sync(),
  [MSG.LEADERBOARD_GET]: async ({ cohort }) => createClient(await getSettings()).leaderboard(cohort ?? 'global'),
  [MSG.TEAMS_GET]: async () => {
    const api = createClient(await getSettings());
    const { teams } = await api.myTeams();
    return { teams: await Promise.all(teams.map((t) => api.team(t.teamId))) };
  },
  [MSG.REGISTER]: async ({ displayName, role }) => {
    const settings = await getSettings();
    const res = await createClient({ ...settings, apiKey: '' }).register(displayName, role);
    await updateSettings({ apiKey: res.apiKey, userId: res.userId, displayName: res.displayName });
    return res;
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  h(msg).then(reply, (e) => reply({ error: e.message }));
  return true;
});
