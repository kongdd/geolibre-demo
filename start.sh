#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
watershed_unit="ecohydro-project-demo-watershed.service"
watershed_service="$HOME/.config/systemd/user/$watershed_unit"

npm run build

mkdir -p "$(dirname -- "$watershed_service")"
cat >"$watershed_service" <<EOF
[Unit]
Description=Project Demo watershed service
After=network.target

[Service]
Environment="SPATIALHYDRO_DATA=/mnt/z/GitHub/kongdd/SpatialHydro/data"
ExecStart=%h/.cargo/bin/watershed_server
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable "$watershed_unit" >/dev/null
systemctl --user restart "$watershed_unit"

if ! curl --fail --silent --retry 30 --retry-delay 1 --retry-connrefused \
  http://127.0.0.1:8765/api/health >/dev/null 2>&1; then
  systemctl --user status "$watershed_unit" --no-pager --full || true
  exit 1
fi
ecohydro-app restart project-demo
