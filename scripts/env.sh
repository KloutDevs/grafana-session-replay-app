#!/usr/bin/env bash
# Starts, stops or shows the separate environment (Grafana + Loki + Alloy + this plugin).
# The plugin is installed from the release zip, the way an administrator would.
#   scripts/env.sh up | down | status | secrets
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
env_dir="$root/env"
secrets="$env_dir/.env"
compose=(docker compose -p replay-env -f "$env_dir/compose.yaml" --env-file "$secrets")

case "${1:-}" in
  up)
    (cd "$root" && npm run --silent package >/dev/null)
    id="escalia-sessionreplay-app"
    version="$(node -p "require('$root/package.json').version")"
    zip="$root/release/$id-$version.zip"
    (cd "$root/release" && sha256sum -c "$id-$version.zip.sha256")
    mkdir -p "$env_dir/plugins" && rm -rf "$env_dir/plugins/$id"
    unzip -q "$zip" -d "$env_dir/plugins"
    if [ ! -f "$secrets" ]; then
      umask 077
      printf 'ENV_ADMIN_PASSWORD=%s\nENV_FARO_API_KEY=%s\n' "$(openssl rand -hex 12)" "$(openssl rand -hex 16)" > "$secrets"
    fi
    "${compose[@]}" up -d
    for _ in $(seq 1 60); do
      curl -fsS http://127.0.0.1:14000/api/health >/dev/null 2>&1 && break
      sleep 2
    done
    echo "Grafana    http://127.0.0.1:14000   (user admin; password: scripts/env.sh secrets)"
    echo "Faro URL   http://127.0.0.1:14347/collect"
    echo "Loki       http://127.0.0.1:14100"
    ;;
  down) "${compose[@]}" down ;;
  status) "${compose[@]}" ps ;;
  secrets) cat "$secrets" ;;
  *) echo "Usage: $0 up|down|status|secrets" >&2; exit 1 ;;
esac
