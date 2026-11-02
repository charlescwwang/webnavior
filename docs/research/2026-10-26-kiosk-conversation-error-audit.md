# Kiosk 對話錯誤盤查（2026-10-26）

狀態：盤查與下述修正已完成本機驗證，2026-10-27已配套部署Menu／Kiosk／API供現場測試；部署保存完整變更快照，之後依使用者要求分批提交。最初62秒掛起的現場原因仍未證實，實體收音／付款設備驗收仍待進行。時間均為 Asia/Taipei。前半部保留盤查當時的證據與診斷結果，最新完成範圍見文末。

## 範圍與結論

以上次場域部署 2026-10-22 16:30:18 為界，查詢至本次盤查，取得 27,200 行 API journal、549 筆互動紀錄、11 個會話。實際保留的互動時間為 10/22 18:36:12 至 10/24 12:05:19。沒有 10/25–26 的新互動可供分析，不能推定未保存或其他設備的錯誤不存在。

主要問題是「一次工具連線失效後連續錯誤」與「無工具回覆缺少可接受的呈現契約」，另有四次 ASR 上傳超過限制。不是所有錯誤都代表模型無法連線。

| 類型 | 數量／證據 | 結論 |
| --- | --- | --- |
| 模型呼叫前失敗 | 同一會話連續 44 個 `modelRounds:0` task | 本機 Menu context／工具路徑已不可用，仍反覆接手新語音 |
| 已呼叫模型、沒有工具 | 25 個 task；每個有模型草稿，沒有保存的 `verified_reply` | 呈現規則會拒絕缺少服務資格或回執的文字，包含部分說明及澄清 |
| 歷史讀取迴圈 | 1 個 task，五輪模型，四筆空歷史結果 | 第五次 history call 在工具迴圈上限處停止 |
| 工具明確拒絕 | 1 個 Main task | 用餐方式的目標控制項不可見，沒有成功回執 |
| 工具結果未返回 | 1 個 Main task，約 62 秒 | 與後續 44 次連續失敗形成相符的連線撤銷路徑 |
| ASR 上傳錯誤 | 4 個 HTTP 500，stack 均為 `hono/body-limit` | 超出請求限制，且 413 被全域錯誤處理轉成 500 |

共 76 個 Main task metrics：44 個沒有進入模型，32 個實際進入模型；後者只有 4 個保存了最終 `verified_reply`，其餘 28 個的分解為 25+1+1+1。這不是全站成功率，也不是 72 次螢幕錯誤的精確計數：錯誤列只留在前端訊息，metrics 沒有保存最終顯示內容或失敗 stage/reason。不能把缺少持久化回覆直接等同特定畫面文案。

## P1：工具失聯後持續把新語音送進失敗路徑

會話 `XCUxZDduVj8c7ZwFGx4zp`：

1. 18:46:38，seq227 的語音送 Main。18:46:39，seq230 要求 `menu_get({query:"水餃"})`，沒有對應 tool result。
2. seq234 task metrics：`taskId:agent:155`、`durationMs:62002.1`、`modelRounds:1`、`requestedToolCount:1`、`interrupted:true`。這個欄位也涵蓋 deadline 到期，不能直接解讀為顧客中斷。
3. 18:47:41–18:52:16，seq236–365 有 44 個 task metrics，全部 `modelRounds:0`、`requestedToolCount:0`、`interrupted:false`，耗時 1.8–8.4ms，沒有 taskId。其間仍保存新 ASR，但沒有 Main request／round metrics；不能歸因於模型逐次逾時。
4. 18:52 後重新開始會話，後續會話恢復有正常工具回覆。這是時間關聯，不證明哪一種重設操作修好了連線。

原始碼可解釋連鎖故障：

- `packages/stage-ui/src/services/interactiveServiceClient.ts`：RPC 60 秒到期或其他 execute exception，將 availability 設為 unavailable、清空工具並 dispose connection。這是為了避免遺失寫入回執時盲目重送。
- `apps/stage-kiosk/src/services/kiosk-fast-path.ts`：找不到 semantic candidate tool 時，以 `SYSTEM_ONE_DISABLED` 轉交 Main，沒有先確認這是工具連線故障。這條路徑也無法再用 Menu context 判斷是否只是背景話語。
- `KioskScene.vue` 的 Main `prepareRound`：沒有 `kiosk_conversation_context` 就立即丟錯。
- `useKioskInteractionRecording.ts` 的 catch 把這種前置錯誤沿用 `provider-error`，因此沒有呼叫模型也會顯示模型連線失敗；metrics 丟失真正原因。

已用 test-only 重現「連續兩次 context 不可用 → 兩次 provider-error、零模型呼叫、零輪 metrics」。這驗證後半段錯誤分類，沒有重播原始瀏覽器的 60 秒掛起。

第一筆 `menu_get` 為何沒有返回仍未確認。需優先檢查 `apps/order-menu/src/App.vue` 的 `onMenuPresentationActivity`：載入 skeleton 時等待 `nextTick()` 和沒有時間界線的 `requestAnimationFrame`；`webmcp.ts` 會等待該回呼後才執行查詢。這是具體可調查的等待點，但沒有現場頁面可見性、瀏覽器 console 或 trace，不能斷言它就是本案原因。

修復應區分已知唯讀失敗與可能已寫入卻遺失結果；先停住不可用的自動交接、提供明確恢復狀態，再驗證新連線和權威訂單狀態。不能恢復連線後自動重送舊加購、結帳或付款。

## P1：完成的說明／澄清也落入通用錯誤

`questionPresentation.ts` 的 `replyFromConversation` 只允許明確 `serviceReply` 的無工具文字；未知服務沒有回執時回傳 error。`conversationDecisionStateFrom` 只有 `GENERAL_QUESTION` 設定這個資格，`UNCERTAIN_OPERATION` 沒有。模型草稿本身不會建立應用程式擁有的 pending question。

具體案例：

| 時間 | 原句／模型草稿 | 持久化證據 |
| --- | --- | --- |
| 10/22 18:45:47 | 詢問湯包推薦 → 模型說沒有湯包，列出既有便當 | XCU… seq194–198；1 模型輪、0 工具、無 verified reply |
| 18:46:20 | 問湯包有哪些餡 →「我們目前菜單中沒有湯包。」 | XCU… seq213–217；1 模型輪、0 工具、無 verified reply |
| 18:53:07 | 提到炒飯、需要三份 → 模型說沒有炒飯並列出便當 | k0T… seq9–13；1 模型輪、0 工具、無 verified reply |
| 18:59:09 | 詢問信用卡／行動支付 →「目前支援 LINE Pay 與街口支付。」 | LtPe… seq45–49；1 模型輪、0 工具、無 verified reply |

Jev journal 確認湯包推薦及付款方式案例走過 `serviceRequest:REQUEST`，並非該服務完全無回應。相關 Main round 的 toolBytes 分別有 11,833 bytes，因此不能把這批歸為上次「includeCatalog 關閉即清空工具」的同一缺陷；模型收到工具仍可能只生成文字。

新增兩個診斷案例，驗證 ordering／checkout-payment 的 `UNCERTAIN_OPERATION` 加完成的無工具說明，確實呈現為通用 error。這是明確條件下的行為重現；沒有保留每輪完整 frontend decisionState，不能宣稱重建了現場每個欄位。

不能直接開放所有無工具文字。這批草稿也包含沒有對應操作的「已選擇餐點」「已設內用」，以及 19:01 的「目前僅支援現金支付」。既有保護有攔下不實成功宣告的必要。後續應讓澄清、服務說明、菜單事實查詢與操作結果各有可信來源；有完整當輪 catalog 的否定查詢，也需要明確可驗證的回答出口。

## P2：其他已確認失敗

- `HMvnVeDQNbr5-_IOulJCh` seq2–18（18:36）：模型對同一 `kiosk_session_history({before:0})` 連問五輪，四次都取得空 entries；第五次要求沒有結果，四次已提交工具數耗盡迴圈。沒有較早歷史可讀，應檢查空分頁及相同查詢的停止條件，而非提高回合上限。
- XCU… seq74–79（18:42）：`order_set_fulfillment({mode:"takeout"})` 回 `{ok:false,error:"The requested order control is not visible."}`。`App.vue` 的精確控制項保護有生效；當時為何不可見仍缺 DOM／console 證據。
- 18:55:28、18:57:13、19:00:18、19:01:11：`POST /api/kiosk/audio/transcriptions` 500，均在 `hono@4.11.3` body-limit 第15行的 413 HTTPException 路徑。`app.ts` 除資產／media 外採 1MiB 限制，ASR 沒有專屬分支；onError 只處理 ApiError，其他 exception 統一回500。這四次不能算模型理解失敗。沒有保留音檔大小／時長，尚不能指定合理新上限。
- 18:37:23，一次 decision continuation 400：`Visitor session is not active`，屬於已結束會話的延遲請求，不是之前付款方式 picklist 的400。

## 現況與驗證限制

10/26 盤查時 API 仍為上次部署的 PID4107684，active/running；本機 livez/readyz 200，DB／Redis ok。Bridge 5170 和經 Nginx 5169 的 `/menu-api/health` 都200。Menu／Kiosk HTML SHA256 及 bundle entry 仍符合10/22 release metadata。

命令列直接探測公開網域被 Cloudflare 回403／1010，Kiosk 與 Menu health 都相同；這不能視為公開網站對真實瀏覽器的停機證據。沒有為此更動 WAF／Nginx。沒有重播模型、操作現場購物車、付款或原始語音。

驗證：

- `pnpm -F @proj-airi/stage-kiosk exec vitest run src/composables/useKioskInteractionRecording.test.ts src/services/questionPresentation.test.ts`：74通過，含3個新增診斷案例。
- 兩個修改測試檔的 ESLint 和 `git diff --check` 通過。沒有產品程式變更，不執行全專案 typecheck。
- 原始 journal、資料庫摘錄、413組配對 Jev request/response 及32輪摘要保存在權限0600的 `/tmp/webnavior-20261026-{api.log,entries.json,decisions.json,turn-audit.json}`；未將完整顧客逐字稿或模型提示放入 Git。

下一個修復單位應先處理工具失聯後44次連續錯誤與誤標 provider-error，再補可驗證的澄清／說明出口及 ASR 的413契約；分別驗收，保留未確認寫入不可重送的邊界。

## 整合修正計畫

本節依本次對話確認的需求編列：修復連續錯誤、正常說明被擋及語音上傳限制，同時保留點餐、結帳與付款的既有授權。此節保留實作依據；前述74個測試是盤查階段基準，實際完成範圍與驗證見文末。

### 執行順序與修改範圍

| 順序 | 修改單位 | 完成條件 |
| --- | --- | --- |
| 1 | 故障診斷與最小重現 | 能區分首次等待、傳輸撤銷、context 準備失敗與回覆驗證拒絕；每項先有重現測試 |
| 2 | Menu 顯示等待及工具連線恢復 | 顯示效果不再無限阻塞查詢；失聯期間不反覆轉交失敗的 Main；恢復不重送舊寫入 |
| 3 | 說明、澄清與操作結果的回覆契約 | 正常服務回答有可驗證出口；不實操作完成文字仍被擋下 |
| 4 | ASR 大小限制與長語段 | 音訊有專屬限制、超限回413；任何切段方案都不把半句需求直接送去執行 |
| 5 | 空歷史迴圈、不可見控制項、會話切換 | 空分頁不耗盡回合；只在可見且狀態合法時操作；舊請求不影響新會話 |
| 6 | 跨流程驗收 | 語音／觸控、故障／恢復、購物車／結帳的狀態與回覆一致，才視為可交付 |

沿用現有 Eventa iframe 通訊、Menu runtime、Valibot、Vitest 與既有 Browser 測試入口。先搜尋內部實作，不新增另一套購物車、訂單 store、模型審核服務或泛用工具套件。若後續確需新依賴，先研究候選並依 AGENTS.md 由使用者選擇；本計畫未選定新套件。

### 1. 保存可定位的失敗原因

- 擴充既有 task metrics，保存 task／visitor／binding 關聯、失敗階段、終止原因、實際模型輪數、工具是否送出、是否收到確定結果，以及最終呈現狀態。不要把前置 context 錯誤沿用 provider-error。
- 在 Menu 的顯示等待、domain 執行與回執傳送邊界保留開始／結束診斷，才能判斷62秒停在哪個階段。沒有新證據前，維持「首次掛起原因未證實」。
- 沿用已有記錄入口，限制欄位及長度；不新增完整模型提示、電話、音訊或工具原始 payload 到一般日誌。
- 本次三個測試是目前缺陷的診斷斷言。實作時改為預期修復行為，保留來源註解，不能把持續回傳 provider-error 當作修復成功。

主要位置：`useKioskInteractionRecording.ts`、`KioskScene.vue`、共用互動契約及 `interactionContracts.ts`，搭配既有測試。

### 2. 限制顯示等待，分開傳輸與訂單狀態

- 先重現 `onMenuPresentationActivity` 等待畫面繪製的路徑。Skeleton 是顯示效果，不能成為查詢完成的無限先決條件；為等待提供有界完成與生命週期清理。呈現未完成時不能宣稱「已顯示」。
- 保持資料讀取、可見呈現、訂單寫入的區別。`menu_recommend` 雖不改購物車，仍會改推薦批次與歷史，不能直接當成可透明重送的純讀取。
- 區分管理員停用 System One 與互動服務失聯。後者應產生明確的服務不可用狀態；只有連線 ready、snapshot 可用時，才進入需要 Menu 的 Agent 任務。
- 失聯期間保留現有購物車／畫面，合併重複故障通知；不累積稍後會自動執行的語音訂單。可保留診斷文字，但明確標示該句未執行。
- 以現有 discovery／refresh 進行單一、有界的恢復嘗試。不要自動重載 iframe，因為那可能重設瀏覽器內的訂單。重新握手後核對 document／binding、Menu revisions、購物車、checkout／payment 與 Agent 任務控制權。
- 同一頁面上舊任務可能仍在執行；重新握手本身不能證明它已停止，也不能直接解鎖。必須取得該任務已結束或被拒絕的確定結果，否則保留結果不明狀態。
- 新 document 不得繼承舊任務、確認票據或成功回覆；若舊 document 的訂單已無法查證，提示核對，不虛構還原成功。

主要位置：`App.vue`／`webmcp.ts`、共用 `interactiveServiceClient.ts`、`ScenarioSurface.vue`、`kiosk-fast-path.ts`、`KioskScene.vue`。共用 client 不反向依賴 Kiosk app；工具效果的擁有者與中立契約需先確認再調整。

### 3. 以目前事實接納說明與澄清

- 整理 Main 已取得的 `ConversationContext`、`serviceReply`、handoff、question 和 outcome，讓 Main 接手後能表達「需要澄清／服務資訊／菜單資訊／操作結果」，不被最初不確定的路由永久限制。模型自稱某類回答不等於獲得操作或事實驗證資格。
- 服務資訊使用當前已發布設定及 context，例如付款方式以 `allowedPaymentMethods` 為準。餐點存在與否使用本輪完整 catalog 或實際查詢結果；若 context 不完整或已變動，先取得新資料。
- 只有資料判定確實覆蓋原問題，才可說「沒有這個餐點」。例如查不到字面「湯包」不能自動證明任何別名／種類的問題已完整解決；有歧義要澄清。
- 一般澄清沿用既有 `order_ask_question`／問題回執機制，檢查當前 phase 的合法性。問題的回答不能自動變成加購、取消、結帳或付款同意；高風險確認仍綁定既有票據、revisions 與有效期限。
- 操作成功及目前購物車內容仍依同任務的實際回執／新 snapshot 產生。無回執的「已加入／已改內用」和違反設定的「只收現金」仍必須擋下。
- Server 草稿、前端顯示及 durable assistant history 使用同一驗證結果。只有通過的最終文字保存為 `verified_reply` 一次，避免未通過草稿污染後續理解。
- 不增加一輪模型審核，也不靠成功詞關鍵字替代狀態與回執驗證。

主要位置：`conversationContext.ts`、Server Kiosk routes、`kioskConversation.ts`、`questionPresentation.ts`、`kiosk-fast-path.ts` 和 `KioskScene.vue`。

### 4. 統一錄音、上傳與 ASR 的限制

補充原始碼事實：`kiosk-audio.ts` 編碼16kHz／單聲道／16-bit PCM WAV，每秒32,000 bytes，加44-byte標頭及 multipart 開銷。1MiB 約只容納32.8秒以下；不是允許1分鐘語音。`defaultKioskVoiceVadSettings.maxSpeechDurationS` 則為9999，管理 API 也允許到9999；這證明目前可錄長度與可上傳大小不一致，但不是那四筆音檔的實測時長。

- ASR 端點使用專屬 body limit，其他 JSON／media／資產限制各維持其責任。保留 Hono HTTPException 的413語意，回傳前端可辨識的超限代碼。
- 實作前確認目前發布的 VAD 設定、音訊 padding、ASR 上游單次可接受大小／時長與 request timeout，再決定有界數值；不能把9999秒直接換成約320MB上傳額度。
- 不悄悄縮短既有 Site 的 VAD 設定，也不先截斷後假裝整句已辨識。先檢查已有音訊／串流切段能力，再完成長語段方案。
- 如果必須分段辨識，切片保留原發言ID及樣本順序，重組完整辨識結果後才交給語意決策。任一片失敗、取消或會話變更，都不能把剩下半句當完整點餐命令；不得因重試切片重複執行需求。
- 前端區分音訊超限、ASR連線失敗與辨識失敗，提供對應提示。長語段處理的產品限制及新設定需與管理介面／文件一致。

主要位置：`app.ts`、`routes/kiosk/index.ts`、`kiosk-device.ts`、`kiosk-audio.ts`、既有 VAD／語音佇列與 `KioskScene.vue`；若涉及 Site 設定，沿用 `packages/kiosk-proactive` 的契約與設定流程。

### 5. 防止其他已確認的無效迴圈

- 歷史查詢的停止條件以同一 visitor 的 pagination cursor 為準。回傳空頁或沒有 `nextBefore` 就代表這條往前查詢已結束；同一 task 不再次查詢相同 cursor，也不因 call ID 不同而繞過。保留既有回合／工具上限。
- 用餐方式控制項先由 Menu runtime 打開正確 review、等待有界 DOM 更新，再解析精確控制項。找不到時在 domain 寫入前明確失敗；不要改成任意元素 click 或取消檢查。驗證空車、有餐點、設定彈窗與未付款 checkout 的合法切換。
- 會話結束後的遲到 decision／tool／SSE 回覆依 visitor、task、binding 丟棄。正常的取消與舊會話400不能顯示成新顧客的模型錯誤。

### 點餐保護與驗收矩陣

| 驗收情境 | 必須成立 |
| --- | --- |
| 查詢逾時後再說三句話 | 不反覆建立注定失敗的 Main task；購物車保留；恢復後由新需求繼續 |
| 推薦已顯示但回覆遺失 | 不自行換下一批、不重複推薦歷史；資料與可見畫面狀態分別確認 |
| 加購未執行／明確拒絕 | 不回覆成功、不新增 cart line |
| 加購已執行但回執遺失 | 不重送；最新cart不能單獨冒充原操作的確定回執，因相同品項可能合併且有人手動修改 |
| 改數量、移除、內用／自取後失聯 | 保留已完成狀態，不用舊snapshot覆寫，不因恢復重複修改 |
| 付款pending／uncertain、送單結果不明 | 不再次付款、送單、清車或開啟新單；查證能力不足時明確保留待處理狀態 |
| 湯包／炒飯不存在、付款方式詢問 | 能依完整目前資料回答或澄清；不產生假操作與假店家資訊 |
| 連續說多餐點、修改後追加、否定與改口 | 完整保留原需求，不因ASR切段或恢復而只完成其中一部分 |
| 語音與觸控交替、舊任務晚回、重新開始 | revisions／確認票據／任務控制權隔離；舊回覆不改新訂單 |
| 音檔小於／等於／超過新上限 | 正常通過或明確413；不是500；超限語句沒有執行任何訂單操作 |
| 一個長語段被分成多片 | 無樣本遺失／重複，依序重組；缺片不執行半句；不跨visitor |
| 空歷史與重複cursor | 在有限次內停止，保留正常回答／澄清能力 |

驗證先跑新重現，再跑受影響的 Menu／Kiosk／Server 測試、shared client browser 測試與必要 package-scoped typecheck／changed-file lint。完整掛起的重現及恢復驗收必須包含真實瀏覽器，不只 mock callback。沿用既有 fieldRegression／historicalReplies 覆蓋先前的份數、複合需求、推薦範圍和 checkout 問題隔離。

各單位完成後更新相應 source-of-truth／README／handoff。配置模型的隔離重播、場域語音與實際付款設備驗收各自列出結果，不能以純單元測試取代。規劃階段不操作場域訂單、不提交、不部署，也不自動執行全專案 typecheck。

## 本機實作結果

2026-10-26 使用者授權依計畫實作後，完成以下調整；沒有新增依賴、資料庫 migration、提交、服務重啟或部署。

| 項目 | 實際修改 |
| --- | --- |
| 連續失聯錯誤 | Fast Path 在服務非 ready 時停止，不能把工具失聯當成 System One 停用而轉給 Main。缺少 Menu context 回 `context-unavailable`，不再回 provider-error；task metrics 保留 task ID、failure stage／reason |
| 工具恢復 | 新增同 binding／document 的 inspection RPC。只有遺失回執的所有 operation ID 均 settled 且沒有 pending call 才恢復工具；不重送輸入、不重載 iframe。Host 取得新 snapshot，僅結束自己已確定完成的 task。BEGIN 已送出但未收到回執的 owner 與已確認 owner 分開保存 |
| 顯示等待 | skeleton 改用既有有界 timer，不再把一次查詢的完成綁在無界動畫 frame 上。這移除具體的掛起風險，但不能證明現場首筆逾時就是它造成 |
| 說明／澄清 | Main 可選結構化的付款方式、用餐方式、指定菜單名稱資訊或澄清；應用程式依新讀取的 context 產生回答，不直接放行模型成功文字。資訊回覆保留既有問題；澄清使用真實問題 ID。要求展示菜單仍需呈現回執，已知加刪改任務仍需相應操作回執 |
| 付款資訊 | Context 新增店家實際提供的付款方式與標籤，與當前 phase 的可執行付款方法分開；資訊說明不授權付款 |
| 音訊 | 每片最多20秒，優先在最後一秒較安靜的20ms視窗切分，無重疊／遺失樣本。上傳帶同次發言UUID、chunk index及原始樣本範圍。所有片段成功後依序重組，保留完整原始錄音，才進入一次點餐判斷；缺片、空辨識、取消／session reset／15秒reservation逾期不執行半句 |
| 上傳限制 | 保留1MiB，ASR採專屬錯誤契約 `KIOSK_AUDIO_TOO_LARGE`／413。全域處理保留 Hono HTTPException status；不擅改發布的9999秒VAD政策。20秒PCM WAV約640KB，保留multipart空間 |
| 歷史／控制項 | 空頁或沒有nextBefore即停止提供本輪history工具，同cursor不重讀。Chrome確認空車的OrderReview原本隱藏用餐方式；現在未完成訂單在空車也顯示合法控制項，實際動畫、cart及snapshot一起驗證 |
| 可觀測性 | Tool execution通知及有界service_event包含connection/document/operation/task關聯與called/resolved/failed階段；另保存最終回覆presented/rejected，沒有加入原音或完整模型提示 |

實作沿用既有[Hono body-limit](https://hono.dev/docs/middleware/builtin/body-limit)及[HTTPException處理](https://hono.dev/docs/api/exception)。對背景頁面frame的風險說明參照[MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)。沒有以延長工具／模型時間上限、提高回合數或自動重送訂單來掩蓋問題。

### 驗證與限制

- Menu Node suite：757通過，176個原有選用案例跳過。Kiosk Node suite244通過／48跳過；音訊／device subset 12項亦通過。
- Server本次相關app／Kiosk routes／Agent／decision suites：506通過、80個選用案例跳過。
- 真實Chrome：interactive-service16項通過，包含已接受加購仍pending時拒絕恢復、settled後同車只有一份、拒絕接到replacement document；FieldState3項通過，包含空車／有餐點的內用與自取反覆切換及既有完整菜單顯示。
- 額外擴大到CheckoutActions／CheckoutFocus的browser batch在啟動後卡住，已終止，未列入通過數。通過的FieldState使用隔離的最小Vue browser設定；interactive-service最終使用既有`vitest.interactiveService.config.ts`。沒有為此更改共用測試設定或保留暫存配置／失敗截圖。
- Menu、Kiosk、Server、stage-ui、stage-shared package-scoped typecheck通過；新增必填ToolExecution關聯欄位也同步更新PhoneEntry測試bridge。修改檔ESLint及diff whitespace檢查通過；Menu與Kiosk production build通過。沒有執行root全專案typecheck。
- 使用既有configured replay、唯讀production設定連線及獨立mockDB／simulator跑兩個合成問題：湯包詢問透過menu_get回實際查不到；內用／自取資訊以無工具結構化回答「目前提供內用、自取。」完成。2項均通過，cart保持空；私有log為`/tmp/webnavior-configured-explanation-20261026-034832.log`。沒有把原始顧客對話送進模型，也沒有操作production訂單／付款。
- 尚未進行實際長音訊ASR、麥克風環境、店內完整點餐及實體付款設備驗收。單元測試的樣本逐byte一致性／完整重組不代表真實ASR不會聽錯切分邊界。先前記錄的混合需求模型失敗及其他語意問題，沒有宣稱被本次修正全面解決。

部署時須配套更新Menu、Kiosk與Server以符合新inspection／context契約；目前線上仍為10/22版本。

## 2026-10-27 可本機處理項目的追查與驗證

使用者要求先處理可處理的部分；以下更新取代上節的結帳browser卡住與整句ASR固定15秒期限限制。沒有提交、部署、重啟、安裝依賴或操作現場訂單。

- **結帳測試啟動卡住已定位**：root與Kiosk的Vitest雖同為4.1.4，pnpm依peer context解析為不同實體，browser/provider也不同。root runner搭配Kiosk設定時，Chrome已連上但測試內容未開始；改用README既有的`pnpm -F @proj-airi/stage-kiosk exec vitest run --config vitest.browser.config.ts`即通過。同時修正OpenCC預先打包從真正擁有它的`@proj-airi/stage-ui > opencc-js`解析，避免從Kiosk根目錄解析不到。沒有新增測試專用設定或改tsconfig。
- **長音訊期限已先重現再修正**：三片各6秒成功的ASR，原先在總計15秒取消。現在只在一整片成功後更新15秒無進展期限；完整辨識後另起15秒的排隊新鮮度期限。保留原始capture順序與時間，不把部分文字交付點餐。測試覆蓋總計18秒後一次交付、後片卡住後整句丟棄並釋放後續語句、空片、visitor reset及已完成語句排隊過久。
- **實際配置ASR合成錄音**：以既有TTS產生三句合成語音，再用系統已安裝的libsndfile解碼為16kHz mono PCM16 fixture；一份60秒、在安靜處切分，另一份46秒、語音跨過預定切片邊界。兩份都經正式chunker／ASR gateway／utterance queue成功，均為3片、每片低於1MiB；保留先兩份、更正三份、加便當與不要結帳的順序，完整後才交付一次。私有錄音與log保留在`/tmp/webnavior-oct27-*`；未使用顧客錄音，未呼叫Main或POS。這驗證合成案例，不證明現場收音、所有語音邊界或模型點餐語意。可透過Server README記錄的`KIOSK_AUDIO_REPLAY`入口重跑。
- **逾時／結果遺失故障注入**：Chrome新增顯示promise永不完成的案例，兩次恢復仍封鎖且只發出一次動作；另驗證顯示明確拒絕但回執遺失後可恢復，cart仍為0。既有慢操作settled後恢復、不同document拒絕、相同operation ID去重及付款pending／uncertain限制一併通過。POS simulator既有「已接受但回應遺失」測試確認以同一payment找回原訂單，submit只呼叫一次。

最終本次驗證：Kiosk Node249通過／48既有選用跳過；CheckoutActions／CheckoutFocus／FieldState Chrome13通過；interactive-service Chrome18通過；POS response-loss與checkout-domain Node16通過。Kiosk scoped typecheck、修改檔ESLint、diff whitespace與Kiosk build通過；未執行root全專案typecheck。紀錄為`/tmp/webnavior-oct27-{kiosk-tests-final,checkout-final,recovery-final,payment-tests,kiosk-types-final,lint-final,kiosk-build}.log`，合成ASR為`audio-quiet.log`與`audio-replay.log`。

仍未證實原始現場首筆62秒掛起的確切原因；永不完成顯示是可控故障注入，並非還原當時瀏覽器。實體麥克風、店內完整點餐與付款／POS設備驗收仍待進行；先前混合需求的模型語意問題仍未宣稱解決。

## 2026-10-27 現場測試版部署

使用者授權先上板再到實際環境嘗試。配套建置與發布Menu、Kiosk及API，API於11:33:56經`systemctl --no-ask-password restart webnavior-api`完成重啟，PID1530427；啟動紀錄顯示Applied schema／Server started，沒有新的schema檔案或手動db:push。sudo非互動模式需要密碼；其後systemctl本身完成重啟，沒有送出launcher終止訊號。

- 發布前保存舊Menu／Kiosk、PostgreSQL custom dump並經pg_restore --list驗證、變更前後程式來源與patch、來源SHA256、建置／測試log。目錄為`/tmp/webnavior-reliability-release-20261027-e363hd7n`，release.json狀態為deployed-verified。基準HEAD為eac50945；這次以未提交快照識別實際程式，沒有建立commit。
- Menu使用`/menu/`、Kiosk使用`/kiosk/`與既有正式環境網址建置；server-schema及Server build亦通過。API ready後才發布前端，先複製資源再替換兩個index，保留舊雜湊檔供已開頁面載入。
- 本機Nginx與公開HTTPS Chrome均確認48個HTML／直接連結資源SHA256吻合。新Menu入口為`index-CtKt2yT4.js`，Kiosk為`index-DUYoK-kc.js`。公開Bridge health及7項catalog正常；API livez／readyz、DB／Redis正常。已部署API的無身分超限音訊探測回413／KIOSK_AUDIO_TOO_LARGE，未進入provider。
- 獨立未登入Chrome可開啟Kiosk並顯示「建立測試設備」；未建立設備、訪客、訂單或付款。管理前端、Nginx、Bridge程序、動態模型設定與既有資料均沿用原狀。

現場應先結束未完成交易，再重新載入已註冊的Kiosk頁面，從新的測試會話驗收短句、長語音更正、用餐方式、結帳與實體付款結果。這次上板完成不代表上述設備與模型語意已驗收。

## 2026-10-27 分批提交

使用者在上板後要求分批commit，取代實作階段不提交的限制。依功能分為：

| 批次 | 提交 | 白話說明 |
| --- | --- | --- |
| 菜單控制項 | 364f162 | 空購物車也能選內用／自取；菜單查詢不再卡在等待動畫影格 |
| 連線與回覆 | 5989a5e | 失聯先暫停，恢復不重送訂單；說明依現有資料產生，避免誤報成功 |
| 長音訊 | 4d03c4a | 小片上傳、完整辨識後才處理；保留更正語句，避免總時間超時誤取消 |
| 瀏覽器測試 | baf9f83 | 修正依賴定位，說明正確的套件執行入口，避免測試啟動卡住 |
| 盤查與部署文件 | 本文件所屬提交 | 保存調查證據、驗證結果、部署位置與尚待現場驗收項目 |

提交前依CONTRIBUTING規範跑一次全專案typecheck，通過；root lint仍有與既有紀錄相同的2370項錯誤，未擴大修復無關檔案。修改檔檢查與每批既有nano-staged提交鉤子通過。驗證log為`/tmp/webnavior-oct27-commit-{typecheck,lint}.log`。已提交的程式與部署來源快照逐檔比對一致，這次提交沒有額外變更線上行為。


## 10/28 兩台機台再次失敗：回覆契約未閉合

本節為使用者新增 trace 的唯讀續查，不代表前述修正已涵蓋本案。附件 SHA-256：`ac3fcb5a86572589141784d46449a869a5bdf9a5474f783afee83ea865c846f5`。本輪沒有修改產品程式、模型設定、部署或重啟服務，也沒有將原始顧客對話重送模型。

後續使用者已要求開始規劃；整體修正、測試矩陣及發布門檻以[10/28對話修正計畫](../plans/2026-10-28-kiosk-conversation-repair.md)為準，目前仍未實作／部署。這份盤查保留證據與限制，不另複製一套修正規格。

### 範圍及可排除項

10/28 09:39:21–09:45:24 Taipei，取得兩個 device、三個 session 的365筆互動。兩個實際對話會話分別為 session `6pNT8…` 與 `lwYtT…`，第三個只有初始事件。私有快照 `/tmp/webnavior-20261028-interactions-private.json`，SHA-256 `3789d05617379dd04dd7bf28338302ebaa53569752b935c89dffabce4f6de565`；今日 journal `/tmp/webnavior-20261028-api-private.log`，均0600，不提交原始資料。

- API PID2028803、10/27 19:08:17啟動，active；readyz 的DB／Redis均ok。
- 三個 session 的 agent mode 均active、noProgressCount均0，沒有進入touch_preferred。因此「幾句後叫自己操作」在本案主要是錯誤出口文案，不是累積三次就撤銷語音服務。
- 13個 Main task metrics，sum(modelRounds)=19，interrupted全false；7個 presentation presented、6個rejected，拒絕原因全是unverified-reply，六個task皆零工具。這是此段有限紀錄，不能當全站成功率。17個round metrics與19個task自報輪數也不能混算為完整provider追蹤。
- browser_tool_metrics有113個called、113個resolved。本段沒有發現先前44次modelRounds:0的工具失聯鏈；配對總數不代表每個操作效果正確。
- 部署 Menu／Kiosk HTML hash 與本機dist一致；這只能核對伺服器靜態版本，沒有取得兩台瀏覽器實際載入的bundle ID，不能據此完全排除舊分頁。

### 六次畫面拒絕與正常文字的格式斷點

| Session／sequence | Main草稿／現象 | 呈現結果 |
| --- | --- | --- |
| lwYtT…31→37 | 已略過後再次「略過」；Main回答開始點餐並問餐點種類 | unverified-reply |
| lwYtT…68→76 | Main問內用還是自取，沒有操作回執或應用程式問題 | unverified-reply |
| lwYtT…86→93 | 「這邊聽得到」並列舉分類 | unverified-reply |
| lwYtT…135→142 | Main列出菜單並說可協助點餐，沒有本輪工具 | unverified-reply |
| 6pNT8…152→162 | 「可以，目前可接收LINE Pay和街口支付」 | unverified-reply |
| 6pNT8…174→185 | 附件原句；Main稱LINE Pay、街口支付且「支持刷卡」 | unverified-reply；不能把這段整句直接放行當事實 |

`currentContextInstructions`要求非操作資訊／澄清輸出四種JSON selector；`createSystemInstructions`的「獨立對話與工具使用」又允許一般對話、非操作釐清直接自然語言回答。Main今天實際生成普通文字，沒有格式強制或有界修復步驟。

Host `KioskScene.vue`只有在零工具／僅history且answer以`{`開頭時，才讀fresh context並進`replyFromContext`。`questionPresentation.ts`對沒有回執、沒有serviceReply資格、又未成功解析selector的文字回error；本輪`UNCERTAIN_OPERATION`不自動取得serviceReply資格。最後`stage.kiosk-agent.no-reply`顯示「這次沒能完成回覆，請再試一次，或使用螢幕操作。」所以「模型有回覆」仍能呈現成請顧客自己操作。

這是producer／consumer契約與恢復流程未閉合，不代表每一段草稿都應該通過。操作假成功、錯誤付款品牌／刷卡宣告仍須攔下；也不能把所有UNCERTAIN_OPERATION改成serviceReply繞過驗證。

### 語意及對話恢復另有缺口

附件原句「是 是 帶刀刀」：Jev route選scroll-menu:up，confidence0.5777；destination選OTHER、0.2081；serviceRequest選REQUEST但僅0.3556。Application沒有直接捲動，而是發起recovery；Main裁決admission=service、disposition=assistant，最終NEEDS_ASSISTANT／UNCERTAIN_OPERATION。這證明原本不確定的聲音能再次被提升為服務需求，不證明知道顧客到底要什麼。必須把服務相關、意思清楚及操作授權分開。

另有可追溯的答非所問：

- 「水果」呼叫menu_recommend action:clarify（seq92），工具固定回「你想調整價位，還是換餐點種類？」；「這邊可以刷刀嗎」再次呼叫同工具（seq125），同一句回覆再次呈現。工具回執真實，不代表所選工具符合本句。
- 「所以就看收音好不好」後Main的fulfillment-modes selector被呈現為「目前提供內用、自取」（lwYtT…59）。結構／事實有效不能取代語意相關性。
- 推薦出現在「光明 需要的」「我越過手機登記，現在…」之後；這些文字與先前歡迎／略過手機回覆部分相似，值得核對原音及TTS重疊。但沒有聽原始錄音或取得聲源時間線，不把ASR誤辨、TTS回授、說話人或原意寫成已證實原因。

### 修正順序與驗收缺口

1. 統一Main回覆契約；將說明／澄清、事實選擇、操作結果分開，使用可驗證的結構化出口，不只靠prompt要求JSON。格式失配應有一次有界修復或安全的語音釐清，不能直接變通用手動操作錯誤；寫入或結果不明仍不可自動重送。
2. 保留意思不確定的狀態；服務admission不能默認完整需求已解析。補救後若仍無法確定，只釐清本句，不猜付款、捲動或推薦。新主題應撤銷不相關舊查詢問題，零結果／工具固定問句不能冒充對本句的理解。
3. 驗語意相關性，不只驗selector schema及工具是否成功。付款／訂單事實仍以新context／回執渲染；不放行未證實的「支持刷卡」。
4. 將本次連續對話加入來源明確的回歸，另用合成語音比較「同一文字→實際Jev→補救→Main→可見回覆」，以及TTS播放中收音／回授。先前兩個configured explanation只測清楚人工問句及指定readOnly前態，沒有涵蓋這種含雜訊、題目切換、回覆格式偏離的連續鏈。

本輪針對既有reply／historicalReplies測試重跑49項通過；它驗證當前保護及手寫JSON控制，不能反證六次現場拒絕不存在。紀錄 `/tmp/webnavior-20261028-reply-diagnosis-tests.log`。沒有全專案typecheck、真實模型重播或聲學驗收；這是診斷結果與下一修復單位，沒有宣稱修好。


### 10/28 補充：按「再試一次」後誤查水果

使用者補充重試後顯示「目前沒有符合條件的餐點」。同一原始快照已能對上完整序列（6pNT8…）：seq170 user_text為「是 是 帶刀刀」；seq174 Main草稿為付款／刷卡說明；seq185呈現拒絕。seq187再次保存相同user_text，seq191卻呼叫`menu_recommend({action:"update",query:"水果"})`；seq193的真實結果queries=[水果]、availability=NONE、customerMessage為「目前沒有符合條件的餐點」，seq207呈現通過、seq208顯示該文字。這不是對目前整份菜單或本句的可靠結論，而是對更早「水果」主題的查詢結果；13輪樣本中的這次「presented」也不代表服務語意成功。

程式可確認的重試缺口：`retryableConversationRequest`只保存string。`retryConversationMessage`的Main失敗分支直接呼叫`sendConversationMessage(text, undefined, {appendUserMessage:false})`，沒有傳入原decisionState／utteranceId／decisionEntryId，也不經原先ASR→Jev／recovery路徑；它是一個帶舊歷史的新Main任務。`sendConversationMessage`之後會補讀目前browser snapshot，所以不能說完全沒有新情境；真正缺失的是原句服務資格、不確定原因、交接效果與重試關聯。模型仍見舊水果歷史，選錯查詢後回覆層只驗收據，不驗這個查詢是否完成當前原句，於是錯誤「有回執地通過」。trace不足以還原模型內部為何選水果，但選取舊主題的實際工具呼叫已證實。

修復不可只重送舊decisionState或舊確認票據：重試需保留原request／原句與明確的不確定狀態，對新browser revisions／session／document重新驗證；未確認寫入仍不重送。對語意未明的原句先沿原理解／釐清路徑恢復，禁止用舊查詢結果冒充本次完成。應新增「水果→新問題→回覆被拒→按重試」的跨流程回歸，驗真正重試按鈕而非手動再次送清楚文字。本節仍為調查，未修改產品重試邏輯。


### 2026-10-28 後續實作狀態

本次原因已進入本機實作：typed非操作回覆、服務意思覆核、原句retry與新狀態驗證，並新增新裝置預設政策。尚未commit或部署。驗證結果、真實模型失敗與尚未完成範圍集中記於 [修復計畫](../plans/2026-10-28-kiosk-conversation-repair.md#2026-10-28-實作與驗證狀態)，避免把本稽核的舊程式觀測誤當新版結果。實際啟用的外部Jev目前500 CUDA故障，完整模型驗收仍未通過；本機另一個openjev服務的重啟不等於恢復該端點，也不能反推早上原始報告原因。

## 2026-10-29：取消便當誤設自取、Main回覆被拒

本節為新的唯讀調查，前節CUDA狀態是當時觀測，不是本日仍故障的結論。附件SHA-256 `3395857cb38e8a57a14a80f35d72cf2e3f09da312fc2f974e27e241683ee2a44`；本機同一會話116筆entry與journal可對上附件recoveryId、utteranceId=7及原句。不送原始對話進任何模型，不修改程式／模型設定、不重啟／部署。私有證據為`/tmp/webnavior-20261029-session-private.json`、`/tmp/webnavior-20261029-main-diagnosis-private.log`。

### 語意首層負擔與開源對照

附件首題route有21個候選，state1497字元、instructions3618字元、criteria序列化JSON1943字元；合計約7058字元，不是token數，也不含HTTP／模型模板。首題把服務資格、語句完整度、複合需求、操作意圖、畫面導航及助手交接混成一個選擇。description亦混入執行效果、禁止事項、後續問題和例外優先序。這是工程設計上偏重且難以互斥的契約；尚未做受控消融，不能宣布字數或候選數是已證實唯一原因。

檢視的開源原始範例：

- [lookski/openjev demo.py](https://github.com/lookski/openjev/blob/main/demo.py)：一題只問處理部門，billing／technical／sales三項各短詞描述；另以不同問題詢問情緒、緊急度。不是把部門、情緒與緊急度放在同一候選表。
- [JustVugg/colibri System One文件](https://github.com/JustVugg/colibri/blob/main/docs/systemone.md)：同樣將department、urgency、severity分開；choice一行描述一項，範例department為三類。這是另一個實作的設計參考，不代表目前外部OpenJev具備同樣cache或品質。
- [can-you-fool-jev](https://github.com/huseyinbabal/can-you-fool-jev)：1000題公開挑戰的轉換範例使用短問題與短label，有些criteria描述為空；作者明列標註爭議及措辭敏感性。這是公開題庫，不能與本專案先前已跑的題數混同，也不據此建議中文業務候選一律刪空描述。

建議首層改為少量、同層級的服務分流，例如SERVICE（向本機的訂購／查詢／更正／取消／投訴及店家資訊）、GREET（只有招呼）、BACKGROUND（對他人或無關）、UNCERTAIN（對象／需求不明）。只輸入本句、必要角色前文與當前問題；招呼帶需求選SERVICE。「不是要自取」是服務更正，不因沒有點新菜就忽略。語句完整度與實際操作在後續階段處理；不確定應能語音澄清，不能直接映成重試／自行操作。保留低信心與操作防護；不是簡單縮短所有description就啟用。

第二層再處理資訊／單一操作／複合或爭議需求，只有必要分支才展開操作候選。取消加更正、多品項或替換應保留整句交接；Main仍需核對當前需求與工具效果，因本案已證明單純轉Main不足以避免錯誤。此為建議架構，尚未實作／驗證，不推定SLM一定因而改善。

### 不是Main停機：有回覆但未完成需求

API systemd為active/running；127.0.0.1:5168/livez與readyz正常，DB／Redis ok。這只證明服務基礎狀態；Main可用性的直接證據是本次模型回合與工具收據。

前一輪utterance6「我不要便當了」：

1. seq73為本句，seq78模型回合約1045ms；seq79唯一操作呼叫是`order_set_fulfillment({mode:"takeout"})`，不是移除便當。
2. seq82回執確認真的設為自取；cart仍有招牌便當與水餃各一份，itemCount=2。這是執行了不符原句的操作，不是只有畫面／文字不同步。
3. seq86 Main草稿卻聲稱便當已移除、僅有水餃，沒有相應移除工具；seq87共2輪模型、1個requested tool。
4. seq94呈現通過，seq95依真實回執只顯示「已設為自取。要進入結帳流程嗎？」。回執層避免呈現不存在的移除成功，但未阻止模型選了無授權語意的用餐方式操作，也未確認取消需求完成。

附件utterance7「我不要便當了，哪有說我要自取」：

1. Jev route選defer-question confidence0.5031；relation選NEW_REQUEST 0.3014；serviceRequest選REQUEST 0.323。三題均answered，約576／224／290ms，沒有timeout或CUDA錯誤；不是只看最高機率就代表可靠。
2. recovery與seq100一致：adjudication約398ms，service／assistant，最終NEEDS_ASSISTANT，reason UNCERTAIN_OPERATION。
3. seq106 Main模型回合約562ms、firstOutput474ms；seq107自然文字問內用／自取，沒有處理取消便當；seq111為1輪、requestedToolCount=0、未中斷、任務約778ms。
4. seq116 `main_presentation_metrics`為rejected／`unverified-reply`。因此「再試一次」對應未通過呈現驗證的Main答案，不是模型當掉。當前Host仍會在沒有可信操作回執或有效結構化回覆時拒絕呈現，不能用無條件放行自然文字繞過。

需要同時處理三個責任：首層分流不要過早選具體操作；Main不能把取消便當做成自取、也不能假稱移除；合法的澄清要有可呈現契約及有界恢復。使用者未指定新的用餐方式，不能自動反向改成內用。此調查沒有執行新模型探測、測試或修復，也沒有聲稱只改首層即可修好Main。

### 10/29 設計依據與因果界線補充

SERVICE／GREET／BACKGROUND／UNCERTAIN四類只是服務分流提案，沒有實作或修改後成績。分類依據是呼叫方下一步要做什麼，而非列出全部可操作業務意圖：SERVICE進需求理解、GREET用固定招呼、BACKGROUND不打擾、UNCERTAIN保留不確定性。只有招呼才選GREET，招呼加取消／查詢仍是SERVICE；已知向本機提出取消／抱怨，不因無法解析操作target就改成BACKGROUND或丟失原句。

四類不是完整語音狀態機。「我要一份……」需保留語句完整度／等待機制，不能一律把不確定變成追問或要求自行操作。分流、完整度、操作選擇的責任要一起設計；不為了把第一題限制四個label而把複雜條件重新塞進四段長description。首層只需原句、必要角色前文與當前問題；具體購物車目標、操作參數、完整菜單與寫入授權在後續擁有模組處理。

設計規則：description簡述同層級的正向定義，題目指令交代少量優先序，執行副作用／版本驗證／工具合法性由Application持有；不把執行細節、負面例外與歷史修補規則重複塞入所有候選。開源例子支持這種責任拆分的可讀性，不證明本場域改成四類就能提高正確率。必須保留歷史取消／查詢／未說完／裸肯定／背景對話／語音重試案例驗證；未量測前只能陳述預期行為，不能宣稱修改已成功。

Main事故可確認的分類是「選錯工具造成實際誤操作」加「沒有移除卻宣告移除的狀態幻覺」。後者屬不實完成宣告；前者可能包含語意理解、前文牽引、交接契約或工具授權範圍問題，不能用一句模型幻覺取代根因調查。紀錄保存正確user_text，現有Server組裝亦會把input.content加入user訊息；但沒有捕獲該次完整上游Main request，不能完全排除當時組裝／版本／歷史影響。沒有timeout證據，也沒有服務停機證據。

現有`webmcp.ts`的invokeForAgent會檢查allowedToolNames與revision，且當handoff.intent可對應intentTools時限制操作／lineIds；未解析成明確handoff的開放任務，不等於具備同樣的效果限制。工具合法、phase正確與回執真實，只證明「可以執行且執行了」，不證明「顧客要求這個操作」。因此需在寫入前保留原需求效果邊界、禁止未表達的用餐方式變更，在寫入後分別核對完成項與未完成項；無法確定target時語音澄清，不猜取消對象，也不猜內用／自取。不能靠放寬回覆驗證來修復。

### 10/29 其他實作、模型輸入與thinking補查

不僅參考lookski；補查下列原始專案，均未安裝或執行：

| 專案／原始範例 | 觀察與適用界線 |
| --- | --- |
| [Strands Decider工具介入](https://github.com/strands-labs/strands-decider/blob/main/examples/strands/tool_call_intervention.py) | before_tool_call分別問參數是否出自使用者、是否應先釐清；程式選Proceed／Guide。與本案缺少的寫入前語意界線相關；原作者明示示範問題／門檻不可直接當正式政策 |
| [Together tev1 decide.py](https://github.com/togethercomputer/tev1/blob/main/examples/decide.py) | state／question／options分離，選項有key及description；溫度0、有限字母輸出、thinking=false、驗合法label。程式接受2–24項，不能把範例當成「只能少量候選」的證據；專用決策模型與通用Qwen亦不等價 |
| [Colibri System One](https://github.com/JustVugg/colibri/blob/main/docs/systemone.md) | 部門、緊急度與嚴重度分題，單題描述短而聚焦；另一推論實作，不推定其快取行為適用於現場OpenJev |
| [kataras/jev用法](https://github.com/kataras/jev#usage) | 單一closed question與具體criteria，確認API組裝；它是client，不能當另一模型的品質證據 |
| [can-you-fool-jev轉換規則](https://github.com/huseyinbabal/can-you-fool-jev#how-a-row-becomes-a-request) | 1000題公開人工挑戰，短問題／label，標註爭議及措辭影響明列；未在此機器跑完，不與本專案題數混算 |

Strands示範可參考插入點與可語音恢復的介入方式，不直接移植0.45門檻，也不新增一個未驗證模型作唯一寫入授權者。本專案過去effect review已有誤接受紀錄；需要先保住程式擁有的效果、target、版本與實際回執契約。

模型的「認為／記得」無法由輸出直接證實。確定的是同一輪系統工具回執仍有便當，而Main生成與之矛盾的移除完成草稿；可能把待辦或想完成的效果敘述成已完成，但這只是解釋假說。另查到`compactToolResultForModel`在已有完整catalog context時會移除工具回執的cart／selection，依賴每輪刷新後的current context提供真實狀態。因此「原始回執有cart」不等於「那份完整cart逐字送入模型」。seq83／84確有刷新context的呼叫，但缺少當次實際上游body，仍需捕獲模型最終投影才能確認是否正確供應最新cart。不可未經驗證就說是模型忽略已看見的完整快照，也不可反向宣布壓縮就是根因。

唯讀核對Redis有效runtime／router：Main alias `webnavior/chat`，upstream model `qwen36`、enableThinking=false、timeoutMs=60000。router依upstream設定覆寫每輪chat_template_kwargs.enable_thinking，包括工具延續；目前不是可由單次caller直接翻轉的開關。這是設定與程式路徑證據，不是當次上游已遵守開關或實際權重身份的完整證明。此次未改正式設定或呼叫模型。

下階段建議先做寫入前／回覆前界線與必要的最終模型輸入可觀測性，再縮分流契約。thinking不作防護替代品：現場暫不全域開啟，另在隔離相同Main路徑以6條歷史合成情境各跑off／on一次（12條鏈、全輪8分鐘上限、無限時延長或調prompt重跑），保持候選／工具／初態與規則一致，記正確工具、遺漏需求、錯誤副作用、完成宣告與延遲，確認後端確實遵守模式。此為未執行建議，不是已取得thinking收益；若確有改善再設獨立profile／路由試用複合更正任務。有限決策SLM維持非思考單一結果契約。


## 2026-10-30 最新對話：Main 加點／數量修改斷點

本節為隔離診斷，未修改產品程式、正式設定、模型或部署。基準為最後提交
`e8491ec`，worktree：`/home/aimax/.codex/worktrees/kiosk-main-recovery/webnavior`。
原工作區另有其他聊天正在實作的 V1 政策，不混入本次診斷。

### 正式環境與證據範圍

- Nginx 5169 原站實際供應的 Menu／Kiosk HTML 與 `/var/www/airi` 一致；
  Menu 4 個、Kiosk 579 個部署快照檔案均與 10/29 發布版本相同。
- API 仍是 PID503794，10/29 17:57:33 Taipei 啟動；啟動命令為 tsx，沒有 watch。
- 本次涉及的 Menu webmcp、Server kiosk route、conversationContext、Host recording
  與 questionPresentation，隔離 HEAD 的 SHA-256 均符合 10/29 release manifest。
- 唯讀取得最新 Session 的230筆 entry，時間10/30 13:30:54–13:38:54 Taipei。
  原文與該 Session 綁定的 Profile 只保留 `/tmp/webnavior-20261030-session-private.json`
  與 `/tmp/webnavior-20261030-session-profile-private.json`，權限0600，不提交原始資料。
- Profile 的 agentInstructions 為空；角色卡沒有 `cart_update_item` 或禁止改餐指令。
  沒有發現 touch_preferred／decision_guidance 事件。

### 現場三段失敗與成功對照

| Entry sequence | 現象 | 已確認的斷點 |
| --- | --- | --- |
| 111–138 | 「那我要三份」只得到「水餃目前可以點」。Main 依序查 menu_get、cart_get，空 Cart，沒有新增 | 查詢回執可結束沒有明確 operation handoff 的 Main 回合；呈現完成不代表購買需求完成 |
| 146–154 | 再明講「三份水餃」 | Fast Path order_add_item 成功，Cart 水餃3份 |
| 160–175 | 「改成兩份」；Main 草稿宣稱已改2份 | requestedToolCount=0；一次 reply repair 後呈現泛用 clarification，並未修改 |
| 185–194 | 「調整」後系統問是否由3改2；後續 recovery 兩次 invalid | 沒有形成有效的修改執行；未保存完整後續輸入，不補造其內容 |
| 200–227 | 「水餃三份改成兩份」 | Main 先查菜單與仍為3份的 Cart，之後提出不存在的 cart_update_item，僅 lineId、沒有 quantity；Host 在呼叫工具前終止為 tool-rejected，沒有對應執行回執 |

部署版正確修改工具為 `cart_set_line_quantity`，必填 `lineId`、`quantity`。
錯名不能自動映射，更不能由程式猜 quantity 後代替顧客下單。

### 離線重現

新增4項 baseline 行為重現／控制測試，沿用真實 Menu runtime、真實 Host loop
和既有 API mock 邊界；另新增1項真實 Server route＋記憶體 PGlite 測試。
這些測試是對已知錯誤輸出的處理驗證，不是模型語意準確率或修復驗收。

1. 加點只完成 menu_get／cart_get，Host 顯示水餃可點，但權威 Cart 仍空。
2. Main 零工具的成功草稿進 selectReply，只剩 respond_to_customer，
   修復無法呼叫修改工具；最後為泛用 clarification，Cart仍3份。
3. 錯誤工具名稱進 Host，修改執行次數0、模型只呼叫1次、Cart仍3份。
4. 相同情境改用合法 cart_set_line_quantity，真實 runtime 確實改為2份。
5. 重建 HTTP 請求中，正確修改工具及必填參數有送給 Main；不存在的工具不在
   schema，但 Server 將其提案原樣傳回 Host，沒有在這個邊界提供恢復。

檢查結果：Kiosk兩個測試檔34項通過；Server新route測試1項通過、64項未選跑。
未執行根目錄typecheck、真實模型重播、POS、付款或正式訂單操作。

### 已定位範圍與修復邊界

- `finishConversationReply`／`selectReply`：沒有操作的輸出只進非操作回覆修復。
  這能防止假成功，但不能恢復尚未完成的操作。
- `useKioskInteractionRecording.send`：工具不在當輪清單時直接結束，沒有將
  「此提案未執行」回傳模型供有限次修正。真實執行被拒／結果不明應維持分開處理。
- `replyFromConversation`：只在已知 handoff intent 時核對相應操作回執；
  未分類的加點需求若只拿到讀取結果，仍可能被呈現成已完成回合。
- 最小修復應先覆蓋「執行前錯名」的有限次重新提案，再處理原需求未完成卻只
  回資訊／澄清的任務完成判定。不得擴大readOnly、付款、確認或版本授權，
  也不得自動重送可能已生效的寫入。

尚未證實：當時每輪完整provider request／工具清單、錯名生成的模型內因、
完整權重身份及與早期版本的因果差異。當時只有request大小／token等metrics，
重建請求不能冒充原始wire。因此不能把錯名歸因為JEV、角色卡、模型版本切換，
也不能宣稱所有現場修改失敗都由同一原因造成。本輪尚未實作產品修復。


## 2026-10-30 隔離修復：工具提案恢復與原需求完成檢查

本節接續上節診斷，仍在 e8491ec 的隔離 worktree；沒有混入原工作區另一聊天的
V1 禁止修改政策，沒有 commit、正式部署或正式訂單操作。

- Host 對整批工具名稱先預檢；只要有未知名稱，整批均不執行。每筆call ID均取得
  `UNKNOWN_TOOL` 或 `BATCH_NOT_EXECUTED`、executed:false，再更新目前facts／tools，
  讓Main重提一次。第二次未知提案即停止。既有執行拒絕、結果不明、逾時、手動接管、
  duplicate ID、四批／十六工具及共同60秒預算不變。
- Server 在 ordering／非唯讀／尚無操作嘗試、且有當輪操作工具的任務結束前，
  最多做一次 completion review。沿用原始需求、相關對話、最新facts與完全相同工具；
  不把假成功草稿當證據。Session＋taskId的 `main_completion_review` 事件在呼叫前保留
  次數，後續讀取延續不能重新開始。明確有效的clarification不增加review；付款、
  checkout、customer_entry及readOnly不擴權。已嘗試寫入不走這條恢復。
- review回傳的工具仍經原Host／Menu授權；其後格式不合規只澄清，不再額外呼叫
  非操作修復。讀取後的有效clarification不會被舊菜單可點文案取代。
- Menu BEGIN 原本只保留字面商品IDs，漏接「那我要三份」。現在僅沿用既有
  resolveIntent 能唯一解析、來源為任務前presentation、且含份數的target；固定在
  BEGIN，不允許後來查詢授權新商品。沒有展示、多品項、單純附和及另查替代商品
  仍拒絕。未增加語言分類器、猜測工具名稱或生成份數。

驗證包含真實HTTP JSON／SSE＋scratch PGlite＋真實Menu，固定模型輸出先重現失敗、
修復後驗實際Cart：省略品名新增3份、3改2成功。另驗第二次錯名停止、混合批次不部分
執行、執行拒絕不重送、只review一次、查詢後未操作須澄清及指涉隔離。這些離線結果
不等同目前真實Main模型的語意驗收。

最終離線驗證：Kiosk96項、Menu65項、Server69項，共230項通過；真實模型2項預設跳過。
Changed-file ESLint與git diff --check通過。Server／Menu／Kiosk package-scoped
typecheck通過；Menu與Kiosk build通過。
新checkout缺少的既有dist產物透過對應套件build補齊，沒有修改tsconfig、exports、
版本或依賴。未跑root typecheck。既有大型chunk／預覽資產等build警告未擴大修復。

兩項 opt-in 合成 Main＋真正Host迴圈測試位於
`apps/stage-kiosk/src/services/mainQuantityReplay.test.ts`，正常離線測試仍預設跳過。
首次執行被自動審核拒絕後，使用者明確授權「好，可以送去」，才重新執行同一命令；
沒有透過其他路徑繞過審核。2026-10-30 17:11:10 Taipei 開始的兩案均通過，
測試總時間5.68秒（含測試環境初始化），原始log保存於
`/tmp/webnavior-main-quantity-live.log`，權限0600。

沿用已配置 qwen36／thinking=false／60秒timeout，直接呼叫既有provider endpoint
`https://syqvzpveyn.aikcitri.qzz.io/v1`。合成句「那就幫我點三份」確實新增水餃3份；
「這份數量改成兩份」確實由3改2。兩案的真正Host loop均正常結束，回覆由成功的
ADD_ITEM／SET_QUANTITY回執支持，未呈現泛用不理解訊息。

這是當次配置下兩案的實際模型＋工具流程驗證，不是全餐單、多輪穩定率、現場語音、
付款或POS驗收。API／DB／Menu均為scratch，使用開發persona而非原始顧客完整Session；
未將現場對話重新送入模型、未修改provider參數或正式設定。沒有提交或部署；
可進入這次修復的發布審查，但不得把原工作區未提交V1政策一起發布。


### 2026-10-30 發布準備：待管理員切換

使用者授權進行部署後，已準備獨立發布快照：
`/home/aimax/.local/share/webnavior/releases/main-recovery-20261030-191156`。
完整性預檢6251個檔案通過。runtime內沒有連回原checkout／worktree應用原始碼的
symlink，只重用已安裝的第三方pnpm store與工具shim。新API與Oct29 rollback API
均通過單純module import檢查，未在準備階段啟動服務或連接正式DB。

Menu以正式 `--base=/menu/` 重建；Kiosk本身固定 `/kiosk/`。新舊前端、原systemd
unit／drop-in及乾淨的Oct29 API回復來源均已保存。既有API release manifest的
15個生產來源中，13個維持相同、2個是本次刻意修改的route／conversationContext。
管理Web、模型設定與DB schema不在發布範圍。

正式API仍從開發checkout執行，因此不能直接重啟該路徑。切換腳本只新增
`/etc/systemd/system/webnavior-api.service.d/90-main-recovery.conf` 的WorkingDirectory，
保留既有ExecStart、User與EnvironmentFile，指向獨立runtime。發布先上傳資產、API
健康後才原子替換HTML；保留舊hash資產給現有分頁。失敗自動切換baseline-api並回復
原Menu／Kiosk；不回到已含V1編輯的開發目錄。

目前狀態仍為 `prepared-awaiting-admin-switch`。`sudo -n -l` 回覆需要密碼，尚未執行
管理員切換。正式原站47個HTML／直接資產檢查與備份一致；現行API livez／readyz、
DB／Redis均正常。待使用者在本機終端執行：

```sh
sudo python3 /home/aimax/.local/share/webnavior/releases/main-recovery-20261030-191156/switch-release.py
```

腳本與DEPLOY.md都在該release目錄，支援唯讀 `--check` 與管理員 `--rollback`。
切換成功後仍需核對公開網域、更新release.json／本文件，才能宣稱正式發布完成。


### 2026-10-30 發布後註冊失敗與修正

使用者於19:24完成管理員切換，API從獨立 release runtime 啟動。
初次前端建置漏帶原工作區 Git 忽略的 `.env.production.local`：Kiosk
註冊 chunk 內含 `http://localhost:5168`，Menu也缺正式POS與embedding來源。
靜態資源雜湊與API健康檢查不足以驗證這些編譯時設定；這是本次發布造成的回歸。

重現先前發布 chunk 的 localhost 目標後，以原有 Kiosk 正式建置設定及
Menu 正式 API/origin/public URL 重建，保留 `/kiosk/`、`/menu/` 基底。
19:32前端修正上線，不重啟API；47項來源HTML/直接資源檢查通過。
正式公開瀏覽器載入新入口 `index-Jt3csSMg.js`，bootstrap 已抵達正式API，
未註冊瀏覽器回401符合預期；註冊路由以空資料回400，未建立設備。
尚未宣稱實際設備註冊完成，待使用者重新整理後重試。

release 的 `frontend-origin-hotfix/` 保存修正前後檔案及manifest，
`switch-release.py` 已新增編譯後註冊API、Menu scenario及POS目標檢查。
新建置preflight通過；原有230離線/2個模型測試無需因純建置設定重跑。
沒有修改模型、資料庫、另一工作區V1規則或提交commit。


### 2026-10-30 連續服務釐清循環：修復待部署

現場Session `HmfwjMy74UzFO2jp7zhCj` 的16至21號輸入依序為
「好、好、好、對、飯、吃飯」；六輪均產生 `source:service_clarification` 的
「請問您想點什麼餐點？」及新questionId，尚未交給Main任務。
這是服務review重建問題的循環，與前一Session的review `invalid` 是兩個症狀。
該invalid沒有保存原始provider回應，不能由本次截圖推定具體不符欄位。

先新增四個失敗重現測試，再修正serviceRecovery：已有serviceClarification、
當輪review仍確認service但選clarify時，交給readOnly Main並保留上下文；
初次釐清、背景、uncertain及invalid行為保留。不加入關鍵字放行，不把肯定詞
直接作為購買授權，不增加模型呼叫。決策模組456通過/80跳過、Server型別與
兩檔lint通過。這證明交接契約；尚無完整真實模型對話驗證。

正式API未更新。現有release的 `clarification-loop-fix/apply.py --check`
通過；備妥單檔修復、備份與自動回復。套用與重啟需要本機sudo驗證。
沒有commit或正式訂單操作。


### 2026-10-30 正式版續作：預算／其他的逐輪診斷與價格交接修復

另一聊天的SLM/Jev實驗已移至獨立worktree，本輪只修改kiosk-main-recovery。
正式API仍使用既有release；下列修復尚未部署，未執行外部模型或正式訂單操作。

唯讀Session `eCda22nNnyhWzB5rMVvsM`：

| sequence | 實際輸入／工具／結果 | 已確認偏差／限制 |
|---|---|---|
| 584–606 | 我要吃麵→menu_recommend update(category:麵食)→牛肉麵 | 這是後續仍保留麵食分類的來源；保留分類本身不能直接判錯。 |
| 612–627 | 我有一百員，可以吃什麼→150元牛肉麵價格 | 原句是「員」，現有priceEvidence不產生金額證據；沒有原始Main wire，不能判定模型是否忽略了已解析的100元上限。輸出仍未回答可負擔選項。 |
| 633–654 | 我有200員→update(maxPrice:200)→牛肉麵 | Main自行提了200，Menu正確保留麵食與maxPrice200；尚無證據是filterPrices比較失效。 |
| 660–676 | 有其他的嗎→泛用澄清 | 該輪沒有新的業務工具，未提供其他結果／耗盡說明。 |
| 681–695 | service recovery review admitted/readOnly:true→有其他不超過兩百元的嗎→update(maxPrice:200)→ok:false/priceClarification | 價格解析安排在service recovery之前，當時UNAVAILABLE會跳過；recovery後沒有再解析，Host因此保留unresolvedPrice。 |
| 706–728 | 有其他的嗎→update(maxPrice:200,limit:3)→同一牛肉麵 | Main選update，沒有continue／excludeShown，Menu依既有update語意重播。不能一概改所有update為continue，因合法重新查看也使用update。 |

跨真實route、Host及Menu的三個合成重現先以普通斷言失敗，皆缺
price.maxPrice200且unresolvedPrice:true。它們重建現場可確認的服務review邊界，
不冒充當時完整provider回應。修復後移除expected-failure標記：route在recovery
完成後對尚未解析的當輪價格證據呼叫既有resolvePriceHandoff；該函數接受已完成
service recovery的交接，不改原reason、readOnly或操作目標。已有priceChoiceId不重跑，
沒有service admission不放行；無效價格回應維持guard，沿用同一signal／turn budget。

三個整合案例均確認Host保留maxPrice200、unresolvedPrice:false，接著正常BEGIN
唯讀Menu task，update讀取成功且Cart保持空。Server相關36項、Kiosk相關6項通過，
兩個opt-in真實provider測試跳過；Server／Kiosk scoped typecheck與changed lint通過。
原本100員辨識、其他推薦的Main工具選擇，以及完整對話／真實模型仍未驗收。
沒有新增關鍵字放行、修改價格篩選政策或解除唯讀／購物車驗證。


### 2026-10-31 限定真實模型驗收：目前首個偏離邊界

使用者明確允許80次／5分鐘合成對話，讀取現有Jev/Main設定並在程序內解密，
Session／Cart全在隔離PGlite，無POS／付款。正式組態只SELECT。當前Jev為
Qwen/Qwen3.5-4B，Main為qwen36。私有wire `/tmp/webnavior-budget-order-*-20261031.jsonl`
不得直接公開。五輪合計60次、26,553ms，未部署。

1. initial：SERVICE已入場、purpose低信心→UNCERTAIN_OPERATION；價格resolver因reason
   不符舊白名單跳過。Main提maxPrice100正確但unresolvedPrice使Menu拒絕。
2. admitted：補齊語意交接後，Main價格resolver選UNSUPPORTED；提示把單份探索也視為
   整單預算。按既有計畫契約修正為單金額／無多份分配的探索可選單份上限。
3. exploration／presentation：前三輪通過。第四輪只口述下一批，文字修復只提供
   respond_to_customer，模型將泛指其他餐點當subjects，畫面仍舊批。單加主提示無效。
4. readreview：既有單次完成審查擴及沒有本輪展示回執的只讀文字草稿，仍限定原讀工具。
   第四輪開始呼叫continue，卻帶maxPrice200，被既有工具拒絕。沒有放寬或忽略該驗證；
   更新review提示明確只傳action／可選limit，最新提示未真實驗收。

新路由重現先失敗（toolCalls空）再通過（保留menu_recommend）。六個預算交接案例、
既有數量恢復及相關Server路由／恢復／價格測試合計92通過；lint、Kiosk types通過。
Server types新增測試tuple widening已修正，scoped rerun通過。不跑root typecheck。
完整六輪至兩份水餃入車尚未通過；不能用前三輪或mock成功宣稱正式修復。


### 2026-10-31 追加限定驗收：真正的操作交接阻塞

使用者追加40次／3分鐘，沿用原provider、合成輸入及隔離Session／Cart。
原80次剩20，故累計上限120；目前114次、48013ms，沒有再執行外部呼叫。
新增三份私有wire為authorized-extension、price-expectation、core-cart。

- authorized-extension：同樣在continue重填maxPrice200被拒，額外提示無效。
- price-expectation：Menu將重填價格當一致性預期，只有完全相同才接受；新值、
  不同值及錯型別仍拒絕。回歸先失敗再通過，原changed-price拒絕測試保留。
  真實第四輪展示新一批炸排骨、打拋豬、牛肉麵，價位均<=200，沒有重播舊批。
  但Server已reviewed標記使接續即便已有回執仍selectReply(repair:false)→泛用clarification。
  本地修正只讀成功回執不被標記蓋掉；mutable未完成需求仍保留既有完成審查。
- core-cart：為節省剩餘23次，明示只跑原始四輪100元→其他→我要水餃→兩份，
  不冒充完整六輪。前兩輪成功。第三輪Jev可靠SERVICE與SINGLE，但family的MENU/ITEM分類低信心，回
  UNCERTAIN_OPERATION；Host將agent task綁readOnly，實際Main工具清單沒有新增。
  Main先clear price推薦別餐、再cart_get與重複menu_get，達四工具上限而incomplete。
  未問數量、未加車，第四輪沒有執行。這不是POS新增回執丟失。

後續應先設計Main獨立釐清原句操作與目標後，如何接回現有Menu合法性驗證；
不能因SERVICE或品名字面命中就放寬所有不確定回合。此項尚未實作，正式問題
仍未解決，無部署或commit。最新Server route65、Host/數量/呈現60、Menu query actions9
通過；Menu／Server／Kiosk scoped types與修改檔案lint通過。六輪真實成功驗收仍欠缺，不能宣稱可上線。


### 2026-10-31 Main ordering@1 技能實作與單輪真實證據

查詢確認正式路徑沒有獨立runtime skill；`.agents/skills`是開發代理的技能。
原Main兩段流程提示移至Server domain的版本化ordering@1，JSON／SSE及有限
需求接手共用。同時明確記錄skill版本與決策來源，不把Main選擇算成Jev confidence。

新增route／Host／Menu測試先重現NEEDS_ASSISTANT卡住；修正後Jev服務及單需求
高信心、family低信心時，Main依技能從當輪候選選ADD_ITEM，Menu補問幾份，
實際呈現問題後「兩份」加車2；「有水餃嗎」只讀、無購買問題、Cart0。未改
全域readOnly；此第一版只處理ordinary ordering的單一exact商品。既有readOnly／
service recovery、phone／checkout、歧義、多品項、未解價格仍不提升權限。
無效、額外參數、多tool calls及provider失敗不授權、不重試寫入。

Server87、Kiosk78測試通過；型別發現測試const陣列readonly與Vitest array-spread
參數形狀問題，均修正並重跑21個skill單元測試；Server／Kiosk scoped types及lint
通過。未跑root typecheck，無commit與部署。

先前授權剩6次，使用其中4次做meal-skill單輪診斷：scratch前置重建「100元→其他」
兩個既有成功情境，只把其後「我要水餃」送新Jev／Main。Jev3calls後family低信心；
Main1call載入ordering@1，在744.54ms選intent:add-item；Host來源main-skill，Menu
產生「請問水餃要幾份？」且Cart0。Artifact skill-probe JSONL私有0600。總2612ms，
累計118calls／50625ms，剩2calls。這證明單輪真實技能接手；沒有新完整六輪或
真實「兩份」入車證據，不能以此宣稱所有正式對話已修復或可上線。


### 2026-10-31 完整六輪驗收：有效問題接手修正後3/3通過

使用者「那就驗收阿」後已開始新驗收，接著明確「此次不限額度」；移除本次
累計呼叫閘門，保留程序timeout／取消。沒有外推為部署或未來任務無限授權。

第一次完整run `skill-full-acceptance`前五輪正常，最後「兩份」失敗。Jev服務
0.9371，purpose SINGLE0.5429／ANSWER0.4228，confidence0.4515→UNCERTAIN_OPERATION。
當前Menu真的有水餃數量問題及quantity2／cancel／inquiry有限選項，但初版skill
只支援ordering新餐點，故未接手。新增configuration的有效item-configuration問題
恢復，僅可選waitingFor.choices與當輪候選交集；回傳原answeredQuestionId。
不從歷史取問題、不擴大工具權限；過期／錯purpose／未發行／readOnly仍不呼叫Main。
弱答句的route／Host／Menu重現先失敗再通過；技能unit26、Host skill3通過。

之後同一劇本以真實provider及全新PGlite／Session獨立重播：

| run | 六輪 | 呼叫 | 程序耗時 | 最終cart |
|---|---|---|---|---|
| skill-full-answer-fix | 全通過 | 26 | 9248ms | 水餃2份，160元 |
| skill-full-repeat-2 | 全通過 | 26 | 10540ms | 水餃2份，160元 |
| skill-full-repeat-3 | 全通過 | 26 | 8916ms | 水餃2份，160元 |

每輪實際結果：

| 顧客原句 | Menu／顧客可見結果 |
|---|---|
| 我有一百元，可以吃什麼 | 水餃80元符合；Cart0 |
| 有其他的嗎 | 沒有其他符合者，不放寬100元；Cart0 |
| 改成兩百元以內，看看其他餐點 | 蝦捲145／椒麻雞135／酸辣魚140；Cart0 |
| 還有其他的嗎 | 排骨130／打拋豬125／牛肉麵150，無重播舊批；Cart0 |
| 我要水餃 | 問「水餃要幾份？」；Cart0，不自行一份 |
| 兩份 | skill保留當前quantity問題ID，Menu真實新增；Cart2、total160與成功回執 |

三次configuration一致、flow stages1–6且seededPrefix:false；外部provider非mock，
API transport接真實scratch routes、Host與Menu，catalog用現有7品項simulator。
第二三次另強化oracle：耗盡句不以單一「其他」字眼判通過；價格仍<=100；
問數量前Cart0；最終total須為當輪單價乘2。第一次raw結果也符合這些加強條件。
私有JSONL／log及source hashes在/tmp，勿公開raw prompts／credentials。耗時含
scratch及網路，不是GPU推論benchmark。未操作正式Session／POS／付款或部署。
本驗收只涵蓋這條文字合成流程，未聲稱ASR、跨菜單、112劇本或全部技能已通過。


最終scoped驗證：Server92、Kiosk79離線測試通過，Server／Kiosk types與修改檔案lint
通過。三次provider設定一致、全新未seed六輪與Cart結果另經私有摘要核對。
`/tmp/webnavior-skill-six-turn-acceptance-20261031.sources.json`保存驗收後的來源SHA
及三次摘要（capturedAfterRuns:true，不冒稱事前hash凍結）。Production程式於三次
成功間未再修改；判定器第二次起加強，第一次實際結果也符合。此流程驗收完成，
不自動擴張至其他案例或部署。


### 2026-10-31 部署準備完成，等待本機sudo

使用者已要求部署。發布包ordering-skill-20261031-182642以當前正式Oct30 runtime
為基底，只覆蓋4個API差異；Kiosk／Menu正式建置通過並檢查註冊、scenario與POS
編譯網址。3190檔案hash、API載入、正式服務健康（db／redis正常）通過。腳本
保留舊runtime與前端備份，切換失敗自動回復，不改schema／provider／管理後台。
實際sudo -n執行回password required，未切換正式服務；這不是自動審核拒絕。
需本機sudo執行release/switch-release.py，再核對deployed-origin-verified與公開資產。


### 2026-10-31 已部署並完成部署後核對

使用者執行sudo腳本回報deployed-origin-verified。再次核對systemd API路徑為
ordering-skill-20261031-182642/runtime/apps/server，18:39:56 Taipei啟動且active。
3190發布hash通過，47個原站HTML／入口資產一致，livez／readyz與DB／Redis正常。
公開IAB可見Kiosk註冊頁，DOM入口index-D1UL0_nW.js與本次發布HTML一致。
未建立測試設備、Session或訂單，未進行正式模型對話。Generic HTTP automation
向公開HTTPS被403拒絕，IAB正常載入；不能宣稱公開HTTPS逐byte hash核對成功。
agent-browser技能指令與安裝版本不合，已用IAB備援完成只讀頁面檢查。
Manifest publicBrowserVerified已記true並列明核對範圍。使用者環境可刷新頁面載入
新前端；部署已完成，保留既有可回復路徑，沒有commit或schema／provider變更。


### 2026-10-31 正式基線分批提交與實驗接續

使用者明確要求分批commit。建立codex/kiosk-production-recovery，分批提交Menu
目標／換批價格、Host工具批次／完成回覆、Main skill與交接整合測試，以及文件。
前三批09a6786、a5bc0e0、06d4f0b；正式runtime獨立，不因git commit重啟或改版。

依CONTRIBUTING於commit階段完整lint及typecheck各跑一次。完整lint只指出未修改
的舊chat／audio測試、研究文件與實驗腳本等；沒有本次變更檔案。完整types止於
plugin-sdk-tamagotchi與electron-vueuse缺少模組宣告。保留失敗日誌，不宣稱全專案
通過，不修無關問題或重跑全專案。既有scoped檢查／3次完整真實驗收通過，另於
提交前驗Menu15、Host88通過。逐批正常pre-commit hook通過，未略過檢查。

SLM／Jev實驗分支及原工作區未變動。實驗工作樹尚有未提交內容，須先保存再整合
正式分支；比較時固定相同Main skill、Menu／Host與資料fixture，使用獨立測試
服務／資料庫／provider設定。只切git分支不能防止共用正式DB模型設定互相影響。


### 2026-10-31 部署後：回答內用卻推薦、後續回答票券過期

只讀最近180筆正式紀錄，確認18:52加排骨便當後詢問內用／自取；18:54顧客
回答「內用」，Main只執行menu_recommend，沒有order_set_fulfillment。內部草稿
宣稱已設為內用，但Host只公開推薦回執。18:55顧客再次明講內用，Jev選到正確
候選，Menu卻因前次問題票券剛過期而拒絕。這不是顧客語意不明，也不是純文字
呈現延遲。既有六輪驗收只驗到餐點入車，未涵蓋這段後續流程。

回歸先紅後綠：Main技能原先只接精確餐點與item-configuration，現也可在
服務已確認、有效fulfillment問題存在時選其當輪候選，保留answeredQuestionId；
不增加checkout、已過期、未提供候選、readonly權限。新精確餐點需求仍獨立處理，
不被舊fulfillment問題攔截。技能明示內用／自取須以實際設定回執完成，不代表
推薦、加點或開始結帳。另修復新決策沿用只剩瞬間有效舊票券的競態：每次新決策
給仍有效且已呈現問題完整30秒回答窗口；被動讀取不續期，舊票券過期、phase與
revision檢查仍保留。

Server技能33、Host真實路由／Menu整合5、Menu問題／座位32測試通過，模型使用
替身；變更檔案lint通過，Kiosk型別檢查通過。未呼叫正式provider或寫正式訂單，
未部署或commit；不能宣稱正式站已修復或此次真實模型驗收完成。


本修正已部署：使用者執行sudo腳本後，再讀systemd確認21:49:49 Taipei啟動於
fulfillment-answer-20261031-202907/runtime/apps/server，active。3189發布檔案hash、
47原站資產、livez／readyz200及DB／Redis健康通過。IAB公開Menu顯示7項餐點，
入口index-CTaMXh9r.js；Kiosk註冊頁入口index-D1UL0_nW.js，均符合發布HTML。
Manifest publicBrowserVerified記true，範圍僅頁面／DOM入口，未建立正式測試設備、
Session或訂單，也未重跑真實provider對話。原ordering-skill發布保留供回復。


### 2026-10-31 回答結帳邀請「好」卻沒有進入結帳

正式只讀紀錄22:17：內用設定成功，系統問「要進入結帳流程嗎？」；顧客答「好」，
Main即使做一次completion review，仍沒有工具呼叫，只回acknowledgement「好的，
請繼續告訴我您的需求」。之後顧客明說「結帳」才開始發票流程。前一版只補到
fulfillment，尚未承接checkout-entry。

此次限定30次／2分鐘模型驗收先重現另一層失敗：同一句「好」在有效結帳問題下，
Jev弱服務判斷導致recovery review invalid，還沒到Main操作接手就停住。因此不只
增加checkout-entry候選，也讓Main技能獨立判讀有效已呈現ordering問題的弱服務／
對象回答。只從該問題與當輪候選交集選擇；checkout-entry僅開啟流程或暫緩，不
包含發票、支付方式或付款。一般新需求仍要求服務確認，readonly、失敗復核、
過期／未提供問題、電話與後續結帳付款限制不鬆綁。

先紅後綠：Server技能與Host／真實Menu整合測試覆蓋「好」進入一次發票流程，
「先不要」維持訂單且不進入，無支付呼叫。真實provider合成單回合使用隔離DB／
購物車、種入排骨便當與內用問答作前提，不能稱完整從零點餐驗收。自然修正前
失敗1次（3calls）；修正後自然路由通過2次（各2calls），另以已觀察的Jev服務
棄權作故障注入、真實Main處理通過1次（1call，trace source=main-skill）。
共8calls／7.839秒；三次成功都進入invoice且只開始結帳一次，無payment selection。
Private JSONL /tmp/webnavior-budget-order-checkout-entry-{before-fix,after-fix,repeat-2,main-recovery}-20261031.jsonl。
修正未部署，不可宣稱正式站此問題已解決。


### 2026-10-31 已查詢單一道餐，省略品名訂購又被改成推薦

正式API已是checkout-entry-answer-20261031-225320，22:58:31 Taipei啟動；不是未更新。
只讀現場紀錄：「我想吃排骨便當」由Main技能選menu_get，展示唯一炸排骨便當並
說目前可以點；「那我要一份」卻只有cart_get、menu_recommend，未新增。字面
productResolution=none不代表沒有可用的當輪商品參照。原Main技能只收本句精確
品名，漏接唯一展示參照的訂購，Host因此轉readonly，重做推薦代替購買。

Server與Host/Menu回歸先紅後綠。修正限定：服務已獨立確認、ordering、無待答
問題、無新分類、唯一當輪reference且Menu已提供ADD_ITEM候選，才可讓Main
重新判讀。模型收到current references，只選既有效果；份數、目標及revision
仍由Menu解析／驗證。未確認服務、多人／多餐參照、無參照／候選、分類與readonly
不取得新購買權限，單純附和仍可棄權，沒有硬編碼某個商品或「那我要一份」。

本次使用者明確允許40calls／2分鐘的合成四句（想吃排骨便當、那我要一份、內用、好），
全部隔離DB/購物車、未操作正式POS或付款。自然四輪在修正前就可通過一次
（15calls/5316ms），因第一句走補份數而非現場的查詢。這不能證明查詢路徑已好。
種入現場已查詢單一品項的前提，再以真實模型執行省略品名訂購，修前確實失敗
（4calls/2872ms）：推薦同一道餐、cart0。修後同前提的三輪連續真實模型通過
（11calls/3923ms）：bento1/130→dine-in→checkout_invoice，結帳只啟動一次，無支付。
總30calls/12111ms；修後是查詢前提種入的三輪，不稱無種入完整四輪驗收。
Private /tmp/webnavior-budget-order-context-order-{before-fix,read-prefix-before-fix,read-prefix-after-fix}-20261031.jsonl。
此修正尚未部署。


### 2026-11-01 餐點確認回答「對，一份」轉為價位／種類問題

只讀最新正式紀錄，API仍是checkout-entry-answer-20261031-225320。此次現場
原句依序為「一份排骨飯」→關聯商品查詢、「排骨便當」→「您是要點炸排骨便當嗎？」、
「對，一份」→Main只執行menu_recommend(action:clarify)，回「你想調整價位，
還是換餐點種類？」。這個確認分支未被先前的省略品名案例覆蓋；原本僅Menu的
mealClarification測試，也沒有列入新集中回歸專案，不能稱之前已完整保護。

此次Server與Menu測試先重現失敗再修：Main技能補承接有效meal_confirmation／
confirm-meal問題，僅選當前yes／no，不取得付款權限。Menu原本只用提議原句
解析份數，現在在Host建立回答情境時保存questionId對應的瀏覽器原句，消耗yes
時用該回答解析新份數／選項，以原提議為上一片段；被動快照不覆寫回答。
消耗、拒絕、過期、replay與revision檢查保留。

已將四組無個資的現場原句及觀察錯誤保存為
apps/order-menu/src/evaluation/orderingIncidents.ts，現有整合測試直接引用：
內用變推薦、同意結帳變附和、唯一餐點省略品名訂購、此次確認兼份數。
新增整合測試使用本次完整三句的已觀察lookup／confirmation前提，透過實際
Server/Host/Menu確認排骨便當1份／130實際入車。模型仍為替身，不稱真實模型驗收。
新增拒絕兼份數不得購買／污染原草稿反例，並將Menu確認套件接入根CI專案。
固定test:ordering-regressions實跑198通過、2個opt-in跳過，共12files；型別與lint通過。
真實模型confirmation-order模式已準備但未執行，與部署／commit均仍未完成。
