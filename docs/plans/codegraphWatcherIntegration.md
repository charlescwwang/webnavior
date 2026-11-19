# CodeGraph 原生 watcher 與 MCP 導入計畫

日期：2026-11-19。狀態：隔離原生 watcher 與負載驗證完成；目前工作目錄的索引、watcher 與專案 MCP 尚未啟用。

## 目標與執行方式

讓 Codex 能查詢目前工作目錄的程式關係，並由 CodeGraph 原生 watcher 在存檔後更新索引。日常開發不需要每改一個檔案就手動重建；Codex 在理解跨檔案流程、修改共享契約或判斷影響範圍時查詢圖譜。

沿用使用者指定的 `colbymchenry/codegraph`，固定 v1.6.3。先在隔離來源副本驗證持續更新，再建立 live worktree 索引，最後接入專案 MCP。每階段須取得下表列出的證據，才進入下一階段。本輪只在隔離副本啟動原生 MCP／watcher，測試程序已全部關閉。

watcher 更新的是索引，原始碼仍由開發者或 Codex 修改。CodeGraph 的查詢是導航與修改影響線索；編譯、測試與實際原始碼仍負責確認行為。Eventa／IPC 的跨程序執行關係不能由「沒有找到呼叫端」推斷不存在。

```mermaid
flowchart LR
  A[工作目錄存檔] --> B[CodeGraph 原生 watcher]
  B --> C[增量同步與關係重建]
  C --> D[本機索引]
  E[Codex 按需要查詢] --> F[專案 MCP]
  F --> D
  D --> G[來源位置與關係線索]
  G --> H[修改原始碼並執行適當驗證]
  H --> A
```

## 已有證據與限制

已完成的凍結快照試跑索引了 2,476 檔，其中 497 個 Vue 檔；工具耗時 16.5 秒，cgroup 記憶體峰值 948.55 MiB，索引約 115.82 MiB。在一核 CPU、2 GiB 記憶體限制下，前／中／後共 90 次健康與靜態頁取樣皆回傳 200。七項 CLI 檢查完成，已確認 workspace 呼叫解析與 Vue template 引用。

這些數字是一次選定範圍的測量，不是整個 monorepo、持續監看或營運負載的保證。證據見 [verification.json](/home/aimax/webnavior/codegraph-pilot.local/verification.json) 與 [pilot-result.json](/home/aimax/webnavior/codegraph-pilot.local/pilot-result.json)。

已知解析限制保留為驗收案例：Eventa 的 `invokeNativeAudio` 只確認 main／preload 對共享契約的 import，尚未確認跨程序 request→handler 執行鏈；`callers`／explore 的結果可能包含 import 或 type reference；JSON import attributes 的一處 re-export 出現解析警告，但 strict status 仍成功。不能把退出碼零當成所有檔案與所有語意都已正確解析。

### 原生 watcher 隔離驗證結果

另以新的選定範圍來源副本及兩個隔離 Git worktree，完成 17 項功能檢查。變更僅寫入 `/tmp/cg-watch-20261119-5ldbb6yb`；測試 harness 操作上游 CLI／MCP，沒有另實作 watcher。完整結果與命令見 [watcher verification.json](/home/aimax/webnavior/codegraph-pilot.local/watcher-20261119-r1/verification.json)。

- 新增未追蹤檔、刪除、改函式名稱與呼叫端、搬移並更新 workspace export，以及 Vue script setup／template 元件引用均能更新。舊定義與舊引用有核對移除。
- 35 次持久化索引 hash 觀測，均先等待資料庫反映變更再執行後續查詢；中位數 0.502 秒、p95 1.004 秒，最慢為 20 檔批次的 2.261 秒。輪詢間隔 250 ms，這些數字是觀測值。自動同步案例未以手動 sync 補救。
- 601.21 秒編輯／閒置循環完成 20 次更新；兩個原生 MCP 連線共用 daemon，關閉其中一個後另一個仍可更新。停止後離線改檔，再連線的第一次工具查詢已取得新版；隔離 checkout 會更新自己的索引，另一個 worktree 保持不變。
- 同步期間持續寫入 15 個版本，兩組 status／node 查詢捕捉到 modified／stale 提示，停止寫入後收斂到最後版本。這不構成全專案一致快照保證。
- 一核 CPU、MemoryMax 2 GiB、無 swap、nice19／idle IO 下，主測試記憶體中位數約 402 MiB、整組峰值 1001.81 MiB；已核對 daemon／worker 屬於同一受限 cgroup。網路僅允許 AF_UNIX，來源副本與證據目錄以外唯讀。

同步與解析有效性必須分開：暫時不完整的 TypeScript 已寫入最新 hash，`files.errors` 卻有 `parse_error`，而 MCP status 仍顯示零變更。修復語法後定義能恢復；不能僅靠 status 判定解析成功。另已實測新連線的 `CODEGRAPH_NO_WATCH=1` 不會停止既有共享 daemon 的 watcher；獨立的 `--no-watch` 直接模式及釋放 writer 後手動 sync 控制案例通過。

服務共 372 個取樣點、1,116 次 HTTP probe，其中 1,114 次為 200。台北 21:54:16 一個取樣點的兩個 API probe 無法連線，前後兩秒取樣均成功，靜態頁仍為 200；同時另一份 r4 啟用紀錄與 API PID 更換可見，證據保留於 `concurrent-service-change.json`。本次沒有部署或重啟 API，未達連續三次停止門檻；但這個同時變更使本輪不能宣稱零中斷或完成因果隔離。收尾三端點皆 200，測試 units／bundle 程序／daemon pidfile／socket 均無殘留。

目前未建立原專案 `.codegraph`、`codegraph.json` 或 `.codex/config.toml`。尚未驗證 live Vite／tsx 熱重載、Codex app 的實際 MCP 接入、強制 OOM 復原或營運高峰；訂單、音訊與模型品質不在本輪驗收範圍。

## 索引範圍與程序所有權

首輪 live 範圍沿用試跑的 Kiosk、Desktop、Order Menu、Order Menu Server、Server 與共用 packages，從 worktree 根目錄保留跨 workspace 路徑。保留測試與套件 exports／tsconfig 等解析所需設定；其他 app、引擎與外掛待有查詢需求及負載證據後擴大。

使用上游既有的 `codegraph.json` 排除機制與既有 `.gitignore`。明確排除索引本身、工具發行檔、依賴、建置輸出、模型、現場或本機測試紀錄與暫存資料。`include` 是上游用來重新納入被忽略來源的設定，不能當作只掃白名單目錄的開關；正式範圍必須以實際 indexed files 清單驗證。

每個 worktree 使用自己的索引。同一 worktree 的多個 Codex 連線優先沿用 CodeGraph 原生共享 daemon 與 writer lock，避免重複 watcher 或跨分支共用資料庫。資源限制必須涵蓋實際 daemon、worker 與同步程序，不能只限制短命的 MCP 啟動器；多連線的關閉順序也必須先驗證，不能讓一個 chat 結束就誤停另一個 chat 的共享程序。

原生 watcher 可由 `serve --no-watch`／`CODEGRAPH_NO_WATCH=1` 關閉。`CODEGRAPH_NO_DAEMON=1` 控制直接／共享服務模式，不能單獨當作關閉 watcher 的依據。這項區分已由安裝版本的 CLI help、watch policy 與 project lifecycle 實作核對；實作時以實際程序與變更是否仍自動同步驗證開關。

## 分階段執行與驗收

| 階段 | 執行內容 | 通過條件 |
| --- | --- | --- |
| A 隔離 watcher 驗證（已執行） | 在新的來源副本啟動原生 MCP／watcher，執行下列檔案變更與重新連線案例 | 不手動 sync 也能取得最新結果；失敗或尚未同步時，開發流程不把舊結果當成最新；關閉後無本次殘留程序 |
| B 持續負載與多連線（隔離驗證已執行） | 一般編輯、批次寫入與閒置取樣；測試兩個 MCP 連線及不同 worktree | 實際 worker／daemon 受同一組限制，無重複 writer、跨 worktree 汙染或持續重建迴圈；關閉一個連線不破壞另一個連線 |
| C Live worktree 索引 | 合併排除設定，低優先權建立目前工作目錄的索引，再啟動原生 watcher | 索引清單符合範圍；新增但尚未 git add 的來源也能追蹤；不因索引資料庫寫入觸發既有 Vite／tsx 重建或重啟 |
| D 專案 MCP 接入 | 合併專案設定與 AGENTS 查詢規則，在實際 Codex 工作階段驗證 | 工具確實可見且可呼叫；存檔後可查到更新；停用 CodeGraph 後，Codex 的既有讀檔／搜尋流程仍可使用 |

### 檔案與同步案例

| 案例 | 應檢查的結果 |
| --- | --- |
| 修改函式內容、名稱與呼叫端 | 查詢回傳新版來源與正確引用；舊名稱不殘留為有效定義 |
| 新增未追蹤的來源檔案，再刪除 | 不依賴 git add 才發現；刪除後不回傳不存在的檔案與引用 |
| 搬移檔案並更新 import | 新路徑與新引用生效，舊路徑沒有幽靈關係 |
| Vue script setup 與 template 分別修改 | 原生解析同時反映函式與元件引用的變化 |
| 更動 workspace exports 或 tsconfig 路徑 | 確認上游是否自動重新解析；若需重建，工作流程須明確辨識並執行，不能繼續依賴舊關係 |
| 單次存檔與短時間批次寫入 | 最後版本被收錄，重複事件可合併，索引寫入不反過來觸發無限同步 |
| 編輯到一半暫時語法不完整 | 警告／缺口可辨識；恢復合法語法後能更新，不能默默把舊圖當成當前程式 |
| 同步期間查詢、查詢期間繼續編輯 | 記錄回傳內容與對應來源版本；持續變動時不聲稱已取得全專案一致快照 |
| MCP 停止時改檔，再重新連線 | 重新連線後補齊變更，並驗證第一次實際工具查詢的結果 |
| 在隔離 Git 副本切換分支 | 新分支內容取代舊內容；不同 worktree 的索引互不影響；不操作目前工作目錄的分支或未提交修改 |
| 停止、資源限制或同步失敗後恢復 | 沒有孤兒 watcher／writer lock；恢復時確認追上來源，再使用影響分析 |

## 負載與新鮮度準則

初始沿用一核 CPU、MemoryMax 2 GiB、無 swap、低優先權與 idle IO。量測涵蓋啟動、單檔更新、批次更新與至少十分鐘閒置／編輯循環，保存每次同步耗時、整組程序的 CPU／記憶體、待同步狀態及本機服務 probe。本輪隔離結果如上；live 範圍仍須核對實際程序限制及服務變化，不能直接沿用隔離數字作保證。

一般單檔變更以存檔停止後十秒內可查到新版為初始目標；多檔變更另報收斂時間。超時或持續變動時，先讀取相關檔案的當前內容，不依賴未確認新鮮度的圖譜作刪除、改介面或省略測試的依據。本輪隔離案例符合此目標，十秒仍不是上游或 live 負載下的保證。

不先調高 `CODEGRAPH_SYNTH_MIN_INTERVAL_MS` 來降低負載。安裝版本允許延後 callback／事件等合成關係重建；這類延後不能假設都會出現在一般待同步提示中。若原生預設在限制內無法收斂，保留觀測結果並暫用明確的手動同步流程。

本機服務沿用先前的 `/livez`、`/readyz` 與 Kiosk 靜態頁取樣。相對同時段基線，若連續三次發生非 200／timeout，或延遲同時超過基線 p95 五倍及 100 ms，先停止本次觀測擁有的 CodeGraph 程序，再確認是否恢復。這是停止試驗的條件，不直接把同時發生的服務異常歸因給 CodeGraph。訂單、音訊與模型品質不由這些 probe 代為驗收。

## Codex 日常使用規則

接入後預期流程為：存檔由原生 watcher 自動同步；Codex 在需要結構資訊時呼叫 MCP。存檔本身不保證觸發一次模型工具呼叫，也不會讓 CodeGraph 自動修改其他來源檔案。

專案規則應要求：分析共享介面或跨檔案影響前確認同步狀態；相關檔案持續變動時重新查詢或直接讀取最新內容；辨識 import／reference／call／Vue render 等不同關係；Eventa／IPC 回查契約及 producer／handler；圖譜未找到引用不能作為未使用的證明；測試候選仍依本專案的 scoped validation policy 選擇。

MCP 初始只提供結構查詢與狀態所需工具，狀態工具是否需顯式加入上游 catalog 以實際 tools/list 驗證。保持 MCP 為可選工具，沿用現有權限政策，停用或離線時使用既有搜尋與原始碼查閱。實際 tools/call 成功才算接通，不能只以設定檔存在或 mcp list 有紀錄宣稱完成。

## 預定變更

| 位置 | 用途 |
| --- | --- |
| `/home/aimax/webnavior/codegraph.json` | 記錄已驗證的索引排除範圍 |
| [gitignore](/home/aimax/webnavior/.gitignore) | 忽略 live 索引與固定版本的本機工具檔案 |
| `/home/aimax/webnavior/.codex/config.toml` | 加入本專案 MCP 的啟動與環境設定 |
| [AGENTS.md](/home/aimax/webnavior/AGENTS.md) | 合併上述查詢、新鮮度與已知解析限制的使用規則 |
| 固定版本本機 CLI 與必要的啟動設定 | 使用已驗證 bundle；執行位置須持久存在且不依賴 `/tmp` 快照；資源與生命週期封裝方式以階段 B 的實測決定 |
| 本計畫與 [交接文件](/home/aimax/webnavior/docs/codex-handoff.md) | 保留驗收結果、操作方式與仍存在的限制 |

所有變更限於開發工具接入；使用上游 watcher、索引與 MCP，不另寫監看器、圖譜引擎或 daemon 協定。初始化與 installer 的副作用須先檢查，尤其是自動修改 AGENTS、權限與 Git sync hooks；正式接入採最小設定合併。產品 app／package 的執行依賴、營運服務與發布流程不屬於這次變更。

## 停用與回退

先停用本專案 MCP，關閉連線，再依 CodeGraph 原生管理方式停止該 worktree 的共享 daemon，並核對 PID／writer lock／資源單元。不能只加上 `--no-watch` 就假設一個已存在的共享 daemon 已停止監看；要以實際檔案變更與程序狀態驗證。

保留來源與本機索引，不以刪除資料庫代替正常關閉。要改成手動模式時，先確認目前 writer 已釋放，驗證原生 sync／查詢可用後再使用；要恢復自動模式則重新檢查追上來源與 watcher 所有權。回退只處理本次 CodeGraph 設定與其擁有的程序，不重啟現行 API 或網站，也不覆蓋其他人的未提交修改。

## 參考

- [CodeGraph v1.6.3 索引與同步](https://github.com/colbymchenry/codegraph/blob/v1.6.3/site/src/content/docs/guides/indexing.md)
- [CodeGraph v1.6.3 索引範圍設定](https://github.com/colbymchenry/codegraph/blob/v1.6.3/site/src/content/docs/getting-started/configuration.md)
- [OpenAI 官方 MCP 設定](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- 本機已核對的 v1.6.3 CLI help，以及 bundle 內的 `sync/watch-policy.js`、`mcp/index.js`、`mcp/project-lifecycle.js`、`index.js`。控制開關與同步行為若和文件摘要有差異，以固定版本實作及上述驗收結果判定。
