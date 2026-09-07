#!/usr/bin/env bash

# Builds the three browser applications and publishes them through Ubuntu Nginx.
#
# Browser -> Nginx -> / (stage-web), /kiosk/ (stage-kiosk), /menu/ (order-menu)
#
# The API server, Postgres, Redis, Electron, Godot, and ROCm are deliberately
# outside this static-web baseline. They can be added behind the same origin later.
set -Eeuo pipefail

readonly NODE_VERSION='24.13.0'
readonly NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
readonly NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}"

setup=false
origin=''
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
local_bin="$HOME/.local/bin"
node_root="$HOME/.local/opt/airi-web-node"
site_root='/var/www/airi'
nginx_site='/etc/nginx/sites-available/airi-web'

usage() {
  cat <<'EOF'
Usage:
  bash scripts/deployWebUbuntu.sh --setup --origin http://SERVER_IP
  bash scripts/deployWebUbuntu.sh --origin https://airi.example.com

Options:
  --setup     Install Ubuntu build/runtime prerequisites without changing the
              system Node.js installation. Required only on the first run.
  --origin    The exact browser-visible origin of this Ubuntu server, without
              a trailing slash. It is baked into the Web and kiosk builds so
              they can open the deployed /menu/ page.
EOF
}

while (($#)); do
  case "$1" in
    --setup) setup=true ;;
    --origin)
      shift
      origin="${1:-}"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ ! "$origin" =~ ^https?://[^/]+$ ]]; then
  echo 'Error: --origin must be an http(s) origin without a trailing slash.' >&2
  exit 2
fi

export PATH="$local_bin:$PATH"

install_node_locally() {
  local node_dir="$node_root/node-v${NODE_VERSION}-linux-x64"

  if [[ ! -x "$node_dir/bin/node" ]]; then
    mkdir -p "$node_root" "$local_bin"
    local temporary_dir
    temporary_dir="$(mktemp -d)"
    trap 'rm -rf "$temporary_dir"' RETURN
    curl --fail --location --retry 3 --output "$temporary_dir/$NODE_ARCHIVE" "$NODE_URL"
    tar -xJf "$temporary_dir/$NODE_ARCHIVE" -C "$node_root"
  fi

  for command in node npm npx corepack; do
    ln -sfn "$node_dir/bin/$command" "$local_bin/$command"
  done

  corepack enable --install-directory "$local_bin"
}

if "$setup"; then
  if [[ "$(uname -s)" != 'Linux' ]] || ! command -v apt-get >/dev/null; then
    echo 'Error: --setup supports Ubuntu/Debian systems with apt-get only.' >&2
    exit 1
  fi

  sudo apt-get update
  sudo apt-get install -y ca-certificates curl nginx build-essential python3 pkg-config rsync
  install_node_locally
fi

for command in node corepack nginx rsync; do
  if ! command -v "$command" >/dev/null; then
    echo "Error: Missing required command: $command. Run this script once with --setup." >&2
    exit 1
  fi
done

if [[ "$(node --version)" != "v${NODE_VERSION}" ]]; then
  echo "Error: Node.js ${NODE_VERSION} is required. Run this script once with --setup." >&2
  exit 1
fi

cd "$repo_root"
corepack pnpm install --frozen-lockfile

# Vite's --base makes static asset URLs valid below the Nginx subpaths.
VITE_ORDER_MENU_URL="$origin/menu/" corepack pnpm -F @proj-airi/stage-web build
VITE_ORDERING_SCENARIO_URL="$origin/menu/" corepack pnpm -F @proj-airi/stage-kiosk exec vite build --base=/kiosk/
corepack pnpm -F @proj-airi/order-menu exec vite build --base=/menu/

sudo install -d -m 0755 "$site_root/web" "$site_root/kiosk" "$site_root/menu"
sudo rsync -a --delete apps/stage-web/dist/ "$site_root/web/"
sudo rsync -a --delete apps/stage-kiosk/dist/ "$site_root/kiosk/"
sudo rsync -a --delete apps/order-menu/dist/ "$site_root/menu/"

sudo tee "$nginx_site" >/dev/null <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    root /var/www/airi;

    location = /kiosk { return 301 /kiosk/; }
    location = /menu { return 301 /menu/; }

    location ^~ /kiosk/ {
        try_files $uri $uri/ /kiosk/index.html;
    }

    location ^~ /menu/ {
        try_files $uri $uri/ /menu/index.html;
    }

    location / {
        root /var/www/airi/web;
        try_files $uri $uri/ /index.html;
    }

    # Future API baseline: proxy /api/ and WebSocket endpoints to apps/server
    # here, keeping the browser origin unchanged.
}
EOF

sudo ln -sfn "$nginx_site" /etc/nginx/sites-enabled/airi-web
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

echo
echo "Web:    $origin/"
echo "Kiosk:  $origin/kiosk/"
echo "Menu:   $origin/menu/"
