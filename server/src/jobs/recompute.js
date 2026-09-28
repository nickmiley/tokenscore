// @ts-check
/**
 * @module jobs/recompute
 *
 * The weekly job. For every cohort (global plus one per platform):
 *
 *   1. aggregate each user's sessions from the trailing window
 *   2. score users with enough activity ({@link MIN_TURNS})
 *   3. rank their raw scores → percentile → new rating (uncertainty-weighted)
 *   4. carry inactive users forward with grown uncertainty
 *
 * Everything for one run happens in one transaction. The previous rating is
 * always read from a strictly earlier week, so re-running the job within the
 * same week overwrites that week's rows and is idempotent.
 *
 * Run directly:  node src/jobs/recompute.js [path/to.db]
 */
import { aggregateWindow, scoreWindow, MIN_TURNS } from '@tokenscore/core/scoring';
import { percentileRanks, updateRating, jitter, RATING } from '@tokenscore/core/rating';
import { median, slope, isoWeek, clamp } from '@tokenscore/core/stats';

/** @typedef {import('../db.js').Store} Store */
/** @typedef {import('@tokenscore/core/features').ConversationFeatures} ConversationFeatures */

/** Sessions updated within this many days count toward the score. */
export const WINDOW_DAYS = 28;
/** Sessions older than this are deleted at the end of a run. */
export const RETENTION_DAYS = 90;
/** Weeks of raw-score history fed to the trend factor. */
const TREND_WEEKS = 4;

/**
 * @param {Store} store
 * @param {number} [now]
 * @returns {{ week: string, cohorts: Record<string, number> }} users scored per cohort
 */
export function recompute(store, now = Date.now()) {
  const { q, transaction } = store;
  const week = isoWeek(now);
  const since = now - WINDOW_DAYS * 86_400_000;

  /** @type {Map<string, ConversationFeatures[]>} user → sessions */
  const byUser = new Map();
  /** @type {Set<string>} */
  const platforms = new Set();
  for (const row of q.sessionsSince.all(since)) {
    const s = /** @type {ConversationFeatures} */ (JSON.parse(String(row.features)));
    platforms.add(String(row.platform));
    let list = byUser.get(String(row.user_id));
    if (!list) byUser.set(String(row.user_id), (list = []));
    list.push(s);
  }

  const cohorts = ['global', ...platforms];
  /** @type {Record<string, number>} */
  const scored = {};

  transaction(() => {
    for (const cohort of cohorts) {
      /** @type {Array<{ userId: string, agg: import('@tokenscore/core/scoring').WindowAggregate, verbosity: number }>} */
      const active = [];
      for (const [userId, sessions] of byUser) {
        const agg = aggregateWindow(cohort === 'global' ? sessions : sessions.filter((s) => s.platform === cohort));
        if (agg.turns < MIN_TURNS) continue;
        active.push({ userId, agg, verbosity: agg.assistantMessages ? agg.assistantTokens / agg.assistantMessages : 0 });
      }

      const cohortVerbosity = median(active.map((a) => a.verbosity).filter((v) => v > 0)) || 1;
      const scores = active.map(({ userId, agg, verbosity }) => {
        const history = q.ratingHistory.all(userId, cohort, week, TREND_WEEKS).map((r) => Number(r.raw)).reverse();
        return scoreWindow(agg, { verbosityRatio: verbosity / cohortVerbosity || 1, trendSlope: slope(history) });
      });
      const percentiles = percentileRanks(scores.map((s) => s.raw));

      const activeIds = new Set();
      active.forEach(({ userId, agg }, i) => {
        activeIds.add(userId);
        const prev = q.ratingBefore.get(userId, cohort, week);
        const next = updateRating(prev ? { rating: Number(prev.rating), rd: Number(prev.rd) } : null, percentiles[i]);
        const shown = clamp(next.rating + jitter(`${userId}:${cohort}:${week}`), RATING.min, RATING.max);
        const s = scores[i];
        q.ratingUpsert.run(
          userId, cohort, week, s.raw, JSON.stringify(s.categories), JSON.stringify(s.factors),
          JSON.stringify(s.reasons), JSON.stringify(s.strengths), percentiles[i], shown, next.rd, agg.turns, now,
        );
      });

      // Users rated in earlier weeks but quiet in this window: uncertainty grows, rating holds.
      for (const row of q.ratingsUsersInCohort.all(cohort)) {
        const userId = String(row.user_id);
        if (activeIds.has(userId)) continue;
        const prev = q.ratingBefore.get(userId, cohort, week);
        if (!prev) continue;
        const next = updateRating({ rating: Number(prev.rating), rd: Number(prev.rd) }, null);
        q.ratingUpsert.run(userId, cohort, week, null, null, null, null, null, null, next.rating, next.rd, 0, now);
      }
      scored[cohort] = active.length;
    }
    q.sessionsPrune.run(now - RETENTION_DAYS * 86_400_000);
  });

  return { week, cohorts: scored };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { openDb } = await import('../db.js');
  const store = openDb(process.argv[2] ?? process.env.TOKENSCORE_DB ?? 'tokenscore.db');
  const result = recompute(store);
  console.log(JSON.stringify(result));
  store.close();
}
