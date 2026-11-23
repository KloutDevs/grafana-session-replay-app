---
name: release-plugin
description: Cut a release of the plugin (version, changelog, signed zip, GitHub release). Only when the user orders a release.
---

Run only on the user's explicit order; commits, pushes and publishing are outward actions.

1. Bump `version` in `package.json` and `package-lock.json`; add a section to `CHANGELOG.md`.
2. Run the `build-plugin` checks, then the e2e: `npm run server`, wait for Grafana on
   :13000, `npm run fixtures:push`, `npm run e2e`, `npm run server:down`. Uses synthetic sessions, or your local `tests/fixtures` if present.
3. Build the zip. Unsigned: `npm run package`. Signed: the user gives the token; run it
   inline for one command, never write it anywhere:
   `GRAFANA_ACCESS_POLICY_TOKEN=<token> SIGN_ROOT_URLS=<comma separated Grafana URLs> npm run package:signed`.
   A private signature is valid only for those URLs. If signing fails with 403, the token's
   policy lacks the `plugins:write` scope (type the full scope in "Additional scopes").
4. Check the signature if possible: unzip into a temp dir, start a Grafana with
   `GF_SERVER_ROOT_URL` set to one of the signed URLs and no unsigned allowance, and read
   `/api/plugins/<id>/settings` (`signature: valid`).
5. After the user approves: stage files by name (never `git add -A`), commit, push, `gh release create v<version>` with the zip and its
   `.sha256`. Pushing a `v*` tag also publishes (the Release workflow runs on it). The release notes say whether it is signed and for which URLs.
6. Tell the user to delete used tokens from their access policy.
