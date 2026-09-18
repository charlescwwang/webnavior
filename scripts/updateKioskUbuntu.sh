#!/usr/bin/env bash

# Updates every Nginx-served AIRI web build on Ubuntu without persisting a GitHub token.
set -Eeuo pipefail

readonly stage_web_deploy_dir='/var/www/airi/web'
readonly kiosk_deploy_dir='/var/www/airi/kiosk'
readonly order_menu_deploy_dir='/var/www/airi/menu'
readonly pin_file='apps/stage-kiosk/.env.production.local'
readonly stage_web_env_file='apps/stage-web/.env.production.local'

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
askpass_file=''
remote_name=''

cleanup() {
  if [[ -n "$askpass_file" ]]; then
    rm -f "$askpass_file"
  fi
  unset AIRI_GITHUB_TOKEN
}

trap cleanup EXIT

cd "$repo_root"

if git remote get-url github >/dev/null 2>&1; then
  remote_name='github'
elif git remote get-url origin >/dev/null 2>&1; then
  remote_name='origin'
else
  echo "Error: No 'github' or 'origin' Git remote is configured in $repo_root." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Error: The working tree has uncommitted changes. Commit, stash, or remove them before updating.' >&2
  exit 1
fi

if [[ ! -f "$pin_file" ]] || ! grep -qE '^VITE_KIOSK_ADMIN_PIN=' "$pin_file"; then
  read -rsp 'Kiosk Admin PIN (first-time setup): ' AIRI_KIOSK_PIN
  echo
  if [[ -z "$AIRI_KIOSK_PIN" ]]; then
    echo 'Error: A Kiosk Admin PIN is required.' >&2
    exit 1
  fi
  if [[ "$AIRI_KIOSK_PIN" == *'"'* || "$AIRI_KIOSK_PIN" == *'\\'* ]]; then
    echo 'Error: The PIN cannot contain double quotes or backslashes.' >&2
    exit 1
  fi

  if [[ -f "$pin_file" ]]; then
    printf '\nVITE_KIOSK_ADMIN_PIN="%s"\n' "$AIRI_KIOSK_PIN" >> "$pin_file"
  else
    printf 'VITE_KIOSK_ADMIN_PIN="%s"\n' "$AIRI_KIOSK_PIN" > "$pin_file"
  fi
  unset AIRI_KIOSK_PIN
  echo "Created $pin_file."
fi

# The Kiosk browser may run on a different machine than this Server. These
# build-time public URLs must therefore be explicit; otherwise Vite falls back
# to localhost and produces a bundle that cannot register through Nginx.
if ! grep -qE '^VITE_SERVER_URL=' "$pin_file" || ! grep -qE '^VITE_API_SERVER_URL=' "$pin_file" || ! grep -qE '^VITE_ORDERING_SCENARIO_URL=' "$pin_file"; then
  echo "Error: Add VITE_SERVER_URL, VITE_API_SERVER_URL, and VITE_ORDERING_SCENARIO_URL to $pin_file before building." >&2
  exit 1
fi

if [[ ! -f "$stage_web_env_file" ]] || ! grep -qE '^VITE_SERVER_URL=' "$stage_web_env_file"; then
  echo "Error: Add VITE_SERVER_URL to $stage_web_env_file before building." >&2
  exit 1
fi

branch_name="$(git branch --show-current)"
if [[ -z "$branch_name" ]]; then
  echo 'Error: The repository is not currently on a branch.' >&2
  exit 1
fi

if ! GIT_TERMINAL_PROMPT=0 git pull --ff-only "$remote_name" "$branch_name"; then
  read -rsp 'GitHub token: ' AIRI_GITHUB_TOKEN
  echo
  if [[ -z "$AIRI_GITHUB_TOKEN" ]]; then
    echo 'Error: Git pull failed and no GitHub token was provided.' >&2
    exit 1
  fi
  export AIRI_GITHUB_TOKEN

  askpass_file="$(mktemp)"
  chmod 700 "$askpass_file"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'case "$1" in' \
    '  *Username*) printf "%s\\n" "x-access-token" ;;' \
    '  *Password*) printf "%s\\n" "$AIRI_GITHUB_TOKEN" ;;' \
    'esac' > "$askpass_file"

  GIT_ASKPASS="$askpass_file" GIT_TERMINAL_PROMPT=0 git pull --ff-only "$remote_name" "$branch_name"
fi

corepack pnpm install --frozen-lockfile

# The systemd unit runs the API directly from this checkout. Apply the declared
# PostgreSQL schema, rebuild the shared schema package, then restart before
# publishing browser code so a new management page never reaches an older
# API/schema contract. This is an in-place update: it never resets PostgreSQL,
# Redis, or WEBNAVIOR_KIOSK_ASSET_DIR (which also holds visitor media).
# A future intentional reset must first run the dedicated verified export flow;
# do not turn this update command into a reset shortcut.
corepack pnpm -F @proj-airi/server db:push
corepack pnpm -F @proj-airi/server-schema build
sudo systemctl restart webnavior-api
curl -fsS http://127.0.0.1:5168/readyz >/dev/null

corepack pnpm -F @proj-airi/stage-web exec vite build --base=/
corepack pnpm -F @proj-airi/stage-kiosk exec vite build --base=/kiosk/
corepack pnpm -F @proj-airi/order-menu exec vite build --base=/menu/

sudo install -d -m 0755 "$stage_web_deploy_dir" "$kiosk_deploy_dir" "$order_menu_deploy_dir"
sudo rsync -a --delete apps/stage-web/dist/ "$stage_web_deploy_dir/"
sudo rsync -a --delete apps/stage-kiosk/dist/ "$kiosk_deploy_dir/"
sudo rsync -a --delete apps/order-menu/dist/ "$order_menu_deploy_dir/"

echo 'Stage Web updated:  /'
echo 'Kiosk updated:     /kiosk/'
echo 'Order menu updated: /menu/'
echo 'API restarted and ready: webnavior-api (provider settings and kiosk media retained)'
