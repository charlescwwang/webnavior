#!/usr/bin/env bash
# Install only the local PB manager's desktop launcher, never a system service.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
launcher_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
desktop_dir="$(xdg-user-dir DESKTOP)"
exec_path="${repo_root//\\/\\\\}"
exec_path="${exec_path//\"/\\\"}"
exec_path="${exec_path//%/%%}"
mkdir -p "$launcher_dir"
launcher="$launcher_dir/webnavior-pb-test.desktop"
cat > "$launcher" <<EOF
[Desktop Entry]
Type=Application
Name=PB 測試管理
Comment=獨立 PB 測試系統：啟動、停止、Electron 與後台
Exec=/usr/bin/bash "$exec_path/scripts/pbTest/manage.sh"
TryExec=/usr/bin/zenity
Icon=applications-development
Terminal=false
Categories=Development;
StartupNotify=false
EOF
chmod 755 "$launcher"
if [[ -d "$desktop_dir" && "$desktop_dir" != "$HOME" ]]; then
  desktop_launcher="$desktop_dir/PB 測試管理.desktop"
  cp "$launcher" "$desktop_launcher"
  chmod 755 "$desktop_launcher"
  gio set "$desktop_launcher" metadata::trusted true 2>/dev/null || true
fi
echo '已安裝「PB 測試管理」桌面與應用程式選單入口。'
