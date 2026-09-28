// @ts-check
/**
 * @module api
 *
 * Route table and handlers. Every handler is a pure-ish function of a request
 * context that returns `{ status, body }`; transport concerns (CORS, JSON
 * parsing, auth lookup) live in index.js.
 *
 * Auth
 *   user   Authorization: Bearer ts_…   (issued by POST /v1/users)
 *   admin  Authorization: Bearer <TOKENSCORE_ADMIN_TOKEN>
 *
 * Endpoints
 *   POST /v1/users                     register → { userId, apiKey }
 *   GET  /v1/me                        profile
 *   POST /v1/sessions                  { sessions: ConversationFeatures[] }  → { accepted }
 *   GET  /v1/me/score                  latest rating per cohort with breakdown
 *   GET  /v1/leaderboard?cohort=&limit= top rated users in a cohort
 *   POST /v1/teams                     { name } → team (caller becomes manager)
 *   GET  /v1/me/teams                  teams the caller manages
 *   POST /v1/teams/:id/members         { userId }   (manager only)
 *   DELETE /v1/teams/:id/members/:userId            (manager only)
 *   GET  /v1/teams/:id                 members with their latest scores (manager only)
 *   POST /v1/admin/recompute           run the weekly job now (admin only)
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { RD } from '@tokenscore/core/rating';
import { CATEGORY_LABELS } from '@tokenscore/core/scoring';
import { validateSession, mergeSession } from './validate.js';
import { recompute } from './jobs/recompute.js';

/** @typedef {import('./db.js').Store} Store */
/**
 * @typedef {object} Ctx
 * @property {Store} store
 * @property {Record<string, string>} params
 * @property {URLSearchParams} query
 * @property {any} body
 * @property {{ id: string, display_name: string, role: string }|null} user
 * @property {boolean} admin
 */
/** @typedef {{ status: number, body: unknown }} Reply */
/** @typedef {{ method: string, pattern: RegExp, keys: string[], auth: 'none'|'user'|'admin', handler: (ctx: Ctx) => Reply }} Route */

const ok = (body) => ({ status: 200, body });
const bad = (status, error) => ({ status, body: { error } });

/** @param {string} key */
export const hashKey = (key) => createHash('sha256').update(key).digest('hex');

const MAX_SESSIONS_PER_POST = 200;
const ROLES = new Set(['engineer', 'writer', 'analyst', 'sales', 'support', 'general']);

/**
 * Public view of a ratings row. Raw score and percentile stay server-side.
 * @param {Record<string, unknown>} r
 */
function publicRating(r) {
  const rd = Number(r.rd);
  return {
    cohort: r.cohort,
    week: r.week,
    rating: Number(r.rating),
    rated: rd <= RD.rated,
    confidence: Math.round(100 * (1 - (rd - 40) / 160)),
    turns: Number(r.turns),
    categories: r.categories ? JSON.parse(String(r.categories)) : null,
    factors: r.factors ? JSON.parse(String(r.factors)) : null,
    reasons: r.reasons ? JSON.parse(String(r.reasons)) : null,
    strengths: r.strengths ? JSON.parse(String(r.strengths)) : null,
  };
}

/** @param {Store} store @param {string} userId */
function scoreFor(store, userId) {
  /** @type {Record<string, unknown>} */ const cohorts = {};
  for (const row of store.q.ratingLatestPerCohort.all(userId, userId)) cohorts[String(row.cohort)] = publicRating(row);
  return { cohorts, categoryLabels: CATEGORY_LABELS };
}

/** @type {Route[]} */
export const routes = [];

/**
 * @param {string} method
 * @param {string} path  e.g. '/v1/teams/:id/members'
 * @param {'none'|'user'|'admin'} auth
 * @param {(ctx: Ctx) => Reply} handler
 */
function route(method, path, auth, handler) {
  const keys = [];
  const pattern = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push({ method, pattern, keys, auth, handler });
}

route('POST', '/v1/users', 'none', ({ store, body }) => {
  const name = typeof body?.displayName === 'string' ? body.displayName.trim().slice(0, 40) : '';
  if (name.length < 2) return bad(400, 'displayName must be at least 2 characters');
  const role = ROLES.has(body?.role) ? body.role : 'general';
  const apiKey = 'ts_' + randomBytes(24).toString('base64url');
  const id = randomUUID();
  store.q.insertUser.run(id, hashKey(apiKey), name, role, Date.now());
  return ok({ userId: id, apiKey, displayName: name, role });
});

route('GET', '/v1/me', 'user', ({ user }) => ok({ userId: user?.id, displayName: user?.display_name, role: user?.role }));

route('POST', '/v1/sessions', 'user', ({ store, body, user }) => {
  const list = Array.isArray(body?.sessions) ? body.sessions.slice(0, MAX_SESSIONS_PER_POST) : null;
  if (!list || !user) return bad(400, 'sessions must be an array');
  let accepted = 0;
  store.transaction(() => {
    for (const raw of list) {
      const next = validateSession(raw);
      if (!next) continue;
      const prevRow = store.q.sessionGet.get(user.id, next.conversationId);
      const merged = mergeSession(prevRow ? JSON.parse(String(prevRow.features)) : null, next);
      store.q.sessionUpsert.run(user.id, merged.conversationId, merged.platform, JSON.stringify(merged), merged.turns, Date.now());
      accepted++;
    }
  });
  return ok({ accepted });
});

route('GET', '/v1/me/score', 'user', ({ store, user }) => ok(scoreFor(store, /** @type {string} */ (user?.id))));

route('GET', '/v1/leaderboard', 'user', ({ store, query, user }) => {
  const cohort = (query.get('cohort') ?? 'global').slice(0, 24);
  const limit = Math.min(100, Math.max(1, Number(query.get('limit')) || 25));
  const latest = store.q.ratingsLatestWeekForCohort.get(cohort);
  if (!latest?.week) return ok({ cohort, week: null, entries: [] });
  const entries = store.q.leaderboard.all(cohort, latest.week, RD.rated, limit).map((r, i) => ({
    rank: i + 1,
    displayName: r.display_name,
    rating: Number(r.rating),
    you: r.user_id === user?.id,
  }));
  const cohorts = store.q.cohorts.all().map((c) => String(c.cohort));
  return ok({ cohort, week: latest.week, entries, cohorts });
});

route('POST', '/v1/teams', 'user', ({ store, body, user }) => {
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (name.length < 2 || !user) return bad(400, 'name must be at least 2 characters');
  const id = randomUUID();
  store.q.teamInsert.run(id, name, user.id, Date.now());
  return ok({ teamId: id, name });
});

route('GET', '/v1/me/teams', 'user', ({ store, user }) =>
  ok({ teams: store.q.teamsManagedBy.all(/** @type {string} */ (user?.id)).map((t) => ({ teamId: t.id, name: t.name })) }));

/** @param {Ctx} ctx */
function managedTeam({ store, params, user }) {
  const team = store.q.teamById.get(params.id);
  if (!team) return { team: null, reply: bad(404, 'team not found') };
  if (team.manager_id !== user?.id) return { team: null, reply: bad(403, 'only the team manager can do this') };
  return { team, reply: null };
}

route('POST', '/v1/teams/:id/members', 'user', (ctx) => {
  const { team, reply } = managedTeam(ctx);
  if (!team) return /** @type {Reply} */ (reply);
  const member = typeof ctx.body?.userId === 'string' ? ctx.store.q.userById.get(ctx.body.userId) : null;
  if (!member) return bad(404, 'user not found');
  ctx.store.q.memberInsert.run(team.id, member.id);
  return ok({ teamId: team.id, userId: member.id });
});

route('DELETE', '/v1/teams/:id/members/:userId', 'user', (ctx) => {
  const { team, reply } = managedTeam(ctx);
  if (!team) return /** @type {Reply} */ (reply);
  ctx.store.q.memberDelete.run(team.id, ctx.params.userId);
  return ok({ removed: true });
});

route('GET', '/v1/teams/:id', 'user', (ctx) => {
  const { team, reply } = managedTeam(ctx);
  if (!team) return /** @type {Reply} */ (reply);
  const members = ctx.store.q.members.all(team.id).map((m) => ({
    userId: m.id,
    displayName: m.display_name,
    role: m.role,
    ...scoreFor(ctx.store, String(m.id)),
  }));
  return ok({ teamId: team.id, name: team.name, members });
});

route('POST', '/v1/admin/recompute', 'admin', ({ store }) => ok(recompute(store)));
