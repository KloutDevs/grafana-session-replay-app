# Install the plugin in a Grafana

Written for the person who administers the Grafana. Nothing here changes the log
pipeline or the dashboards that already exist.

## 1. Get the release

Take `escalia-sessionreplay-app-<version>.zip` and its `.sha256` from the
release and check the sum:

```bash
sha256sum -c escalia-sessionreplay-app-<version>.zip.sha256
```

## 2. Put it in Grafana

Extract the zip so that the folder `escalia-sessionreplay-app/` is inside
Grafana's plugins directory (`/var/lib/grafana/plugins` by default). The plugin is
**not signed**, so allow it:

```ini
[plugins]
allow_loading_unsigned_plugins = escalia-sessionreplay-app
```

(or `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=escalia-sessionreplay-app`).
Restart Grafana.

## 3. Enable it and point it at Loki

Provisioning file, for example
`/etc/grafana/provisioning/plugins/session-replay.yaml`:

```yaml
apiVersion: 1
apps:
  - type: escalia-sessionreplay-app
    org_id: 1
    disabled: false
    jsonData:
      lokiUid: <uid of the Loki datasource>
      format: json
      selector: '{service_name="frontend"}'
```

For a production Faro setup that writes JSON lines, use your Loki datasource uid and
`{service_name="frontend"}` as the selector. Restart Grafana after changing it. The
same values can be set in the plugin's Configuration page.

## 4. Loki

Replay lines carry the page snapshot, so Loki must accept long lines:

```yaml
limits_config:
  max_line_size: 8MB
  max_line_size_truncate: false
```

Raise `max_entries_limit_per_query` to at least `5000` if it is lower.
Without a high enough `max_line_size`, snapshots are rejected and sessions open
with a notice that a part has no snapshot.

## 5. Check

Open _More apps → Session Replay_ as an Editor or Admin. With recordings in Loki
the list shows sessions; a Viewer sees a permission message.

## Roll back

Set `disabled: true` in the provisioning file, or delete the plugin folder, and
restart Grafana. Nothing else depends on the plugin.
