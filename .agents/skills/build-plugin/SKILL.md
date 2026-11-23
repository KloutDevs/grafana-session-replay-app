---
name: build-plugin
description: Build the Grafana plugin (typecheck, lint, unit tests, production build) before packaging or reporting work as done.
---

Follow `.config/AGENTS/skills/build-plugin.md` for the generic Grafana steps. In this repository:

1. `npm run typecheck`, `npm run lint`, `npx prettier --check .`, `npm run test:ci`.
2. `npm run build` (webpack, config in `.config/`, never edit it).
3. There is no backend: skip the mage steps.

Report what ran and what did not. Without `tests/fixtures` the tests use synthetic sessions;
say which data the run used.
