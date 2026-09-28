// @ts-check
/**
 * @module scoring
 *
 * Composite efficiency score, computed on the server over a rolling window of
 * a user's sessions.
 *
 * This module is deliberately not imported by the extension bundle. The
 * extension ships feature extraction only, so the weights and thresholds
 * below never reach a client. Users see factor *scores* and reason codes, not
 * how they combine (see README › Secrecy and anti-gaming).
 *
 * Each factor maps a {@link WindowAggregate} to 0..100 (higher is better)
 * through a saturating curve, so no single behaviour can be farmed linearly.
 */
import { stddev, clamp } from './stats.js';

/** @typedef {import('./features.js').ConversationFeatures} ConversationFeatures */
/** @typedef {'context'|'prompt'|'output'|'modelFit'|'habits'} Category */

/** Category weights. Sum to 1. */
export const CATEGORY_WEIGHTS = /** @type {Record<Category, number>} */ ({
  context: 0.30,
  prompt: 0.25,
  output: 0.20,
  modelFit: 0.15,
  habits: 0.10,
});

/** Human labels for categories, safe to expose. */
export const CATEGORY_LABELS = /** @type {Record<Category, string>} */ ({
  context: 'Context efficiency',
  prompt: 'Prompt quality',
  output: 'Output use',
  modelFit: 'Model fit',
  habits: 'Habits',
});

/** Fewer user turns than this in the window → unrated for that week. */
export const MIN_TURNS = 20;

/**
 * Sums over a user's sessions in the window, plus the per-session series the
 * consistency factor needs.
 *
 * @typedef {object} WindowAggregate
 * @property {number} sessions
 * @property {number} multiTurnSessions
 * @property {number} projectSessions
 * @property {number} turns
 * @property {number} assistantMessages
 * @property {number} userTokens
 * @property {number} assistantTokens
 * @property {number} visibleTokens
 * @property {number} effectiveTokens
 * @property {number} emptyCalorieTurns
 * @property {number} nearDuplicatePrompts
 * @property {number} repastedTokens
 * @property {number} topicShifts
 * @property {number} substantivePrompts
 * @property {number} specificitySum
 * @property {number} clarifications
 * @property {number} frontLoadSum      Σ over multi-turn sessions of firstTurnUserTokens / userTokens
 * @property {number} trivialPromptsOnHeavy
 * @property {number} regenerations
 * @property {number} stops
 * @property {number} copyEvents
 * @property {number} copiedTokens
 * @property {number[]} bloatValues     effectiveTokens / visibleTokens per session
 */

/**
 * @param {ConversationFeatures[]} sessions
 * @returns {WindowAggregate}
 */
export function aggregateWindow(sessions) {
  const a = /** @type {WindowAggregate} */ ({
    sessions: 0, multiTurnSessions: 0, projectSessions: 0, turns: 0, assistantMessages: 0,
    userTokens: 0, assistantTokens: 0, visibleTokens: 0, effectiveTokens: 0, emptyCalorieTurns: 0,
    nearDuplicatePrompts: 0, repastedTokens: 0, topicShifts: 0, substantivePrompts: 0,
    specificitySum: 0, clarifications: 0, frontLoadSum: 0, trivialPromptsOnHeavy: 0,
    regenerations: 0, stops: 0, copyEvents: 0, copiedTokens: 0, bloatValues: [],
  });
  for (const s of sessions) {
    if (!s.turns) continue;
    a.sessions++;
    if (s.inProject) a.projectSessions++;
    if (s.turns >= 2 && s.userTokens > 0) {
      a.multiTurnSessions++;
      a.frontLoadSum += s.firstTurnUserTokens / s.userTokens;
    }
    a.turns += s.turns;
    a.assistantMessages += s.assistantMessages;
    a.userTokens += s.userTokens;
    a.assistantTokens += s.assistantTokens;
    a.visibleTokens += s.visibleTokens;
    a.effectiveTokens += s.effectiveTokens;
    a.emptyCalorieTurns += s.emptyCalorieTurns;
    a.nearDuplicatePrompts += s.nearDuplicatePrompts;
    a.repastedTokens += s.repastedTokens;
    a.topicShifts += s.topicShifts;
    a.substantivePrompts += s.substantivePrompts;
    a.specificitySum += s.specificitySum;
    a.clarifications += s.clarifications;
    a.trivialPromptsOnHeavy += s.trivialPromptsOnHeavy;
    a.regenerations += s.regenerations;
    a.stops += s.stops;
    a.copyEvents += s.copyEvents;
    a.copiedTokens += s.copiedTokens;
    if (s.visibleTokens > 0) a.bloatValues.push(s.effectiveTokens / s.visibleTokens);
  }
  return a;
}

/**
 * Cohort-relative inputs the recompute job supplies.
 * @typedef {object} ScoreContext
 * @property {number} verbosityRatio  user's mean reply length ÷ cohort median; 1 is typical
 * @property {number} trendSlope      change in raw score per week over recent weeks
 */

/**
 * @typedef {object} FactorDef
 * @property {string} code
 * @property {Category} category
 * @property {number} weight          within its category; category weights sum to 1
 * @property {string} tip             shown to the user when this factor is a top reason
 * @property {(a: WindowAggregate, c: ScoreContext) => number} compute  0..100
 */

const rate = (n, d) => (d > 0 ? n / d : 0);
/** 100 at rate 0, falling linearly to 0 at `zeroAt`. */
const penalty = (r, zeroAt) => 100 * (1 - clamp(r / zeroAt, 0, 1));
/** 0 at 0, saturating to 100 at `full`; concave so early gains count most and farming flattens. */
const reward = (x, full) => 100 * Math.sqrt(clamp(x / full, 0, 1));

/** @type {FactorDef[]} */
export const FACTORS = [
  // ── Context efficiency ───────────────────────────────────────────────────
  {
    code: 'CONTEXT_BLOAT', category: 'context', weight: 0.40,
    tip: 'Start a new chat when the topic changes. Every message resends the whole thread.',
    compute: (a) => {
      const bloat = rate(a.effectiveTokens, a.visibleTokens) || 1;
      return 100 / (1 + ((bloat - 1) / 4) ** 2);
    },
  },
  {
    code: 'EMPTY_MESSAGES', category: 'context', weight: 0.15,
    tip: 'Skip standalone "ok", "thanks" and "continue". Each one resends the full context for nothing.',
    compute: (a) => penalty(rate(a.emptyCalorieTurns, a.turns), 0.25),
  },
  {
    code: 'REGENERATIONS', category: 'context', weight: 0.15,
    tip: 'Edit the prompt instead of regenerating. The same prompt mostly gets the same answer.',
    compute: (a) => penalty(rate(a.regenerations, a.turns), 0.3),
  },
  {
    code: 'REPEATED_PROMPTS', category: 'context', weight: 0.15,
    tip: 'When a reply misses, say what was wrong rather than sending the same ask again.',
    compute: (a) => penalty(rate(a.nearDuplicatePrompts, a.turns), 0.3),
  },
  {
    code: 'REPASTED_CONTENT', category: 'context', weight: 0.15,
    tip: 'Content already in the thread is still there. Refer to it instead of pasting it again.',
    compute: (a) => penalty(rate(a.repastedTokens, a.userTokens), 0.4),
  },
  // ── Prompt quality ───────────────────────────────────────────────────────
  {
    code: 'VAGUE_PROMPTS', category: 'prompt', weight: 0.40,
    tip: 'State the format, length, audience and constraints up front.',
    compute: (a) => 100 * rate(a.specificitySum, a.substantivePrompts),
  },
  {
    code: 'CLARIFICATIONS', category: 'prompt', weight: 0.25,
    tip: 'If the model keeps asking what you mean, the prompt is missing context it needed.',
    compute: (a) => penalty(rate(a.clarifications, a.assistantMessages), 0.3),
  },
  {
    code: 'DRIP_FED_CONTEXT', category: 'prompt', weight: 0.20,
    tip: 'Put the background in the first message instead of adding it turn by turn.',
    compute: (a) => 100 * (a.multiTurnSessions ? a.frontLoadSum / a.multiTurnSessions : 1),
  },
  {
    code: 'TOPIC_DRIFT', category: 'prompt', weight: 0.15,
    tip: 'Unrelated questions belong in a fresh thread.',
    compute: (a) => penalty(rate(a.topicShifts, a.turns), 0.3),
  },
  // ── Output use ───────────────────────────────────────────────────────────
  {
    code: 'UNUSED_OUTPUT', category: 'output', weight: 0.35,
    tip: 'Most replies were never copied or used. Ask for less, or ask only when you need it.',
    compute: (a) => reward(rate(a.copyEvents, a.assistantMessages), 0.4),
  },
  {
    code: 'OVERSIZED_REQUESTS', category: 'output', weight: 0.30,
    tip: 'You use a small fraction of what you ask for. Request the part you need.',
    compute: (a) => reward(rate(a.copiedTokens, a.assistantTokens), 0.5),
  },
  {
    code: 'VERBOSE_REPLIES', category: 'output', weight: 0.25,
    tip: 'Replies run long compared with your peers. Say how long the answer should be.',
    compute: (_, c) => 100 * clamp(0.85 - (c.verbosityRatio - 1) / 2, 0, 1),
  },
  {
    code: 'STOPPED_REPLIES', category: 'output', weight: 0.10,
    tip: 'Stopping mid-reply throws away what was generated. Tighten the ask instead.',
    compute: (a) => penalty(rate(a.stops, a.assistantMessages), 0.3),
  },
  // ── Model fit ────────────────────────────────────────────────────────────
  {
    code: 'HEAVY_MODEL_TRIVIAL', category: 'modelFit', weight: 0.60,
    tip: 'Use a lighter model or mode for quick, simple questions.',
    compute: (a) => penalty(rate(a.trivialPromptsOnHeavy, a.turns), 0.2),
  },
  {
    code: 'NO_REUSABLE_CONTEXT', category: 'modelFit', weight: 0.40,
    tip: 'Put background you repeat into a project or custom instructions.',
    compute: (a) => reward(rate(a.projectSessions, a.sessions), 0.3),
  },
  // ── Habits ───────────────────────────────────────────────────────────────
  {
    code: 'TREND', category: 'habits', weight: 0.60,
    tip: 'Your efficiency is trending down week over week.',
    // Flat or no history sits at 85 (neither a reason nor a penalty); −5 pts/week lands at 70.
    compute: (_, c) => 100 * clamp(0.85 + c.trendSlope / 33, 0, 1),
  },
  {
    code: 'INCONSISTENT', category: 'habits', weight: 0.40,
    tip: 'Efficiency swings a lot between sessions. Aim for the same habits every time.',
    compute: (a) => penalty(stddev(a.bloatValues), 3),
  },
];

/** A factor's score is a top reason only below this. */
const REASON_BELOW = 70;
/** A factor's score is a strength only at or above this. */
const STRENGTH_FROM = 85;

/**
 * @typedef {object} FactorScore
 * @property {string} code
 * @property {Category} category
 * @property {number} score  0..100
 */

/**
 * @typedef {object} WindowScore
 * @property {number} raw                          0..100 composite
 * @property {Record<Category, number>} categories 0..100 each
 * @property {FactorScore[]} factors               every factor, scores only
 * @property {Array<{code: string, tip: string}>} reasons   up to 3 factors dragging the score down most
 * @property {string[]} strengths                  up to 2 factor codes contributing most
 */

/**
 * Score one user's window.
 * @param {WindowAggregate} agg
 * @param {ScoreContext} ctx
 * @returns {WindowScore}
 */
export function scoreWindow(agg, ctx) {
  const categories = /** @type {Record<Category, number>} */ ({ context: 0, prompt: 0, output: 0, modelFit: 0, habits: 0 });
  /** @type {FactorScore[]} */ const factors = [];
  /** @type {Array<{code: string, tip: string, deficit: number, strength: number, score: number}>} */ const ranked = [];

  for (const f of FACTORS) {
    const score = clamp(f.compute(agg, ctx), 0, 100);
    const global = CATEGORY_WEIGHTS[f.category] * f.weight;
    categories[f.category] += f.weight * score;
    factors.push({ code: f.code, category: f.category, score: Math.round(score) });
    ranked.push({ code: f.code, tip: f.tip, score, deficit: global * (100 - score), strength: global * score });
  }

  let raw = 0;
  for (const c of /** @type {Category[]} */ (Object.keys(categories))) {
    categories[c] = Math.round(categories[c]);
    raw += CATEGORY_WEIGHTS[c] * categories[c];
  }

  const reasons = ranked
    .filter((r) => r.score < REASON_BELOW)
    .sort((x, y) => y.deficit - x.deficit)
    .slice(0, 3)
    .map(({ code, tip }) => ({ code, tip }));

  const strengths = ranked
    .filter((r) => r.score >= STRENGTH_FROM)
    .sort((x, y) => y.strength - x.strength)
    .slice(0, 2)
    .map((r) => r.code);

  return { raw: Math.round(raw * 10) / 10, categories, factors, reasons, strengths };
}
