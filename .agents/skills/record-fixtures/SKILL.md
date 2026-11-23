---
name: record-fixtures
description: Record a real browsing session and turn it into test fixtures. Recordings stay local; never commit them.
---

`tests/fixtures/` is gitignored because recordings contain real application pages. Without it
the tests use synthetic sessions (`scripts/make-synthetic.mjs`), which is what CI does. Real
recordings win when present: use them for a release check, not for CI.

1. Start the separate environment (`run-env` skill) and the frontend with replay on.
2. `node scripts/record-session.mjs` (env `FRONTEND_URL`, default `http://127.0.0.1:5173`).
3. Query Loki's `query_range` for the session and save the raw response, then
   `python3 scripts/export-fixtures.py <raw.json> <name>` from the repository root. It writes
   the logfmt shape and derives the flat JSON shape that production uses.
4. Check by hand that no real personal data is in the files before using them in a demo.
5. `npm run fixtures:push` loads them into the test stack's Loki for the e2e.
