#!/usr/bin/env bash
set -euo pipefail
site_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$site_dir/node_modules/.bin/vite" "$site_dir" --port 5188 --strictPort
