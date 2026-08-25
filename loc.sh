#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
find src -type f | sort | xargs wc -l
