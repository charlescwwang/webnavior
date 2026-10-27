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
