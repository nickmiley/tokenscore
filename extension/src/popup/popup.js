// @ts-check
/**
 * @module popup/popup
 *
 * Renders the cached score immediately, then refreshes in the background.
 * Three tabs: Score (breakdown, reasons, this conversation's receipt),
 * Board (cohort leaderboard) and Team (manager view). All data comes through
 * the background worker; the popup never talks to the server directly.
 */
import { MSG, send } from '../lib/messages.js';
import { getSettings, updateSettings, getScore } from '../lib/storage.js';
import { estimateCost } from '../lib/pricing.js';
import { FACTOR_LABELS, STRENGTH_TIPS } from './labels.js';

const RATING_MIN = 300;
const RATING_MAX = 850;

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * Tiny element builder.
 * @param {string} tag
 * @param {Record<string, string>|null} attrs
 * @param {...(Node|string)} children
 */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

const fmt = new Intl.NumberFormat('en-US');
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 3 });

/** @param {string} label @param {string|number} value @param {string} [cls] @param {string} [sub] */
function ledgerRow(label, value, cls = '', sub) {
  const li = h('li', null, h('span', null, label), h('span', { class: 'lead' }), h('span', { class: `val ${cls}` }, String(value)));
  if (sub) li.append(h('span', { class: 'sub' }, sub));
  return li;
}

// ── Hero ────────────────────────────────────────────────────────────────────

/** @param {any} score  /v1/me/score payload or null */
function renderHero(score) {
  const g = score?.cohorts?.global;
  const num = $('rating');
  const status = $('status');
  if (!g) {
    num.textContent = '—';
    num.classList.add('unrated');
    status.textContent = 'No rating yet';
    setRuler(null);
    return;
  }
  num.textContent = String(g.rating);
  num.classList.toggle('unrated', !g.rated);
  status.textContent = g.rated
    ? `Rated, ${g.confidence}% confidence, week ${g.week.slice(-3)}`
    : `Provisional. Ratings settle after three active weeks (${g.confidence}% confidence).`;
  setRuler(g.rating);
}

/** @param {number|null} rating */
function setRuler(rating) {
  const pct = rating === null ? 0 : ((rating - RATING_MIN) / (RATING_MAX - RATING_MIN)) * 100;
  $('ruler-fill').style.width = `${pct}%`;
  $('ruler-mark').style.left = `${pct}%`;
}

// ── Score tab ───────────────────────────────────────────────────────────────

/** @param {any} score */
function renderBreakdown(score) {
  const g = score?.cohorts?.global;
  const list = $('categories');
  list.replaceChildren();
  if (!g?.categories) {
    list.append(h('li', { class: 'muted' }, 'Your breakdown appears after the first weekly calculation.'));
    return;
  }
  for (const [key, label] of Object.entries(score.categoryLabels)) {
    const v = g.categories[key];
    list.append(ledgerRow(label, v, v < 60 ? 'low' : v >= 85 ? 'high' : ''));
  }
}

/** @param {any} score */
function renderReasons(score) {
  const g = score?.cohorts?.global;
  const list = $('reasons');
  list.replaceChildren();
  const reasons = g?.reasons ?? [];
  const strengths = g?.strengths ?? [];
  $('reasons-title').textContent = reasons.length ? 'What is holding it back' : 'Where you stand';
  for (const r of reasons) {
    list.append(h('li', null, h('div', { class: 'code' }, FACTOR_LABELS[r.code] ?? r.code), h('div', { class: 'tip' }, r.tip)));
  }
  for (const code of strengths) {
    list.append(h('li', { class: 'strength' }, h('div', { class: 'code' }, FACTOR_LABELS[code] ?? code), h('div', { class: 'tip' }, STRENGTH_TIPS[code] ?? '')));
  }
  if (!reasons.length && !strengths.length) list.append(h('li', { class: 'muted', style: 'border:0;padding-left:0' }, 'Nothing to report yet.'));
}

async function renderReceipt() {
  const list = $('receipt');
  list.replaceChildren();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  /** @type {import('@tokenscore/core/features').ConversationFeatures|null} */
  let f = null;
  if (tab?.id) f = await chrome.tabs.sendMessage(tab.id, { type: MSG.RECEIPT_GET }).catch(() => null);
  if (!f) {
    list.append(h('li', { class: 'muted' }, 'Open a chat on a supported site to see its receipt.'));
    return;
  }
  const resent = f.effectiveTokens - f.visibleTokens;
  const bloat = f.visibleTokens ? f.effectiveTokens / f.visibleTokens : 1;
  list.append(
    ledgerRow('Messages you sent', fmt.format(f.turns)),
    ledgerRow('Replies', fmt.format(f.assistantMessages)),
    ledgerRow('Tokens on screen', fmt.format(f.visibleTokens)),
    ledgerRow('Context resent', fmt.format(resent), resent > f.visibleTokens * 2 ? 'low' : ''),
  );
  const total = ledgerRow('Effective tokens', fmt.format(f.effectiveTokens), '', `×${bloat.toFixed(1)} of what you see, about ${usd.format(estimateCost(f))} at list price`);
  total.classList.add('total');
  list.append(total);
  if (f.emptyCalorieTurns || f.nearDuplicatePrompts || f.repastedTokens) {
    const notes = [];
    if (f.emptyCalorieTurns) notes.push(`${f.emptyCalorieTurns} empty message${f.emptyCalorieTurns > 1 ? 's' : ''}`);
    if (f.nearDuplicatePrompts) notes.push(`${f.nearDuplicatePrompts} repeated prompt${f.nearDuplicatePrompts > 1 ? 's' : ''}`);
    if (f.repastedTokens) notes.push(`${fmt.format(f.repastedTokens)} re-pasted tokens`);
    list.append(h('li', { class: 'muted' }, notes.join(', ')));
  }
}

// ── Board tab ───────────────────────────────────────────────────────────────

/** @param {string} cohort */
async function renderBoard(cohort = 'global') {
  const root = $('board');
  root.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  const res = await send(MSG.LEADERBOARD_GET, { cohort });
  root.replaceChildren();
  if (res?.error) { root.append(h('p', { class: 'error' }, res.error)); return; }
  const select = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Cohort' }));
  for (const c of new Set(['global', ...(res.cohorts ?? [])])) {
    select.append(h('option', { value: c, ...(c === cohort ? { selected: '' } : {}) }, c === 'global' ? 'Everyone' : c));
  }
  select.addEventListener('change', () => renderBoard(select.value));
  root.append(select);
  if (!res.entries?.length) {
    root.append(h('p', { class: 'muted' }, 'No rated users in this cohort yet. Ratings need three active weeks.'));
    return;
  }
  const ol = h('ol', { class: 'board' });
  for (const e of res.entries) {
    ol.append(h('li', { class: e.you ? 'you' : '' }, h('span', { class: 'rank' }, String(e.rank)), h('span', { class: 'name' }, e.displayName), h('span', null, String(e.rating))));
  }
  root.append(ol, h('p', { class: 'muted', style: 'margin-top:8px' }, `Week ${res.week}`));
}

// ── Team tab ────────────────────────────────────────────────────────────────

async function renderTeam(categoryLabels) {
  const root = $('team');
  root.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  const res = await send(MSG.TEAMS_GET);
  root.replaceChildren();
  if (res?.error) { root.append(h('p', { class: 'error' }, res.error)); return; }
  if (!res.teams?.length) {
    root.append(h('p', { class: 'muted' }, 'You do not manage a team. Teams are created through the API (see README).'));
    return;
  }
  const keys = Object.keys(categoryLabels ?? {});
  for (const t of res.teams) {
    root.append(h('h2', null, t.name));
    const table = h('table', { class: 'team-table' });
    const head = h('tr', null, h('th', null, 'Member'), h('th', { class: 'n' }, 'Rating'));
    for (const k of keys) head.append(h('th', { class: 'n', title: categoryLabels[k] }, categoryLabels[k].split(' ')[0]));
    table.append(head);
    for (const m of t.members) {
      const g = m.cohorts?.global;
      const tr = h('tr', null, h('td', null, m.displayName, h('div', { class: 'muted' }, m.role)), h('td', { class: 'n' }, g ? `${g.rating}${g.rated ? '' : '*'}` : '—'));
      for (const k of keys) tr.append(h('td', { class: 'n' }, g?.categories ? String(g.categories[k]) : '—'));
      table.append(tr);
    }
    root.append(table);
  }
  root.append(h('p', { class: 'muted', style: 'margin-top:8px' }, '* provisional. Managers see scores, never chat content.'));
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function openSettings() { chrome.runtime.openOptionsPage(); }

/** @param {string} name */
function showTab(name) {
  for (const b of document.querySelectorAll('.tabs [role=tab]')) b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === name));
  for (const s of document.querySelectorAll('section[role=tabpanel]')) s.classList.toggle('hidden', s.getAttribute('data-tab') !== name);
}

/** @param {string} text */
function setSyncStatus(text) { $('sync-status').textContent = text; }

async function main() {
  const settings = await getSettings();
  $('consent').classList.toggle('hidden', settings.enabled);
  $('signin').classList.toggle('hidden', !settings.enabled || Boolean(settings.apiKey));

  const cached = await getScore();
  renderHero(cached);
  renderBreakdown(cached);
  renderReasons(cached);
  renderReceipt();
  setSyncStatus(cached?.fetchedAt ? `Updated ${Math.round((Date.now() - cached.fetchedAt) / 60000)} min ago` : 'Not synced yet');

  for (const b of document.querySelectorAll('.tabs [role=tab]')) {
    b.addEventListener('click', () => {
      const name = /** @type {string} */ (b.getAttribute('data-tab'));
      showTab(name);
      if (name === 'board') renderBoard();
      if (name === 'team') renderTeam(cached?.categoryLabels);
    });
  }
  $('enable').addEventListener('click', async () => { await updateSettings({ enabled: true }); location.reload(); });
  for (const id of ['open-settings', 'open-settings-consent', 'open-settings-signin']) $(id).addEventListener('click', openSettings);
  $('sync').addEventListener('click', refresh);

  if (settings.apiKey) refresh();
}

async function refresh() {
  setSyncStatus('Syncing…');
  const res = await send(MSG.SYNC_NOW);
  if (res?.error) { setSyncStatus(res.error === 'not signed in' ? 'Not connected' : `Sync failed: ${res.error}`); return; }
  renderHero(res.score);
  renderBreakdown(res.score);
  renderReasons(res.score);
  setSyncStatus('Updated just now');
}

main();
