---
name: run-env
description: Start, check or stop the separate environment (Grafana, Loki, Alloy and the plugin from its release zip).
---

- `npm run env:up` builds the release zip, extracts it and starts Grafana :14000, Loki :14100
  and Alloy (Faro receiver) :14347. `npm run env:down` stops it. `scripts/env.sh status` shows
  it. `scripts/env.sh secrets` prints the generated admin password and Faro key: agents must
  not run it; ask the user to.
- The environment installs the plugin the way an administrator would, so a rebuilt plugin only
  appears after `env:down` and `env:up`.
- To get data into it, serve the QuickAction frontend with replay on and
  `VITE_FARO_URL=http://127.0.0.1:14347/collect`, then run `node scripts/record-session.mjs`
  (see the `record-fixtures` skill).
- Its URL is `http://127.0.0.1:14000`, which is not a signed root URL: it runs the unsigned
  build.
