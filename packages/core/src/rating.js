// @ts-check
/**
 * @module rating
 *
 * The relative layer: turns raw scores into a 300–850 rating that moves with
 * the cohort.
 *
 * Elo needs head-to-head matches, which don't exist here, so the mechanism is
 * percentile rank within the cohort — if everyone else improves, your rating
 * drops even though your raw score did not. Uncertainty is borrowed from
 * Glicko: each rating carries an `rd` (rating deviation) that shrinks with
 * activity and grows with inactivity. New users move quickly toward their
 * percentile; established users move slowly, which is what makes one bad
 * week survivable. A rating is only shown once `rd` is below {@link RD.rated}
 * — three consecutive active weeks from a cold start.
 */
import { clamp } from './stats.js';
import { hash32 } from './text.js';

export const RATING = Object.freeze({ min: 300, max: 850, initial: 575 });
export const RD = Object.freeze({
  /** cold start */ initial: 200,
  /** never more certain than this */ floor: 40,
  /** shown on leaderboards at or below this */ rated: 90,
  /** multiplied in after an active week */ decay: 0.75,
  /** added in quadrature after an inactive week */ growth: 35,
});

/**
 * Percentile rank of each value within the list, mid-rank for ties, shrunk
 * toward 0.5 by `prior` pseudo-observations so tiny cohorts don't hand out
 * 300s and 850s.
 * @param {number[]} values
 * @param {number} [prior]
 * @returns {number[]} aligned with `values`, each in (0, 1)
 */
export function percentileRanks(values, prior = 5) {
  const n = values.length;
  if (!n) return [];
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(n);
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && order[j + 1][0] === order[i][0]) j++;
    const p = n === 1 ? 0.5 : (i + (j - i) / 2) / (n - 1);
    const shrunk = (p * n + 0.5 * prior) / (n + prior);
    for (let k = i; k <= j; k++) out[order[k][1]] = shrunk;
    i = j + 1;
  }
  return out;
}

/**
 * @typedef {object} Rating
 * @property {number} rating  300..850
 * @property {number} rd      uncertainty, 40..200
 */

/**
 * Advance a rating by one week.
 * @param {Rating|null|undefined} prev  null for a new user
 * @param {number|null} percentile      null when the user was inactive this week
 * @returns {Rating}
 */
export function updateRating(prev, percentile) {
  const r = prev ?? { rating: RATING.initial, rd: RD.initial };
  if (percentile === null) {
    return { rating: r.rating, rd: Math.round(Math.min(RD.initial, Math.hypot(r.rd, RD.growth))) };
  }
  const target = RATING.min + (RATING.max - RATING.min) * percentile;
  const alpha = clamp(r.rd / RD.initial, 0.15, 1);
  return {
    rating: Math.round(clamp(r.rating + alpha * (target - r.rating), RATING.min, RATING.max)),
    rd: Math.round(Math.max(RD.floor, r.rd * RD.decay)),
  };
}

/** @param {number} rd */
export const isRated = (rd) => rd <= RD.rated;

/**
 * Deterministic ±amplitude noise keyed on (user, week), so a single action
 * can't be A/B tested against the displayed rating while the number stays
 * stable within a week.
 * @param {string} key
 * @param {number} [amplitude]
 */
export function jitter(key, amplitude = 2) {
  return Math.round(((hash32(key) % 2001) / 1000 - 1) * amplitude);
}
