#!/usr/bin/env bash
set -euo pipefail
site_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export PB_LAB_ORIGIN=https://webnavior.aikcitri.qzz.io
export PB_LAB_BASE=/pb-test/
exec "$site_dir/node_modules/.bin/vite" preview "$site_dir" --outDir "${PB_LAB_DIST:-$site_dir/dist}" --host 127.0.0.1 --port 5198 --strictPort
