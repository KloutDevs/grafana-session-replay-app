# AGENTS.md

A **Grafana app plugin** (`escalia-sessionreplay-app`) that lists and replays browser
sessions recorded with Faro + rrweb and stored in Loki. It reads Loki only through
Grafana's datasource API, in JSON or logfmt. This file is the single source of truth for
every coding agent; `CLAUDE.md` and `GEMINI.md` import it.

Read `.config/AGENTS/instructions.md` before changing code (Grafana plugin rules, docs
index) and `.config/AGENTS/e2e-testing.md` before touching e2e tests. Your Grafana API
knowledge is out of date: fetch the docs it points to.

## Rules that are specific to this repository

- **Never edit `.config/`.** Grafana's tooling owns it and overwrites it on update.
  Extend configs from the root files instead.
- **The plugin id is `<grafana.com org slug>-sessionreplay-app`.** Signing fails if the
  prefix is not the slug of the signing organization. Do not change it unless the user
  asks; if they do, change it everywhere (`src/plugin.json`, `env/`, `tests/stack/`,
  docs, provisioning files) and rebuild.
- **This repository is public.** Never commit secrets, tokens, real recordings, internal
  hostnames or customer data. `openspec/` and `tests/fixtures/` are gitignored on purpose.
- **Access tokens** (`GRAFANA_ACCESS_POLICY_TOKEN`) are passed as an environment variable
  for one command only. Never write them to a file, log or message. Signing is done locally
  by the user: do not add secrets to the GitHub workflows and do not upload logs or
  artifacts that could contain them (the repository is public).
- **Agents must not run `scripts/env.sh secrets`**: it prints the environment's admin
  password and Faro key into the transcript. Ask the user to run it.
- Stage files by name; never `git add -A` or `git add .`, because `tests/fixtures/`,
  `env/.env` and `release/` are protected only by `.gitignore`.
- Pushing a `v*` tag publishes a release (`.github/workflows/release.yml`), exactly like
  `gh release create`. Treat both as publishing.
- Fetch web pages only from `grafana.com`, `developers.grafana.com` and this repository's
  own GitHub pages.
- **Commit, push, merge and publish a release only when the user orders it.**
- Read Loki only through `/api/ds/query`; never call another host or store replay content.
  Find data with a text line filter first, then parse; never require a `kind`, `replay` or
  `source` stream label.
- Keep `@grafana/rrweb` pinned to the exact version that `@grafana/faro-instrumentation-replay`
  depends on (2.0.0-grafana.2 with Faro 2.14); recheck it when Faro is upgraded.
- Page access requires the Editor role. Replay text is already masked in the browser;
  do not add features that bypass that.
- Source, identifiers and docs are in English. The plugin UI copy is English too.

## Commands

| Task                                     | Command                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Typecheck / lint / format                | `npm run typecheck` / `npm run lint` / `npx prettier --check .`                    |
| Unit tests                               | `npm run test:ci`                                                                  |
| Build                                    | `npm run build`                                                                    |
| Unsigned release zip                     | `npm run package` (output in `release/`)                                           |
| Signed zip                               | `SIGN_ROOT_URLS=<urls> GRAFANA_ACCESS_POLICY_TOKEN=<token> npm run package:signed` |
| Test stack (Grafana :13000, Loki :13100) | `npm run server` / `npm run server:down`                                           |
| Load recordings into it                  | `npm run fixtures:push`, then `npm run e2e`                                        |
| Separate environment (Grafana :14000)    | `npm run env:up` / `npm run env:down`                                              |

`npm run package:signed` builds first and signs before zipping; running `npm run package`
afterwards rebuilds and drops the signature.

## Layout

- `src/data`: Loki access (`lokiClient`, `logql`, `windowedQuery`), loading and playback.
- `src/domain`: types and the time model. `src/hooks`, `src/pages`, `src/components`: UI.
- `src/testing/fakeLoki.ts`: an in-memory Loki that behaves like the real limits.
- `tests/`: Playwright specs. `tests/stack/` and `env/`: Docker stacks. `scripts/`: tooling.

## Domain facts that are easy to get wrong

- A replay chunk is `(recordingId, gen)` and starts with a Meta event and a full snapshot.
  `seq` is a per-recording counter; a `started` marker repeats on every restart.
- Loki time is used for queries; the browser clock orders the timeline. `?t` is the
  milliseconds on the browser clock since the first recorded event, gaps included; the
  player shows recorded time with gaps skipped.
- Loki rejects `limit` above `max_entries_limit_per_query`, so queries page by the last
  line's time. Lines can reach about 500 KB (full snapshots): Loki needs `max_line_size`.
- Stream labels differ per deployment (production: `service_name="frontend"`, JSON lines;
  the test stack: `source=~"faro|faro_replay"`, logfmt). The `format` and `selector`
  settings select them.

## Tests

- Unit tests live next to the code (`__tests__`).
- Without local recordings (`tests/fixtures`, never published) the tests use synthetic
  sessions generated by `scripts/make-synthetic.mjs` into `tests/synthetic/` (gitignored,
  regenerated by Jest's global setup and by `npm run fixtures:push`). Real recordings in
  `tests/fixtures` win when present; run with them before a release.
- e2e needs the Docker test stack (`tests/stack/`: Grafana :13000, Loki :13100) and runs the
  same way locally and in CI (`playwright-tests` job in `.github/workflows/ci.yml`):
  `npm run server`, `npm run fixtures:push`, `npm run e2e`, `npm run server:down`. The stack's
  Grafana image is pinned by digest in `tests/stack/compose.yaml`; the `GRAFANA_VERSION`
  variable in `.config/AGENTS/e2e-testing.md` does not apply. Pushing synthetic sessions twice
  to the same Loki duplicates them: run `npm run server:down` (it removes the volumes) first.
  Do not run Jest and `fixtures:push` at the same time (both write `tests/synthetic`).
- Do not weaken a test to make it pass; report why it fails.

## Skills

Canonical skills live in `.agents/skills/`. `.claude/skills` and `.codex/skills` are
symlinks to it, so edit only `.agents/skills/`. Available: `build-plugin`,
`validate-plugin`, `release-plugin`, `run-env`, `record-fixtures`.
