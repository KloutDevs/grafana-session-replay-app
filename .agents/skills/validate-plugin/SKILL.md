---
name: validate-plugin
description: Validate the plugin zip with the official Grafana plugin validator before a release.
---

Follow `.config/AGENTS/skills/validate-plugin.md` for the validator steps, except the zip step, which this skill overrides: create the zip with `npm run package`
(or `npm run package:signed` for a signed one) and validate `release/<id>-<version>.zip`.
Do not delete the zip; tell the user the file name. Report errors and warnings with the fix
for each. Docker is required.
