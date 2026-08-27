#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
watershed_root=/mnt/z/GitHub/kongdd/SpatialHydro/crates/watershed
watershed_unit="ecohydro-project-demo-watershed.service"
watershed_service="$HOME/.config/systemd/user/$watershed_unit"

cargo build --quiet --release --manifest-path "$watershed_root/Cargo.toml" --bin watershed_server
npm run build

mkdir -p "$(dirname -- "$watershed_service")"
cat >"$watershed_service" <<EOF
[Unit]
Description=Project Demo watershed service
After=network.target

[Service]
WorkingDirectory=$watershed_root
Environment="SPATIALHYDRO_DATA=$watershed_root/../../data"
ExecStart=$watershed_root/target/release/watershed_server
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable "$watershed_unit" >/dev/null
systemctl --user restart "$watershed_unit"
curl --fail --silent --show-error --retry 30 --retry-delay 1 --retry-connrefused \
  http://127.0.0.1:8765/api/health >/dev/null
ecohydro-app restart project-demo
