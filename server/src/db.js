// @ts-check
/**
 * @module db
 *
 * SQLite via the built-in `node:sqlite` driver. WAL mode for concurrent reads
 * while the weekly job writes; every query is a prepared statement created
 * once at open.
 *
 * Tables
 *   users         one row per account; API key stored as a SHA-256 hash
 *   sessions      latest feature snapshot per (user, conversation); numbers only
 *   ratings       one row per (user, cohort, ISO week); the leaderboard reads the newest week
 *   teams         manager → team
 *   team_members  team → user
 */
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  api_key_hash  TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'general',
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  user_id          TEXT NOT NULL REFERENCES users(id),
  conversation_id  TEXT NOT NULL,
  platform         TEXT NOT NULL,
  features         TEXT NOT NULL,
  turns            INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (user_id, conversation_id)
);
CREATE INDEX IF NOT EXISTS sessions_updated ON sessions(updated_at);
CREATE TABLE IF NOT EXISTS ratings (
  user_id      TEXT NOT NULL REFERENCES users(id),
  cohort       TEXT NOT NULL,
  week         TEXT NOT NULL,
  raw          REAL,
  categories   TEXT,
  factors      TEXT,
  reasons      TEXT,
  strengths    TEXT,
  percentile   REAL,
  rating       INTEGER NOT NULL,
  rd           INTEGER NOT NULL,
  turns        INTEGER NOT NULL DEFAULT 0,
  computed_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, cohort, week)
);
CREATE INDEX IF NOT EXISTS ratings_board ON ratings(cohort, week, rating DESC);
CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  manager_id  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS team_members (
  team_id  TEXT NOT NULL REFERENCES teams(id),
  user_id  TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (team_id, user_id)
);
`;

/**
 * @param {string} path  file path or ':memory:'
 */
export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const q = {
    insertUser: db.prepare('INSERT INTO users (id, api_key_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)'),
    userByKey: db.prepare('SELECT id, display_name, role FROM users WHERE api_key_hash = ?'),
    userById: db.prepare('SELECT id, display_name, role FROM users WHERE id = ?'),

    sessionGet: db.prepare('SELECT features FROM sessions WHERE user_id = ? AND conversation_id = ?'),
    sessionUpsert: db.prepare(`
      INSERT INTO sessions (user_id, conversation_id, platform, features, turns, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, conversation_id) DO UPDATE SET
        platform = excluded.platform, features = excluded.features, turns = excluded.turns, updated_at = excluded.updated_at`),
    sessionsSince: db.prepare('SELECT user_id, platform, features FROM sessions WHERE updated_at >= ?'),
    sessionsPrune: db.prepare('DELETE FROM sessions WHERE updated_at < ?'),

    ratingBefore: db.prepare('SELECT rating, rd, week FROM ratings WHERE user_id = ? AND cohort = ? AND week < ? ORDER BY week DESC LIMIT 1'),
    ratingHistory: db.prepare('SELECT raw FROM ratings WHERE user_id = ? AND cohort = ? AND week < ? AND raw IS NOT NULL ORDER BY week DESC LIMIT ?'),
    ratingLatestPerCohort: db.prepare(`
      SELECT r.* FROM ratings r
      JOIN (SELECT cohort, MAX(week) AS week FROM ratings WHERE user_id = ? GROUP BY cohort) m
        ON r.cohort = m.cohort AND r.week = m.week
      WHERE r.user_id = ?`),
    ratingsLatestWeekForCohort: db.prepare('SELECT MAX(week) AS week FROM ratings WHERE cohort = ?'),
    ratingsUsersInCohort: db.prepare('SELECT DISTINCT user_id FROM ratings WHERE cohort = ?'),
    ratingUpsert: db.prepare(`
      INSERT INTO ratings (user_id, cohort, week, raw, categories, factors, reasons, strengths, percentile, rating, rd, turns, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, cohort, week) DO UPDATE SET
        raw = excluded.raw, categories = excluded.categories, factors = excluded.factors, reasons = excluded.reasons,
        strengths = excluded.strengths, percentile = excluded.percentile, rating = excluded.rating, rd = excluded.rd,
        turns = excluded.turns, computed_at = excluded.computed_at`),
    leaderboard: db.prepare(`
      SELECT u.display_name, r.rating, r.rd, r.user_id FROM ratings r JOIN users u ON u.id = r.user_id
      WHERE r.cohort = ? AND r.week = ? AND r.rd <= ? ORDER BY r.rating DESC, u.display_name LIMIT ?`),
    cohorts: db.prepare('SELECT DISTINCT cohort FROM ratings'),

    teamInsert: db.prepare('INSERT INTO teams (id, name, manager_id, created_at) VALUES (?, ?, ?, ?)'),
    teamById: db.prepare('SELECT id, name, manager_id FROM teams WHERE id = ?'),
    teamsManagedBy: db.prepare('SELECT id, name FROM teams WHERE manager_id = ? ORDER BY name'),
    memberInsert: db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)'),
    memberDelete: db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?'),
    members: db.prepare('SELECT u.id, u.display_name, u.role FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ? ORDER BY u.display_name'),
  };

  /**
   * Run `fn` inside a transaction; rolls back on throw.
   * @template T
   * @param {() => T} fn
   * @returns {T}
   */
  function transaction(fn) {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  return { db, q, transaction, close: () => db.close() };
}

/** @typedef {ReturnType<typeof openDb>} Store */
