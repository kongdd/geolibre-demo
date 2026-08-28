#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
spatialhydro_root="${SPATIALHYDRO_ROOT:-/mnt/z/GitHub/kongdd/SpatialHydro}"
data_dir="${SPATIALHYDRO_DATA:-$spatialhydro_root/data}"
julia_port="${JULIA_MODEL_PORT:-9090}"
backend_port="${SPATIALHYDRO_PORT:-8765}"
julia_bin="${JULIA:-$(command -v julia)}"
backend_bin="$spatialhydro_root/crates/SpatialHydro/target/release/spatialhydro-backend"
julia_unit="ecohydro-project-demo-julia.service"
backend_unit="ecohydro-project-demo-spatialhydro.service"
legacy_unit="ecohydro-project-demo-watershed.service"
systemd_dir="$HOME/.config/systemd/user"

[[ -x "$backend_bin" ]] || {
  echo "缺少 SpatialHydro backend：$backend_bin" >&2
  echo "请先在 crates/SpatialHydro 运行 cargo build --release" >&2
  exit 1
}
[[ -x "$julia_bin" ]] || {
  echo "找不到 Julia：$julia_bin" >&2
  exit 1
}

npm run build
mkdir -p "$systemd_dir"

cat >"$systemd_dir/$julia_unit" <<EOF
[Unit]
Description=Project Demo FLASHCAST Julia model service
After=network.target

[Service]
Type=simple
WorkingDirectory=$spatialhydro_root
Environment="SPATIALHYDRO_DATA=$data_dir"
Environment="JULIA_MODEL_PORT=$julia_port"
Environment="JULIA_NUM_THREADS=auto"
ExecStart=$julia_bin --project=$spatialhydro_root/julia_service $spatialhydro_root/julia_service/bin/server.jl
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF

cat >"$systemd_dir/$backend_unit" <<EOF
[Unit]
Description=Project Demo SpatialHydro API
After=network.target $julia_unit
Wants=$julia_unit

[Service]
Type=simple
WorkingDirectory=$spatialhydro_root
Environment="SPATIALHYDRO_DATA=$data_dir"
Environment="JULIA_MODEL_URL=http://127.0.0.1:$julia_port"
Environment="BIND_ADDR=127.0.0.1:$backend_port"
ExecStart=$backend_bin
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF

# 旧 watershed_server 只提供流域提取，会占用 8765 且没有模型 API。
systemctl --user disable --now "$legacy_unit" >/dev/null 2>&1 || true
systemctl --user daemon-reload
systemctl --user enable "$julia_unit" "$backend_unit" >/dev/null
systemctl --user restart "$julia_unit"
systemctl --user restart "$backend_unit"

if ! curl --fail --silent --retry 60 --retry-delay 1 --retry-connrefused \
  "http://127.0.0.1:$backend_port/api/health" >/dev/null; then
  systemctl --user status "$backend_unit" --no-pager --full || true
  exit 1
fi
if ! curl --fail --silent --retry 120 --retry-delay 1 --retry-all-errors \
  "http://127.0.0.1:$backend_port/api/model/sites" >/dev/null; then
  systemctl --user status "$julia_unit" "$backend_unit" --no-pager --full || true
  exit 1
fi

ecohydro-app restart project-demo
