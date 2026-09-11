# AIRI Interaction Host（AIH）基線

> **AIH** 是 AIRI Interaction Host 的簡稱。後續討論可直接使用「依 AIH」、「更新 AIH」或「AIH 待決事項」指涉本文件所定義的架構邊界。

## 用途與狀態

本文件記錄目前已完成的能力、已確認的架構方向，以及尚未決定的議題。它是產品與架構基線，不是固定的實作規格，也不預先承諾特定產業情境。最後一次程式碼核對：2026-09-07。

> Kiosk 的受控 Server、訪客資料保存與內部 POC 媒體策略已由後續的 [Kiosk 管理平面與訪客互動資料保存計畫](2026-09-08-kiosk-control-plane-plan.md) 取代。本文件中的「不保存畫面／影片」描述僅適用於通用 AIH 基線，不可用來覆蓋該受控 POC 的行為。

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
| Stage Web | 一般 AIRI 網頁、開發與設定入口；已接入 AIH 的 WebMCP adapter、匿名會話、完成後問卷與 iframe 重置。 |
| Stage Kiosk | 橫式／直式顧客畫面、人物、互動網頁與對話區共存；已接入匿名會話、結束接待、管理入口與本機觀測 POC。 |
| 顧客會話生命週期 | 兩端共用：顧客活動、LLM／工具執行中的閒置保護、45 秒後的繼續／新顧客確認、待機、完成、問卷後重置與匿名會話清除。 |
| 主動互動 POC | 僅 Kiosk：本機 MediaPipe 人員存在／朝向訊號可觸發招呼與無操作提醒；不使用 VLM、不保存畫面。 |
| 第一個互動服務 | `apps/order-menu` 是獨立點餐 Web 服務，含菜單、客製化、購物車、模擬訂單與未來 POS adapter 邊界。 |
| WebMCP | 點餐服務已以 `document.modelContext.registerTool()` 註冊工具；工具呼叫會更新同一份 UI／領域狀態。原生 callback 同時相容有／沒有傳入 callback options 的目前 Chrome 行為。 |
| Native WebMCP adapter | Stage Kiosk 與 Stage Web 共用 adapter，會從目前 allow-listed iframe 以 `getTools({ fromOrigins })` 探索原生 tools，轉為 LLM runtime tools，並以 `executeTool()` 執行。跨來源原始 `RegisteredTool` 與 Vue-safe descriptor 分離保存，避免 iframe 的 `window` handle 進入 Vue reactivity。 |
| Tool readiness | iframe 載入後會追蹤 `toolchange`，呈現 `loading`、`ready` 或 `unavailable`。Kiosk 會在未就緒時禁用顧客輸入；Stage Web 則只在工具探索成功後才將工具註冊給 LLM，並在 iframe 面板顯示不可用原因。 |
| 顧客對話可讀性 | 工具步驟在執行時可見，完成後預設收束但可展開；若模型在工具後未提供客戶可讀回覆，共用 runtime 會補上不含領域假設的下一步提問。兩端的客戶對話固定追隨最新訊息。 |
| 雙語介面基礎 | 既有 `settings/language` 是兩端共同的 UI 語系來源；Stage Web 與 Kiosk 都會即時套用其變動。日後由語音語言建議切換時，必須先取得顧客確認，不能僅依一次辨識結果自動切換。 |
| Service lifecycle | 互動服務只以 `activity`／`completed` 回報顧客流程；結束接待時由 Host reload iframe，產生乾淨的新匿名服務狀態。 |
| 完成後問卷邀請 | AIH Host 可在服務回報 `completed` 後顯示本機產生的 QR Code 問卷邀請。Stage Kiosk 與 Stage Web 使用相同的完成、略過／倒數、重置流程；服務本身不知道問卷存在。 |
| 工具可視化 | 點餐服務會顯示 Agent 選取、高亮、虛擬游標、規格／數量與購物車更新。 |
| 診斷 | 既有工具執行狀態與可選的 token usage diagnostics；WebMCP 執行失敗會在 Console 輸出工具名稱、來源 origin 與原始錯誤。 |

## 2026-09-07 已核對狀態

### 已完成並已有程式路徑

| 能力 | 現況與邊界 |
| --- | --- |
| 通用嵌入互動服務 | Stage Web 與 Stage Kiosk 都以 allow-listed iframe 嵌入服務；Host 不含餐飲領域資料或工具 schema。 |
| 原生 WebMCP | 兩端共用 `packages/stage-ui/src/services/webmcp-adapter.ts` 做跨來源 tool discovery、JSON invocation、ready/loading/unavailable 與 completion 回報。沒有舊 Tool bridge fallback。 |
| 匿名顧客接待 | `packages/stage-ui/src/composables/use-kiosk-customer-session.ts` 是共用生命週期；各 Host 只注入自己重置互動頁面的方式。 |
| 完成後問卷 | 服務發出 `completed` 後，Host 可依本機設定顯示 QR Code；略過或倒數結束只重置 Host 與 iframe，不把問卷耦合到服務。 |
| 第一個獨立服務 | `apps/order-menu` 具菜單、客製化、購物車、模擬確認、WebMCP tools 與 Agent 操作可視化；POS／支付未串接。 |
| 本機主動互動 | Kiosk 的 MediaPipe loop 只在設定開啟且當前政策需要時取得相機串流。landmark 與 observation 僅留在記憶體。 |
| 共用策略契約 | `packages/kiosk-proactive` 的 `KioskInteractionSettings` 已分開觀測、招呼、提醒、視覺輔助與媒體留存策略；預設全部安全關閉。 |
| Kiosk 單元測試 | `apps/stage-kiosk/vitest.config.ts` 避開開發期 Vite 外掛的廣泛檔案監看；目前 4 個檔案、11 個測試可直接執行並通過。 |

### 已實作但仍需人工驗證

- 正式 HTTPS 網域下的跨來源 WebMCP、iframe reload 與多服務切換。
- Stage Web 與 Stage Kiosk 實際走完「工具完成 → 問卷 → 重置 → 下一位顧客」的瀏覽器測試。
- 不同 LLM 的多步工具遵循、錯誤恢復、工具後自然語言收尾與 context 壓力表現。
- 實際問卷 QR Code 的掃碼可達性與行動裝置問卷流程。

### 已保留契約、尚未啟用功能

| 能力 | 目前狀態 |
| --- | --- |
| 事件式 VLM 視覺輔助 | 已有設定模型，尚未擷取單張相機畫面、呼叫 Vision Provider 或將結果給招呼／提醒。 |
| 視覺結果的短暫上下文 | 尚未實作；預定只對單一事件有效，下一位顧客或下一次事件不得沿用。 |
| 影像／影片保存 | 僅有 `disabled`／未來模式的策略欄位；尚未建立儲存、保留、存取或刪除機制。 |
| 資料告知與同意介面 | 尚未實作；目前不應以「匿名」名義收集可識別人物影像。 |
| 生產 Vision Provider 限制 | 產品方向已確認為僅 self-hosted Ollama 或 OpenAI-compatible server；尚未寫成部署期強制驗證。 |

## 已確認決策

### 角色策略與操作能力分離

角色卡、Prompt 與未來 Skill 決定 AIRI 的身份、語氣、服務策略與任務規則。WebMCP 決定互動網頁實際提供哪些可執行能力。Prompt 不能取代 WebMCP，也不應硬編碼某個網頁的工具名稱。

### WebMCP-first，無 Tool bridge fallback

未來接入 AIH 的互動網頁預設皆支援 WebMCP。AIH 不再以 `postMessage` Tool bridge 作為相容方案。AIRI 需要一次性的通用 WebMCP adapter，將瀏覽器發現的 tools 接到既有 LLM runtime；每個互動服務不需要為 AIRI 寫另一套工具協議。

原生 WebMCP adapter 已取代 AIH 的 `Scenario manifest + postMessage` Tool bridge。Stage Kiosk 與 Stage Web 都使用 `packages/stage-ui/src/services/webmcp-adapter.ts`；舊 bridge 文件僅保留作歷史參考，不得擴充。Stage Web 仍針對目前 iframe 以來源／window 驗證接收 `completed` lifecycle，以維持完成後問卷與重置行為一致。

#### 一般對話的工具清單

Stage Web／Kiosk 的一般 LLM 請求只合併目前 runtime 註冊的 WebMCP tools、request-scoped custom tools，以及已設定 API Key 時的 Web Search。`builtIn_debugRandomNumber` 與 `builtIn_emitSparkCommand` 已移除，不得作為全域工具重新註冊。MCP 的 list／call proxy 屬於明確啟用的 runtime 整合，Web／Kiosk 不應因未設定的 MCP 而提供該 proxy。未來需要跨模組協作時，應依當時協定與權限模型建立新的情境工具，不回復舊 Spark command 的全域暴露方式。

### 領域服務獨立

每個 Interactive Service 自行擁有 UI、領域資料、領域 Prompt、WebMCP tool schema、外部 API／POS adapter 與資料驗證。AIRI 共用層不可加入餐飲或其他特定領域的流程判斷。

### Host-owned 完成後問卷邀請

完成後問卷是 AIH Host 的可選顧客接待能力，不是 Interactive Service、角色卡或 WebMCP tool。服務只回報 `completed`；Host 依本機「問卷邀請設定」決定是否顯示浮窗。啟用時 QR Code 由瀏覽器以固定 HTTP(S) 問卷網址本機產生，第一版不得附加訂單、對話、會員、顧客識別或 token。

Stage Kiosk 和 Stage Web 的互動服務、Agent 指示與完成後問卷設定，使用同 origin 的 `airi/interaction-profile/v1` localStorage Profile；Profile 以乾淨預設值建立，不遷移舊的 host-specific key。既有通用模型、角色與語音設定也會在相同 browser origin 下共用。不同 origin、不同裝置與多 Kiosk／店別的中央設定服務仍是未來替換持久化來源的議題，不影響這個 Host 模組與 service lifecycle 邊界。

#### iframe URL 的設定優先順序

Host 以 Interaction Profile 中已啟用服務的 `serviceUrl` 原樣作為 iframe 的 `src`，並以該 URL 的 origin 驗證 lifecycle 事件及限制 WebMCP adapter。管理者在 **互動服務** 修改並儲存的 URL 永遠優先；`VITE_ORDER_MENU_URL` 與 `VITE_ORDERING_SCENARIO_URL` 只在該 browser origin 首次建立空白 Profile 時提供預設值，不能覆寫既有設定。`VITE_AIRI_ORIGIN` 則只由 Interactive Service 用於 WebMCP 的 allowed embedding origin，絕不會修改 iframe `src`。

### 不採用座標自動化

Agent 的主要操作面是 WebMCP，而非 OS 滑鼠座標、螢幕辨識或 DOM 座標猜測。UI 視覺化是服務本身對 WebMCP 動作的呈現。

### 單機優先

現階段優先完成單機 Kiosk。多店、多 Kiosk、中央店別設定、設備憑證與遠端控制平面尚未決定，不應提前將資料庫、會員或雲端架構綁入目前 MVP。

### 事件式視覺輔助，不建立第二套 Vision Provider

未來主動招呼與無操作協助可使用既有 Vision Provider，但必須由 AIH 的事件閘門觸發；不建立第二套 Vision 設定、Provider 或背景輪詢。第一版視覺流程固定為：合格事件 → Host 從相機擷取一張畫面 → 在事件時間預算內呼叫 Vision → 只將結果提供給該次招呼／提醒 → 丟棄。

目前影像來源只規劃相機。螢幕、iframe 或其他來源未納入此階段。若 VLM 逾時、失敗、未設定或回覆沒有可用內容，該事件必須靜默放棄；不得以延遲的通用招呼或舊畫面補送。

生產部署只允許自架 Ollama 或自架 OpenAI-compatible Vision server；雲端 Provider 僅可用於測試。影像分析結果不可預設寫入跨顧客對話、長期角色記憶或媒體儲存。

### 不以人數推斷訂單

本機觀測的人數只可作為事件資格或低打擾協助的參考。AIRI 不得宣稱偵測到幾人，也不得假設一人一份餐。只有顧客自己提及同行人數時，才可自然詢問是否還需要加點或調整。

## 明確邊界

| AIH 負責 | Interactive Service 負責 |
| --- | --- |
| 角色、對話、LLM、ASR、TTS、Avatar | 領域 UI、資料、流程、工具與外部系統整合 |
| Kiosk 畫面、匿名會話、顧客接待與管理模式 | UI 對 Agent 動作的視覺回饋 |
| 已核准網站的嵌入與 WebMCP tool discovery | 使用 WebMCP 註冊可執行能力 |
| 將 runtime tools 提供給 LLM | 驗證工具輸入與執行結果 |

## 目前待處理／待討論

### 通用 WebMCP adapter

- Stage Kiosk 的 adapter 已在 Chrome 以本機跨來源 iframe 驗證 `allow="tools"`、`exposedTo` 與 `fromOrigins`。Stage Web 已遷移至同一 adapter；正式 HTTPS 網域、重新載入與多服務切換仍需驗證。
- 情境網站 URL、標題與啟用狀態的最小設定模型仍待定義。

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

### 視覺輔助與資料治理

下一個實作階段的順序：

1. 抽出兩個 Host 都可提供的「單張相機畫面擷取」邊界；不接螢幕或 iframe。
2. 建立事件閘門執行器，使用既有 Vision Provider，確保每次只跑一次，並套用設定的逾時時間。
3. 將短暫結果傳給該次招呼／提醒的 LLM 呼叫；不寫入 chat history、角色記憶或 server context。
4. 在兩端接入相同的事件流程，再以人工瀏覽器測試確認關閉設定時完全不要求相機權限。
5. 另行設計資料告知／同意、儲存位置、保留期限、存取權限與刪除流程後，才可實作事件截圖或短影片保存。

此項不是單純前端開關：相機啟用與互動行為可由設備前端設定；Provider allow-list、媒體保存與存取規則應由正式部署的後端／設備管理設定控制。

### 多 Kiosk、店別設定與部署

- 第一版 Interaction Profile 保存在各瀏覽器 origin 的 localStorage；同 origin 的 Stage Web 與 Stage Kiosk 會同步互動服務、Agent 指示與問卷設定。不同 origin、不同裝置不會自動同步。
- 現有 `apps/server` 已提供可延伸的 HTTP／WebSocket 後端，並以 Postgres 保存帳號、設定、聊天與計費帳本；Redis 是其必要相依，用於快取、設定 KV、短暫用量累積與跨 instance Pub/Sub，而非正式資料的真相來源。
- 多 kiosk 正式部署應由中央 Ubuntu 主機提供同一個 Nginx origin：Web、kiosk、點餐互動頁維持靜態網站，Nginx 未來再將 `/api` 與 WebSocket 反向代理給 `apps/server`。各 kiosk 僅以瀏覽器 kiosk mode 開啟固定網址，不應安裝專案、Node 或保存共用 AI 金鑰。
- 未來需要店別設定模型、設備識別／憑證、中央設定同步、管理權限、密鑰持有位置、離線策略，以及將目前瀏覽器本機設定遷移至後端的方案；這些尚未實作或選定。
- 現階段不要把會員、POS、支付或中央雲端管理加入 AIH 共用層。它們應留在各領域服務或未來管理平面。

## 2026-09-05 實作與驗證快照

- 已完成：Stage Kiosk 的原生 WebMCP adapter、工具就緒狀態、通用互動服務 lifecycle，以及 order-menu 對舊 Tool bridge 的移除。
- 已完成：跨來源 WebMCP 的原始工具 handle 隔離、JSON tool invocation、工具註冊／卸載生命週期、callback options 相容處理，以及可重試的輸入驗證結果。
- 已驗證：實際 Chrome 環境中的 `localhost:5173` Kiosk → `localhost:5174` iframe 工具探索與執行；`@proj-airi/stage-kiosk` typecheck 與 lint、`@proj-airi/order-menu` typecheck 與 14 個 domain tests、`git diff --check`。
- 尚未完成：第二個獨立服務驗證、角色卡完整欄位投影、多 Kiosk／店別設定與正式設備安全模型。
- 歷史註記：當時 Stage Kiosk 的 Vitest 曾因 `EMFILE: too many open files, watch` 無法啟動；已於 2026-09-07 以 Kiosk 專用 Vitest 設定解決，現可執行 11 個 Kiosk 單元測試。

## 2026-09-06 問卷邀請實作快照

- 已完成：`packages/stage-ui` 的共用 `FeedbackInvitation` 浮窗、問卷邀請設定格式與 HTTP(S) URL 驗證；QR Code 使用 MIT 授權的 `qrcode` 套件在瀏覽器本機產生。
- 已完成：Stage Kiosk 的管理設定與 `completed → 問卷 → 略過／倒數 → 匿名會話與 iframe 重置` 流程。Kiosk 不再以獨立的 10 秒完成計時器搶先重置。
- 已完成：Stage Web 的相同問卷設定頁、目前 iframe 的來源／window 驗證 completion receiver，以及 `completed → 問卷 → 略過／倒數 → 本輪 chat session 與 iframe 重置` 流程。
- 已驗證：`@proj-airi/stage-ui`、`@proj-airi/stage-kiosk`、`@proj-airi/stage-web` typecheck；問卷設定規則的 Vitest 測試與相關檔案 ESLint。
- 尚待人工驗證：實際掃碼裝置、問卷網址可達性，以及各瀏覽器上的完整訂單完成流程。Kiosk 的 Vitest 監看限制已於 2026-09-07 解決。

## 2026-09-06 Stage Web 原生 WebMCP 遷移快照

- 已完成：Stage Web 移除已淘汰的 `order-menu-bridge` 與餐飲專屬的 host tool schema，改由共享 adapter 從 active iframe 探索並註冊原生 WebMCP tools。
- 已完成：Kiosk 的 adapter 實作移至 `packages/stage-ui`，兩個 Host 使用相同的來源限制、Vue-safe tool descriptor、JSON invocation 與 tool readiness 行為。
- 行為：瀏覽器或互動服務不支援 WebMCP 時，Host 不提供該服務的工具；不再顯示錯誤的「請啟動 order-menu」訊息，也不退回 `postMessage` Tool bridge。
- 已驗證：共享 adapter 的 native discovery／JSON execution 回歸測試，以及 `stage-ui`、`stage-web`、`stage-kiosk` typecheck 與相關 ESLint。

## 2026-09-07 共用顧客生命週期與視覺策略基礎

- 已完成：匿名顧客會話的狀態、閒置計時、AI 執行中的逾時保護、完成與清理流程移至 `packages/stage-ui`。Stage Kiosk 只保留其 iframe reload adapter；Stage Web 以自己的 iframe reset revision 接入同一流程。因此兩端現在共用「活動 → 等候工作 → 閒置確認 → 完成 → 問卷（若啟用）→ 重置」的核心語意。閒置 45 秒會先顯示保留目前接待或開始新接待的選擇，未選擇才在 15 秒後重置。
- 已完成：`packages/kiosk-proactive` 定義 `KioskInteractionSettings`，將本機觀測、主動招呼、協助提醒、單次視覺輔助與未來影像留存拆為獨立策略。所有視覺相關預設皆為關閉。
- 保證：目前新增的視覺策略不會自行開相機、不會呼叫 Vision provider、不會把畫面放入 LLM context，也不會保存截圖或影片。它只是為下一階段的「事件觸發、單次、逾時即捨棄」執行器保留統一契約。
- 尚未完成：將既有 Vision provider 以事件閘門接入兩個 Host、由 Host 擷取相機單幀、正式環境的 self-hosted provider 驗證、資料告知／同意 UI，以及部署端的影像／影片保存政策。
- 已驗證：`kiosk-proactive` 的 14 個 Vitest 測試、Kiosk 的 4 個測試檔／11 個單元測試、`kiosk-proactive`／`stage-ui`／`stage-kiosk`／`stage-web` typecheck，以及 `stage-kiosk`／`stage-web` lint。Kiosk 的 Vitest 已以專用設定避免開發期檔案監看上限。

## 相關現況文件

- `apps/stage-kiosk/README.md`：目前 Kiosk 的啟動與操作說明。
- `apps/order-menu/README.md`：第一個獨立互動服務。
- `docs/standards/interactive-service-lifecycle-v1.md`：WebMCP 之外的最小顧客活動與完成事件。
- `docs/standards/embedded-scenario-bridge-v1.md`：已淘汰的 MVP Tool bridge，僅供歷史參考。
- `docs/standards/restaurant-menu-agent-protocol-v0.1.md`：僅屬於餐飲點餐情境的領域文件，不是 AIRI 共用標準。
- `docs/solutions/architecture/webmcp-menu-service-research.md`：WebMCP 研究與第一版實作背景。
