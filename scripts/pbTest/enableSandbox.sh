#!/usr/bin/env bash
# Permit user namespaces for this one official test executable. No global
# sysctl changes, disabled sandbox flags, or setuid binaries are installed.
set -euo pipefail
script_path="$(realpath "${BASH_SOURCE[0]}")"
repo_root="$(cd "$(dirname "$script_path")/../.." && pwd)"
runtime="$repo_root/pb-test.local/runtime/electron"
if [[ "$EUID" -ne 0 ]]; then
  /usr/bin/pkexec /usr/bin/bash "$script_path"
  # Persist the success stamp as the desktop user, never perform a privileged
  # write through a path inside the user's editable test directory.
  /usr/bin/sha256sum /etc/apparmor.d/webnavior-pb-test > "$repo_root/pb-test.local/sandbox-ready"
  exit 0
fi

# AppArmor interprets metacharacters in executable paths. Reject them rather
# than accidentally granting permission to more than the one selected binary.
if [[ ! "$runtime" =~ ^/[a-zA-Z0-9_./-]+$ ]] || [[ ! -x "$runtime" ]] || [[ -L "$runtime" ]]; then
  echo '無法確認 PB 測試執行器路徑；沒有變更系統設定。' >&2
  exit 1
fi
profile="$(mktemp)"
trap 'rm -f "$profile"' EXIT
cat > "$profile" <<EOF
abi <abi/4.0>,
include <tunables/global>

# Only this PB test binary can create the namespaces used by Chromium sandbox.
profile webnavior-pb-test "$runtime" flags=(unconfined) {
  userns,
}
EOF
/usr/bin/install -o root -g root -m 0644 "$profile" /etc/apparmor.d/webnavior-pb-test
/usr/sbin/apparmor_parser -r /etc/apparmor.d/webnavior-pb-test
echo 'Ubuntu 啟動設定完成。請回到 PB 測試管理，選擇「開啟 Electron」。'
