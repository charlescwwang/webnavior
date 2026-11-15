#!/usr/bin/env bash
# Desktop menu for the existing local Python/Docker/Nginx test runner.
set -u
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
manager="$repo_root/scripts/pbTest/manage.py"
state="$repo_root/pb-test.local"
export PATH="$HOME/.local/bin:$PATH"
while choice="$(zenity --list --title='PB 測試管理' --width=700 --height=500 \
  --text='獨立測試系統｜現有正式網站維持運作\n先啟動系統，再開啟 Electron。停止會保留資料與登入。' \
  --column='操作' --column='說明' \
  '啟動測試系統' '啟動測試資料庫、後端與頁面' \
  '完成 Ubuntu 啟動設定' '第一次使用：需要一次 Ubuntu 管理員驗證' \
  '開啟 Electron' '開啟 PB 點餐測試視窗' \
  '開啟測試後台' '管理設備、體驗與模型' \
  '查看狀態' '查看測試系統是否正常' \
  '顯示測試 PIN' '查看現場管理用的測試 PIN' \
  '查看記錄' '開啟測試系統記錄目錄' \
  '停止測試系統' '關閉測試服務，保留資料與登入' \
  '更新測試程式' '將目前程式重新建置；耗時數分鐘')"; do
  case "$choice" in
    '開啟測試後台') xdg-open 'http://127.0.0.1:15169/admin' >/dev/null 2>&1 & continue ;;
    '查看記錄') xdg-open "$state/logs" >/dev/null 2>&1 & continue ;;
    '查看狀態') python3 "$manager" status | zenity --text-info --title='PB 測試狀態' --width=650 --height=370; continue ;;
    '顯示測試 PIN') python3 "$manager" pin | zenity --text-info --title='僅限測試系統的管理 PIN' --width=450 --height=160; continue ;;
    '啟動測試系統') action=start ;;
    '完成 Ubuntu 啟動設定') action=sandbox ;;
    '停止測試系統')
      zenity --question --title='停止 PB 測試' --text='這會關閉測試視窗與服務。\n請先確認沒有正在處理的點餐操作。\n測試資料與登入會保留。' || continue
      action=stop ;;
    '開啟 Electron') action=electron ;;
    '更新測試程式')
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
