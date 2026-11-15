#!/usr/bin/env bash
set -euo pipefail
site_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$site_dir/../../apps/order-menu/node_modules/.bin/vite" "$site_dir" --host 127.0.0.1 --port 5188 --strictPort
