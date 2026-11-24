#!/usr/bin/env bash
# Desktop menu for the existing local Python/Docker/Nginx test runner.
set -u
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
manager="$repo_root/scripts/pbTest/manage.py"
state="$repo_root/pb-test.local"
export PATH="$HOME/.local/bin:$PATH"
while choice="$(zenity --list --title='PB 測試管理' --width=700 --height=500 \
  --text='跨機器測試請選共用 Electron，Ubuntu 與 Windows 連同一個後台。\n本機隔離選項只供除錯，資料與共用後台分開。' \
  --column='範圍' --column='操作' --column='說明' --print-column=2 \
  '跨機器共用' '開啟共用 Electron' '使用與 Windows 相同的後台設定' \
  '跨機器共用' '開啟共用後台' '管理共用模型、設備與 PB 互動體驗' \
  '跨機器共用' '關閉共用 Electron' '關閉這台 Ubuntu 的共用測試視窗' \
  '本機隔離' '啟動本機隔離系統' '啟動本機測試資料庫、後端與頁面' \
  '本機隔離' '開啟本機 Electron' '連到本機測試後台' \
  '本機隔離' '開啟本機隔離後台' '管理本機設備、體驗與模型' \
  '本機隔離' '顯示測試 PIN' '查看本機隔離系統的管理 PIN' \
  '本機隔離' '停止本機隔離系統' '停止本機服務，保留資料與登入' \
  'Ubuntu 工具' '查看狀態' '查看共用與本機隔離系統的狀態' \
  'Ubuntu 工具' '查看記錄' '開啟這台 Ubuntu 的測試記錄目錄' \
  'Ubuntu 工具' '完成 Ubuntu 啟動設定' '首次開啟任一 Electron 前使用' \
  'Ubuntu 工具' '更新本機測試程式' '重新建置隔離網站及兩種入口使用的桌面程式')"; do
  case "$choice" in
    '開啟共用後台') xdg-open 'https://webnavior.aikcitri.qzz.io/admin/system/models' >/dev/null 2>&1 & continue ;;
    '開啟本機隔離後台') xdg-open 'http://127.0.0.1:15169/admin' >/dev/null 2>&1 & continue ;;
    '查看記錄') xdg-open "$state/logs" >/dev/null 2>&1 & continue ;;
    '查看狀態') python3 "$manager" status | zenity --text-info --title='PB 測試狀態' --width=650 --height=490; continue ;;
    '顯示測試 PIN') python3 "$manager" pin | zenity --text-info --title='僅限測試系統的管理 PIN' --width=450 --height=160; continue ;;
    '啟動本機隔離系統') action=start ;;
    '完成 Ubuntu 啟動設定') action=sandbox ;;
    '停止本機隔離系統')
      zenity --question --title='停止 PB 測試' --text='這會關閉測試視窗與服務。\n請先確認沒有正在處理的點餐操作。\n測試資料與登入會保留。' || continue
      action=stop ;;
    '開啟共用 Electron') action=shared-electron ;;
    '關閉共用 Electron') action=close-shared-electron ;;
    '開啟本機 Electron') action=electron ;;
    '更新本機測試程式')
      zenity --question --title='更新測試程式' --text='請先停止測試系統。\n更新會建置目前分支的程式，不會發布到正式網站。' || continue
      action=build ;;
    *) continue ;;
  esac
  result="$(mktemp)"
  if [[ "$action" == sandbox ]]; then
    bash "$repo_root/scripts/pbTest/enableSandbox.sh" >"$result" 2>&1 &
  else
    python3 "$manager" "$action" >"$result" 2>&1 &
  fi
  task_pid=$!
  while kill -0 "$task_pid" 2>/dev/null; do sleep 1; done | \
    zenity --progress --pulsate --auto-close --no-cancel --title='PB 測試管理' --text='正在處理，請稍候…' --width=400
  if wait "$task_pid"; then
    zenity --info --title='PB 測試管理' --text='操作完成。' --width=400
  else
    zenity --error --title='PB 測試管理' --text="$(cat "$result")" --width=600
  fi
  rm -f "$result"
done
