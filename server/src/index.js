// @ts-check
/**
 * @module index
 *
 * Transport layer over {@link routes}. Environment:
 *
 *   TOKENSCORE_PORT         default 8787
 *   TOKENSCORE_DB           default ./tokenscore.db
 *   TOKENSCORE_ADMIN_TOKEN  required for POST /v1/admin/recompute
 *   TOKENSCORE_AUTO_RECOMPUTE  "1" to run the weekly job automatically when a new ISO week starts
 */
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { isoWeek } from '@tokenscore/core/stats';
import { openDb } from './db.js';
import { routes, hashKey } from './api.js';
import { recompute } from './jobs/recompute.js';

const PORT = Number(process.env.TOKENSCORE_PORT) || 8787;
const ADMIN_TOKEN = process.env.TOKENSCORE_ADMIN_TOKEN ?? '';
const MAX_BODY = 1_000_000;

const store = openDb(process.env.TOKENSCORE_DB ?? 'tokenscore.db');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<unknown>}
 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */ const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(null);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

/** @param {string|undefined} header */
function bearer(header) {
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/** @param {string} a @param {string} b */
function safeEqual(a, b) {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
  if (!route) return send(404, { error: 'not found' });

  const token = bearer(req.headers.authorization);
  const admin = ADMIN_TOKEN !== '' && safeEqual(token, ADMIN_TOKEN);
  const user = token.startsWith('ts_') ? store.q.userByKey.get(hashKey(token)) ?? null : null;
  if (route.auth === 'user' && !user) return send(401, { error: 'missing or invalid API key' });
  if (route.auth === 'admin' && !admin) return send(401, { error: 'admin token required' });

  let body = null;
  if (req.method === 'POST') {
    try { body = await readJson(req); } catch (e) { return send(400, { error: /** @type {Error} */ (e).message }); }
  }

  const match = route.pattern.exec(url.pathname) ?? [];
  const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
  try {
    const { status, body: out } = route.handler({ store, params, query: url.searchParams, body, user: /** @type {any} */ (user), admin });
    send(status, out);
  } catch (e) {
    console.error(e);
    send(500, { error: 'internal error' });
  }
});

server.listen(PORT, () => console.log(`tokenscore api on :${PORT}`));

if (process.env.TOKENSCORE_AUTO_RECOMPUTE === '1') {
  let lastWeek = '';
  const tick = () => {
    const week = isoWeek(Date.now());
    if (week === lastWeek) return;
    lastWeek = week;
    console.log('recompute', JSON.stringify(recompute(store)));
  };
  tick();
  setInterval(tick, 3_600_000).unref();
}

process.on('SIGINT', () => { server.close(); store.close(); process.exit(0); });
