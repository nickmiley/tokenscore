// @ts-check
/**
 * @module lib/api
 * Minimal client for the TokenScore API. Throws on non-2xx with the server's
 * error message so callers can surface it verbatim.
 */

/**
 * @param {{ serverUrl: string, apiKey: string }} cfg
 */
export function createClient(cfg) {
  const base = cfg.serverUrl.replace(/\/+$/, '');
  /**
   * @param {string} method
   * @param {string} path
   * @param {unknown} [body]
   */
  async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
    return json;
  }
  return {
    register: (displayName, role) => call('POST', '/v1/users', { displayName, role }),
    pushSessions: (sessions) => call('POST', '/v1/sessions', { sessions }),
    score: () => call('GET', '/v1/me/score'),
    leaderboard: (cohort) => call('GET', `/v1/leaderboard?cohort=${encodeURIComponent(cohort)}&limit=25`),
    myTeams: () => call('GET', '/v1/me/teams'),
    team: (id) => call('GET', `/v1/teams/${encodeURIComponent(id)}`),
  };
}
