# AIRI Interaction Host（AIH）基線

> **AIH** 是 AIRI Interaction Host 的簡稱。後續討論可直接使用「依 AIH」、「更新 AIH」或「AIH 待決事項」指涉本文件所定義的架構邊界。

## 用途與狀態

本文件記錄目前已完成的能力、已確認的架構方向，以及尚未決定的議題。它是產品與架構基線，不是固定的實作規格，也不預先承諾特定產業情境。

目前第一個互動服務是餐飲點餐；其他互動服務尚未指定。餐飲、掛號、導覽或其他例子都不應被寫入 AIRI 共用層的領域邏輯。

## 核心模型

```text
AIRI Interaction Host（AIH）
├─ AIRI Core
│  ├─ 角色卡、Prompt、對話、LLM、語音與 Avatar
│  └─ 將目前可用的 WebMCP tools 交給 LLM runtime
├─ Kiosk Host
│  ├─ 顧客畫面、匿名顧客會話、管理入口與生命週期
│  └─ 嵌入已核准的互動網頁
└─ Interactive Service
   ├─ 自己的 UI、領域資料、商業規則與外部系統 adapter
   └─ 以 WebMCP 註冊自己可供 Agent 操作的 tools
```

AIH 不理解互動服務的領域名詞、流程或資料模型。互動服務也不應控制 AIRI 的角色、模型、語音或 Kiosk 全域生命週期。

## 已有能力

| 範圍 | 現況 |
| --- | --- |
| AIRI Core | 文字對話、ASR、TTS、角色卡、Prompt、LLM Provider 與模型設定。 |
| Stage Web | 一般 AIRI 網頁、開發與設定入口。 |
| Stage Kiosk | 橫式／直式顧客畫面、人物、互動網頁與對話區共存；具匿名會話、結束接待與管理入口。 |
| Kiosk lifecycle | 顧客活動、Agent Pending Work、閒置協助提醒、待機與會話清除。 |
| Proactive interaction | 本機人員存在／視線訊號可觸發招呼與提醒，並有校正與設定 UI。 |
| 第一個互動服務 | `apps/order-menu` 是獨立點餐 Web 服務，含菜單、客製化、購物車、模擬訂單與未來 POS adapter 邊界。 |
| WebMCP | 點餐服務已以 `document.modelContext.registerTool()` 註冊工具；工具呼叫會更新同一份 UI／領域狀態。原生 callback 同時相容有／沒有傳入 callback options 的目前 Chrome 行為。 |
| Native WebMCP adapter | Stage Kiosk 會從目前 allow-listed iframe 以 `getTools({ fromOrigins })` 探索原生 tools，轉為 LLM runtime tools，並以 `executeTool()` 執行。跨來源原始 `RegisteredTool` 與 Vue-safe descriptor 分離保存，避免 iframe 的 `window` handle 進入 Vue reactivity。 |
| Tool readiness | iframe 載入後會追蹤 `toolchange`，呈現 `loading`、`ready` 或 `unavailable`；文字送出會在未就緒時禁用，語音輸入則等候服務就緒。 |
| Service lifecycle | 互動服務只以 `activity`／`completed` 回報顧客流程；結束接待時由 Host reload iframe，產生乾淨的新匿名服務狀態。 |
| 完成後問卷邀請 | AIH Host 可在服務回報 `completed` 後顯示本機產生的 QR Code 問卷邀請。Stage Kiosk 與 Stage Web 使用相同的完成、略過／倒數、重置流程；服務本身不知道問卷存在。 |
| 工具可視化 | 點餐服務會顯示 Agent 選取、高亮、虛擬游標、規格／數量與購物車更新。 |
| 診斷 | 既有工具執行狀態與可選的 token usage diagnostics；WebMCP 執行失敗會在 Console 輸出工具名稱、來源 origin 與原始錯誤。 |

## 已確認決策

### 角色策略與操作能力分離

角色卡、Prompt 與未來 Skill 決定 AIRI 的身份、語氣、服務策略與任務規則。WebMCP 決定互動網頁實際提供哪些可執行能力。Prompt 不能取代 WebMCP，也不應硬編碼某個網頁的工具名稱。

### WebMCP-first，無 Tool bridge fallback

未來接入 AIH 的互動網頁預設皆支援 WebMCP。AIH 不再以 `postMessage` Tool bridge 作為相容方案。AIRI 需要一次性的通用 WebMCP adapter，將瀏覽器發現的 tools 接到既有 LLM runtime；每個互動服務不需要為 AIRI 寫另一套工具協議。

原生 WebMCP adapter 已取代 **Stage Kiosk／AIH 路徑**先前 MVP 的 `Scenario manifest + postMessage` Tool bridge。舊 bridge 文件僅保留作歷史參考，不得擴充。

`apps/stage-web` 仍保有舊的 `order-menu-bridge` 實作，尚未納入本次遷移；它不是顧客 Kiosk 的主流程。Stage Web 已針對目前 iframe 補上受來源／window 驗證的 `completed` lifecycle 接收，以維持完成後問卷與重置行為一致；這不代表 Stage Web 已完成 WebMCP adapter 遷移。

### 領域服務獨立

每個 Interactive Service 自行擁有 UI、領域資料、領域 Prompt、WebMCP tool schema、外部 API／POS adapter 與資料驗證。AIRI 共用層不可加入餐飲或其他特定領域的流程判斷。

### Host-owned 完成後問卷邀請

完成後問卷是 AIH Host 的可選顧客接待能力，不是 Interactive Service、角色卡或 WebMCP tool。服務只回報 `completed`；Host 依本機「問卷邀請設定」決定是否顯示浮窗。啟用時 QR Code 由瀏覽器以固定 HTTP(S) 問卷網址本機產生，第一版不得附加訂單、對話、會員、顧客識別或 token。

Stage Kiosk 和 Stage Web 的設定欄位與顧客行為相同，但因各自 origin 的 localStorage 而獨立儲存。多 Kiosk／店別設定服務是未來替換持久化來源的議題，不影響這個 Host 模組與 service lifecycle 邊界。

### 不採用座標自動化

Agent 的主要操作面是 WebMCP，而非 OS 滑鼠座標、螢幕辨識或 DOM 座標猜測。UI 視覺化是服務本身對 WebMCP 動作的呈現。

### 單機優先

現階段優先完成單機 Kiosk。多店、多 Kiosk、中央店別設定、設備憑證與遠端控制平面尚未決定，不應提前將資料庫、會員或雲端架構綁入目前 MVP。

## 明確邊界

| AIH 負責 | Interactive Service 負責 |
| --- | --- |
| 角色、對話、LLM、ASR、TTS、Avatar | 領域 UI、資料、流程、工具與外部系統整合 |
| Kiosk 畫面、匿名會話、顧客接待與管理模式 | UI 對 Agent 動作的視覺回饋 |
| 已核准網站的嵌入與 WebMCP tool discovery | 使用 WebMCP 註冊可執行能力 |
| 將 runtime tools 提供給 LLM | 驗證工具輸入與執行結果 |

## 目前待處理／待討論

### 通用 WebMCP adapter

- Stage Kiosk 的 adapter 已在 Chrome 以本機跨來源 iframe 驗證 `allow="tools"`、`exposedTo` 與 `fromOrigins`。正式 HTTPS 網域、重新載入與多服務切換仍需驗證。
- 情境網站 URL、標題與啟用狀態的最小設定模型仍待定義。
- Stage Web 是否遷移其既有 `order-menu-bridge` 至同一 adapter，仍未決定。

### 情境工具就緒生命週期

已實作通用狀態：iframe 載入後以 WebMCP `toolchange` 探索 tools，依序呈現 loading、ready 或 unavailable。已驗證本機跨來源探索與執行；重載與多服務切換邊界仍待驗證。

### Prompt、角色卡與 Skill

- 角色卡目前只有 `systemPrompt`、`description`、`personality` 被注入 LLM；`scenario` 與 `postHistoryInstructions` 尚未被注入。這使角色卡的情境切換不完整，應以通用角色卡投影修正，不可寫入餐飲專屬邏輯。
- 角色卡應承載哪些長期身份與人格內容；情境／營運 Prompt 應如何獨立保存與按需注入。
- 未來 Skill 如何縮短 system prompt、在需要時載入工作規則，且不取代 WebMCP tools。

### Kiosk 與互動網頁的生命週期事件

已定義極小 lifecycle signal：服務以 `activity`／`completed` 通知 Host；Host 以 iframe reload 重置下一位顧客的服務狀態。詳見 `docs/standards/interactive-service-lifecycle-v1.md`。仍需以其他 Interactive Service 驗證此事件模型是否足夠。

Host 可在 `completed` 與最終 iframe reload 之間插入可選的完成後 UI（目前為問卷 QR Code）。此 UI 不會回傳 lifecycle event 至服務，且略過或倒數只會觸發一次 Host 重置。

### 第二個非餐飲互動服務驗證

第一個服務已驗證點餐 UI 與 tool 視覺化，但尚未以另一個領域驗證 AIH 不含餐飲假設。下一個服務應是小範圍、可獨立啟動的 WebMCP 網頁，用來檢驗 tool discovery、lifecycle event、iframe reset 與通用 Prompt 策略；領域尚未指定。

### 單機設定與安全

目前服務 URL、部分設定與開發用 Provider 設定仍偏向瀏覽器 localStorage／`VITE_*`。單機 MVP 可先使用；正式設備部署時再決定管理權限、密鑰持有位置與設定同步方式。

### LLM 執行可靠性

已驗證瀏覽器工具探索與跨來源 iframe 實際執行；在 Chrome 原生 API 中，`executeTool()` 需使用 JSON 字串參數。跨來源 iframe 必須同時具備 `allow="tools"`、服務註冊時的精確 `exposedTo` host origin，以及 Host 探索時的 `fromOrigins`。

點餐服務對遺漏必要輸入不再直接拋出瀏覽器不透明錯誤，而會回傳 `{ ok: false, error, recovery }`，讓 LLM 可取得補救步驟後自行重試；不會猜測或自動補餐點 ID。

工具 schema 已補強 `menu_get` → `menu_select_item(itemId)` 的資料依賴，所有 domain-specific 前置條件應由服務工具 schema 擁有，而非由共用 AIRI Prompt 硬編碼。

不同模型在 Prompt 遵循、多步工具呼叫、讀取 `ok: false` 後重試、工具後自然語言回覆與 context 壓力下的表現仍需評估。可選 token diagnostics 已存在，但尚未提供完整的每步工具 token 拆分。

## 2026-09-05 實作與驗證快照

- 已完成：Stage Kiosk 的原生 WebMCP adapter、工具就緒狀態、通用互動服務 lifecycle，以及 order-menu 對舊 Tool bridge 的移除。
- 已完成：跨來源 WebMCP 的原始工具 handle 隔離、JSON tool invocation、工具註冊／卸載生命週期、callback options 相容處理，以及可重試的輸入驗證結果。
- 已驗證：實際 Chrome 環境中的 `localhost:5173` Kiosk → `localhost:5174` iframe 工具探索與執行；`@proj-airi/stage-kiosk` typecheck 與 lint、`@proj-airi/order-menu` typecheck 與 14 個 domain tests、`git diff --check`。
- 尚未完成：第二個獨立服務驗證、Stage Web 舊 bridge 的遷移決策、角色卡完整欄位投影、多 Kiosk／店別設定與正式設備安全模型。
- 測試限制：Stage Kiosk 的 Vitest 在目前開發環境啟動時遇到 `EMFILE: too many open files, watch`，尚未能執行測試；這是檔案監看資源限制，非測試 assertion 失敗。

## 2026-09-06 問卷邀請實作快照

- 已完成：`packages/stage-ui` 的共用 `FeedbackInvitation` 浮窗、問卷邀請設定格式與 HTTP(S) URL 驗證；QR Code 使用 MIT 授權的 `qrcode` 套件在瀏覽器本機產生。
- 已完成：Stage Kiosk 的管理設定與 `completed → 問卷 → 略過／倒數 → 匿名會話與 iframe 重置` 流程。Kiosk 不再以獨立的 10 秒完成計時器搶先重置。
- 已完成：Stage Web 的相同問卷設定頁、目前 iframe 的來源／window 驗證 completion receiver，以及 `completed → 問卷 → 略過／倒數 → 本輪 chat session 與 iframe 重置` 流程。
- 已驗證：`@proj-airi/stage-ui`、`@proj-airi/stage-kiosk`、`@proj-airi/stage-web` typecheck；問卷設定規則的 Vitest 測試與相關檔案 ESLint。
- 尚待人工驗證：實際掃碼裝置、問卷網址可達性，以及各瀏覽器上的完整訂單完成流程。Stage Kiosk 的 Vitest 仍受目前環境 `EMFILE` 監看限制影響。

## 相關現況文件

- `apps/stage-kiosk/README.md`：目前 Kiosk 的啟動與操作說明。
- `apps/order-menu/README.md`：第一個獨立互動服務。
- `docs/standards/interactive-service-lifecycle-v1.md`：WebMCP 之外的最小顧客活動與完成事件。
- `docs/standards/embedded-scenario-bridge-v1.md`：已淘汰的 MVP Tool bridge，僅供歷史參考。
- `docs/standards/restaurant-menu-agent-protocol-v0.1.md`：僅屬於餐飲點餐情境的領域文件，不是 AIRI 共用標準。
- `docs/solutions/architecture/webmcp-menu-service-research.md`：WebMCP 研究與第一版實作背景。
