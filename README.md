# TokenScore

A credit score for how efficiently you spend AI tokens.

A Chrome extension watches your chats on ChatGPT, Claude, Gemini and Copilot, measures how much *effective* context each conversation burns (every message resends the whole thread), and reduces it to numbers. A small server turns those numbers into a 300–850 rating that is relative to everyone else, shows you which habits are dragging it down, runs leaderboards per platform, and gives managers a team view that contains scores and nothing else.

```
tokenscore/
├── packages/core/   pure library shared by both sides (tested)
│   ├── tokenizer.js   fast token estimator, pluggable
│   ├── text.js        hashing, shingles, similarity, prompt/reply classifiers
│   ├── features.js    conversation → numeric feature vector      ← runs in the page
│   ├── scoring.js     feature window → composite score + reasons ← server only
│   └── rating.js      percentile → 300–850 with uncertainty      ← server only
├── extension/       Manifest V3, esbuild, no runtime dependencies
│   └── src/
│       ├── adapters/  one declarative selector set per platform
│       ├── content/   observer → tracker → background; in-page nudge
│       ├── background/ storage, 15-minute sync, API client
│       ├── popup/     rating, breakdown, reasons, receipt, board, team
│       └── options/   consent, server, account
└── server/          node:http + node:sqlite, zero dependencies
    └── src/
        ├── api.js        routes
        ├── validate.js   allow-list rebuild of every incoming session
        ├── db.js         schema and prepared statements
        └── jobs/recompute.js  the weekly job
```

## Privacy model

The line is drawn at `packages/core/src/features.js`. Everything above it (DOM reading, tokenising, similarity) runs inside the chat tab. What crosses the line is a `ConversationFeatures` object: counts and token totals, a coarse model tier, a project flag, and a hashed conversation id. The server rebuilds every incoming object field by field from an allow-list (`server/src/validate.js`); a string that is not on the list does not get stored, even if a modified client sends it.

Consequences worth stating plainly:

- Managers see ratings, category scores and reason codes for their team members. They cannot see prompts, replies, titles or URLs, because the server never has them.
- Nothing is observed until the user clicks *Start measuring*. Turning it off stops the observer immediately.
- Clipboard contents are never read. Copy detection measures the length of the current selection and discards it.
- If you deploy this at work, tell people what is measured and why, and check local law on workplace monitoring before enabling the team view.

## Setup

Requires Node 22.13+ (for the built-in SQLite driver) and Chrome 120+.

```bash
npm install
npm test                                     # core library
TOKENSCORE_ADMIN_TOKEN=change-me npm run server   # API on :8787, creates tokenscore.db
npm run build                                # extension → extension/dist/
```

Load `extension/dist/` as an unpacked extension (chrome://extensions → Developer mode → Load unpacked). Open the popup, click *Start measuring*, then *Connect* → *Create my account*. Sessions sync every 15 minutes or when you press *Sync*.

Server environment:

| Variable | Default | Purpose |
|---|---|---|
| `TOKENSCORE_PORT` | `8787` | |
| `TOKENSCORE_DB` | `./tokenscore.db` | SQLite file (WAL mode) |
| `TOKENSCORE_ADMIN_TOKEN` | unset | required for `POST /v1/admin/recompute` |
| `TOKENSCORE_AUTO_RECOMPUTE` | unset | `1` runs the weekly job automatically when a new ISO week begins |

Run the job by hand with `npm run recompute` or `curl -X POST -H "Authorization: Bearer $TOKENSCORE_ADMIN_TOKEN" localhost:8787/v1/admin/recompute`.

## How the score works

**Effective tokens, not visible tokens.** A 20-turn thread that grows by a thousand tokens per turn shows ~20k tokens on screen but costs ~200k, because each turn resends everything before it. `effectiveTokens / visibleTokens` (the bloat ratio) is the single strongest signal and the first thing the popup's receipt shows.

**Seventeen factors in five categories.** Each factor maps the user's trailing 28-day window to 0–100 through a saturating curve (`packages/core/src/scoring.js`):

| Category | Weight | Factors |
|---|---|---|
| Context efficiency | 30% | bloat ratio, empty messages ("ok", "thanks"), regenerations, near-duplicate prompts, re-pasted paragraphs |
| Prompt quality | 25% | specificity signals, replies that had to ask for clarification, drip-fed context, topic drift |
| Output use | 20% | replies copied, fraction of output copied, reply length vs cohort median, stopped replies |
| Model fit | 15% | heavy model on trivial prompts, use of projects / custom instructions |
| Habits | 10% | week-over-week trend, consistency across sessions |

**Relative rating.** Raw scores are ranked within a cohort (global, plus one per platform) each week. Percentile → 300–850, shrunk toward the middle for tiny cohorts. Each rating carries a Glicko-style uncertainty that shrinks with activity and grows when idle: new users move to their percentile quickly, established users move slowly, so a single bad week does not crater a settled score — but if everyone else improves, yours drops. A rating is *provisional* until three active weeks have passed, and users with fewer than 20 turns in the window are not scored at all, so not using AI never ranks well.

**Reasons, not weights.** The API returns every factor's score plus the three factors dragging the composite down most (with a plain-English tip) and the two contributing most. Users can see *what* to fix without seeing *how much* each thing counts.

## Secrecy and anti-gaming

- The extension bundle contains feature extraction only. `scoring.js` and `rating.js` are imported nowhere in `extension/src`, and esbuild's tree-shaking keeps them out of `dist/` (`grep CATEGORY_WEIGHTS dist/*.js` returns nothing).
- Ratings recompute weekly, and a deterministic ±2 jitter keyed on (user, cohort, week) stops A/B testing a single habit against the displayed number.
- Every reward curve is concave and capped, so farming one factor flattens fast; every penalty is a rate, so volume does not help.
- The obvious gaming vector is copy events. They are capped per message, counted once per copy, and limited to 20% of the composite. Treat output-use scores as directional.

## Keeping adapters current

Providers change their DOM without notice. Each adapter in `extension/src/adapters/index.js` is a set of selector strings; most have an `aria-label` fallback after the test-id. If a platform stops working, open a conversation, wait fifteen seconds, and look for `[TokenScore] No messages recognised on …` in the page console — then fix the selector. The observer and event capture never need to change.

## Team API

Teams are managed through the API for now (no UI). The manager's key creates the team and adds members by user id; members find their id in the options page after connecting.

```bash
KEY=ts_...   # manager's API key
curl -s -X POST localhost:8787/v1/teams -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' -d '{"name":"Platform"}'
curl -s -X POST localhost:8787/v1/teams/$TEAM/members -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' -d '{"userId":"..."}'
curl -s localhost:8787/v1/teams/$TEAM -H "Authorization: Bearer $KEY"
```

The manager sees the same payload the member sees in their own popup: rating, category scores, reason codes. The popup's *Team* tab renders it.

## Known limits

- **Token counts are estimates.** The heuristic tokenizer is within ~12% on prose and ~20% on code — fine for ranking, not for billing. Call `setTokenizer()` with an exact BPE implementation if you need better.
- **Topic drift and near-duplicates are lexical** (word shingles, content-word overlap). They catch the obvious cases and miss paraphrases.
- **Output use is measured by copying.** Reading an explanation and acting on it looks like unused output. This is why the category is capped at 20%.
- **Model detection reads the selector's label.** Unknown labels fall back to `unknown` and never count against anyone.
- **No icons ship**; add `icons/` and an `icons` block to `manifest.json` before publishing.
- **Not measured yet**: tool fit (using search where search was warranted), abandonment (leaving a thread mid-reply). Both need signals the page does not reliably expose.

## API reference

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/v1/users` | — | `{displayName, role}` → `{userId, apiKey}` |
| `GET` | `/v1/me` | user | |
| `POST` | `/v1/sessions` | user | `{sessions: ConversationFeatures[]}`, ≤200 per call |
| `GET` | `/v1/me/score` | user | latest rating per cohort with breakdown |
| `GET` | `/v1/leaderboard?cohort=&limit=` | user | rated users only |
| `POST` | `/v1/teams` | user | caller becomes manager |
| `GET` | `/v1/me/teams` | user | |
| `POST` | `/v1/teams/:id/members` | manager | `{userId}` |
| `DELETE` | `/v1/teams/:id/members/:userId` | manager | |
| `GET` | `/v1/teams/:id` | manager | members with scores |
| `POST` | `/v1/admin/recompute` | admin | runs the weekly job now; idempotent within a week |
