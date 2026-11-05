#!/usr/bin/env bash

# Builds the three browser applications and publishes them through Ubuntu Nginx.
#
# Browser -> Nginx:5169 -> / (stage-web), /kiosk/ (stage-kiosk), /menu/ (order-menu)
#
# Postgres, Redis, Electron, Godot, and ROCm are deliberately outside this
# static-web baseline. The API server runs separately on loopback port 5168 and
# is exposed through this Nginx site's same-origin proxy routes.
set -Eeuo pipefail

readonly NODE_VERSION='24.22.1'
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
    curl --fail --location --retry 3 --output "$temporary_dir/SHASUMS256.txt" "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
    (
      cd "$temporary_dir"
      grep " ${NODE_ARCHIVE}\$" SHASUMS256.txt | sha256sum --check
    )
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
VITE_SERVER_URL="$origin" VITE_ORDER_MENU_URL="$origin/menu/" corepack pnpm -F @proj-airi/stage-web build
VITE_API_SERVER_URL="$origin" VITE_ORDERING_SCENARIO_URL="$origin/menu/" corepack pnpm -F @proj-airi/stage-kiosk exec vite build --base=/kiosk/
VITE_ORDER_MENU_SERVER_URL="$origin/api/kiosk/pos" VITE_AIRI_ORIGIN="$origin" corepack pnpm -F @proj-airi/order-menu exec vite build --base=/menu/

sudo install -d -m 0755 "$site_root/web" "$site_root/kiosk" "$site_root/menu"
sudo rsync -a --delete apps/stage-web/dist/ "$site_root/web/"
sudo rsync -a --delete apps/stage-kiosk/dist/ "$site_root/kiosk/"
sudo rsync -a --delete apps/order-menu/dist/ "$site_root/menu/"

sudo tee "$nginx_site" >/dev/null <<'EOF'
server {
    listen 5169 default_server;
    listen [::]:5169 default_server;
    server_name _;
    root /var/www/airi;
    absolute_redirect off;

    # Resolve the public entry before the management SPA and its cached routes.
    location = / { return 302 /kiosk/; }

    location = /kiosk { return 301 /kiosk/; }
    location = /menu { return 301 /menu/; }

    # The API is loopback-only. Cloudflare Tunnel reaches it through this
    # public Nginx listener, so browsers retain one HTTPS origin.
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:5168;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Chat uses a WebSocket endpoint outside the /api/ namespace.
    location = /ws/chat {
        proxy_pass http://127.0.0.1:5168;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location ^~ /kiosk/ {
        try_files $uri $uri/ /kiosk/index.html;
    }

    location ^~ /menu/ {
        try_files $uri $uri/ /menu/index.html;
    }

    # Vite names build assets with a content hash. A removed hash must remain
    # a missing asset, not fall through to the SPA document: otherwise an old
    # browser tab receives HTML where it expects JavaScript and cannot recover
    # to the newly deployed application.
    location ^~ /assets/ {
        root /var/www/airi/web;
        try_files $uri =404;
        expires 4h;
        add_header Cache-Control "public, max-age=14400";
    }

    location / {
        root /var/www/airi/web;
        try_files $uri $uri/ /index.html;
    }
}
EOF

sudo ln -sfn "$nginx_site" /etc/nginx/sites-enabled/airi-web
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

echo
echo "Web:    $origin/"
echo "Kiosk:  $origin/kiosk/"
echo "Menu:   $origin/menu/"
