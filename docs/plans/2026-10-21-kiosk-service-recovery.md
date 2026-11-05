# Kiosk 服務需求不明的 Main 裁決與前端呈現計畫

日期：2026-10-21。狀態：本機實作與功能驗證完成，依後續授權分批 commit；提交前整合檢查的界線記於文末，尚未部署。

當 Jev 無法確認是否為服務需求時，允許 Main 先做一次固定選項裁決；有效回答仍不確定時，再做一次較完整的原句與情境理解。有限裁決、完整理解與正式 Main 接手必須分開記錄。背景音不得因此引起招呼，服務確認不得變成新增、刪除或付款授權，前端每輪皆須正常收尾。

本計畫接續 `2026-10-21-kiosk-main-context-and-ordering.md` 的情境與操作限制。這次處理服務需求漏接的恢復流程，不更換 Jev、不重設一般判斷順序／信心門檻，也不擴充成所有操作選項的 Main 裁決框架。

## 已確認的現況

- `kiosk-interaction-decision/index.ts` 在操作意義不明時，已有最後的 Jev `serviceRequest` 確認；有效 REQUEST 轉 `NEEDS_ASSISTANT / UNCERTAIN_OPERATION`，BACKGROUND 忽略，未取得有效確認則保留 `UNCERTAIN_SERVICE_REQUEST`。因此「服務需求不明」與「不知如何操作」不能共用一個失敗分支。
- 服務需求不明出現的位置不一定相同。有些仍有後續有限判斷可做；有些已用完原操作判斷，只剩交接或停止。不能通過裁決後一律把原句再交 Jev 從頭分類。
- `phoneResolution.ts`、`priceResolution.ts` 已有 Main 固定工具選項的模式；`serviceResolution.ts` 分的是「純店家資訊／餐點需求」，前提是已通過服務判斷，不能當成新的服務入場裁決。
- `stages.ts` 持有同裝置／訪客的一次性 checkpoint，目前只把 Jev 問題當進度；checkpoint 未接續有效期為 15 秒，Jev 每句問題上限為 24。新 Main 階段不能冒充 Jev 問題／信心分數，或錯誤消耗這個問題上限。
- Kiosk 已有 `createDecisionFeedback`、`fastPathProgress`、`useKioskConversationProgress`、耗時列、重試與 Trace。`shouldShowDecisionRetry` 現在會讓服務需求不明保持安靜；這是語音保護，也造成主動送出的文字可能沒有明確收尾。
- `clarificationDiagnosis.test.ts` 的最後一句其實是「對」，並刻意模擬 relation UNCERTAIN；舊 mock 對新增的 serviceRequest 仍回傳 relation，並未模擬真正的服務判斷。不能用它證明真實 Jev 漏接，也不能只改預期字串。

## 範圍與不變條件

- 保留嚴格相機語音門檻、手機填寫／明確略過門檻、目前問題與訂單的版本／授權規則。
- 第一版處理有效 Jev 回答所造成的服務需求不明；明確背景／對同伴說話、有效未說完、空輸入不做恢復。初版不把獨立的 `UNCERTAIN_RECIPIENT`、`UNCERTAIN_GREETING` 全部改成可恢復；若未來擴大，另列測試與行為變更。
- 單純逾時、格式錯誤、缺少答案、超出候選／問題預算、provider 錯誤是技術失敗；不得假裝為有效 UNCERTAIN 而啟動第二個語意模型。保留既有、明確授權的基礎設施交接政策，與本流程分開。
- 已呼叫工具、取得部分結果或付款狀態不明的需求，不從這條服務恢復路徑重播。沿用既有回執／取消／失敗處理。
- Main 裁決不提供訂單工具、不產生工具參數、不改寫原句、不給自己填 Jev confidence=1。正式 Main 接手後仍須使用最新 Menu 情境與目前合法工具。
- Stage Web、原生 WebMCP、大麥頁面、POS 功能、推薦／combo 規則不在修改範圍內。不引入新套件、資料庫或模型供應商。

## 恢復流程

```text
Jev 的有效回答無法確認服務需求
  → Main 固定裁決一次
      REQUEST     → 接續尚存的有限步驟，或正式 Main 接手
      BACKGROUND  → 忽略並收尾
      UNCERTAIN   → Main 完整情境理解一次（無操作工具）
          確定服務需求 → 接續／正式接手／唯讀釐清
          確定背景     → 忽略並收尾
          仍不確定     → 收尾，按文字／語音來源呈現
```

固定裁決與完整理解是兩個不同的模型輸入／輸出契約；不把第一輪相同 prompt 再跑一次當作「完整理解」。只有有效 UNCERTAIN 可升級，呼叫失敗或格式錯誤直接依失敗政策結束。

### 固定裁決

Main 只選 REQUEST、BACKGROUND、UNCERTAIN。輸入包含完整原句、目前 phase／畫面、有效待答問題、與原句相關的真實 references，以及少量近期角色對話。不傳整份 Jev trace、圖片、模型推論文字或完整菜單，不要求 Main 再猜一組信心分數。

REQUEST 只確認「這是向本機提出的有效服務需求或有效回答」。代名詞「你」、有人在場、目前正在點餐，都不是單獨放行理由。BACKGROUND 包含一般電影／私人經歷閒聊，不能只因對本機提問就轉入回答。

### 完整情境理解

使用原始完整語句、相關先前需求、目前有效問題及其選項效果、目前 phase／畫面、保留的未完成需求摘要及有限商品證據。沿用已存在的 bounded role history；不增加 LLM 摘要步驟。此階段先確認整句的服務意義，不需要提前取得完整商品／訂單工具。

回傳結構包含：服務判斷 service／background／uncertain，以及處置 resume／assistant／clarify／ignore／abstain。程式檢查合法組合：只有 service 才能 resume、assistant 或 clarify；background 只能 ignore；uncertain 只能 abstain。不得攜帶商品替代、數量、付款同意或訂單工具參數。clarify 另帶最長 200 字的簡短服務釐清問題，不能宣稱任何操作已完成。

完整理解能確認服務需求，但固定候選不足以表達時，轉真正的 `NEEDS_ASSISTANT`，交付原句與目前情境；不把語句改寫成猜測指令。若仍不能確定，就結束這輪，不無限追問，也不強制選一項。

## 如何接回 Jev 與正式 Main

服務恢復的 module Interface 回傳「服務事實與證據來源」，流程位置由 Application 持有。它不直接執行 Menu，也不從瀏覽器接受任意模型答案。

| checkpoint 的狀態 | 有效 REQUEST 後的處理 |
| --- | --- |
| 尚有明確的下一個有限問題 | 回到同一個服務確認點之後，讓 Jev 處理剩下的問題；不重跑已完成問題 |
| 原操作判斷已無法決定／多項需求／候選不足 | 帶原始需求轉正式 Main；不能假稱已恢復成 Fast Path |
| 正在回答操作問題但具體效果仍不明 | 保留問題與未完成需求；Main 只能釐清，不繼承猜測的肯定、否定或 target |
| context／question／owner 已改變 | 舊裁決失效，不接續、不套用舊選項 |

第一版以現有最終 serviceRequest 失敗點為主要入口：該位置常已沒有可接續的操作判斷，因此多數有效 REQUEST 會轉正式 Main。只有程式仍持有確切 continuation 的位置才支援原位接續；不為了符合「交回 Jev」而做整句重判。

正式 Main 接手仍走現有 `kiosk_agent_task` 與每輪新情境。恢復不消耗 Menu 問題的回答票據，不恢復過期問題，不把 readOnly 變成可寫。已裁決為服務需求的事實可避免再次做相同服務分類，但價格範圍、電話略過及具體商品／付款效果仍由各自契約處理。

### 既有有限 Main 判斷的優先順序

電話階段先保留目前的略過解析：已取得有效 SKIP_PHONE 就使用原有有限候選，不再做通用服務恢復；其他結果只有在通用恢復的入口條件成立時才進入。這輪不得再重跑相同電話裁決。餐點價格與純服務資訊分類也不能重複套用在同一個已完成的 checkpoint。

用同輪的「已完成階段」集合明確記錄，而非散落多個防重 boolean。既有裁決與新裁決的來源、結果、耗時分開，不把電話／價格裁決的答案當成通用服務確認。

## 契約、所有權與取消

中立型別放在 `packages/stage-shared/src/kioskConversation.ts`，由 Server 與 Kiosk 直接匯入。Server 的 `DecisionStageResult` 引用該型別，維持 runtime-neutral import；不經 Server runtime 轉匯出給瀏覽器。

- 恢復 checkpoint 記錄 checkpointId、utteranceId／generation、裝置／訪客 owner、phase、menu/cart/checkout 等已提供版本、有效 questionId，以及是否仍持有可接續的有限步驟。
- 執行進度使用獨立 `SERVICE_RECOVERY_PROGRESS`，帶有限裁決／完整理解、started／completed、一次性 continuationId、expiresAt。已確認的服務事實另有來源 jev／main-adjudication／main-review；「模型開始工作」不是入場證據。
- 最終決策保留 `kind` 的執行含義，額外附 recovery 的階段、有效性、判斷與失敗原因。不要把裁決本身記成 NEEDS_ASSISTANT 或 FAST_ACTION。
- checkpoint 與模型回傳都由 Server 綁定 owner；瀏覽器只要求接續，不能帶選項覆寫 Server 的答案。沿用同裝置 generation、一次消耗與回應隔離。
- 下一句、重整、換訪客、離開頁面、手動接管、取消或超時，會撤銷相依的恢復狀態。HTTP AbortSignal 必須接到 provider；遲到結果不更新 UI、不產生回覆或操作。
- 原位接續與正式交接前，Kiosk 重新確認當輪 ticket 與 Menu 版本／有效問題。恢復期間變動時，撤銷舊結果；不藉刷新情境把舊寫入授權重新放行。
- 活躍 Main 任務期間的新語句沿用現有 queue／interrupt 規則；恢復不能額外 BEGIN 一個平行的訂單任務，也不能透過情境讀取替舊任務重新綁定寫入版本。

## 呼叫上限與延遲

本計畫的初始工程上限如下，實際延遲合格值仍需同模型量測：

| 項目 | 計畫上限 |
| --- | --- |
| 新增的固定 Main 裁決 | 每句最多 1 次，最多 8 秒 |
| 新增的完整情境理解 | 只有有效 UNCERTAIN 才呼叫，最多 1 次，最多 12 秒 |
| 上述兩階段合計 | 最多 20 秒，並受剩餘整輪時限限制 |
| 整句理解至操作回執 | 沿用 60 秒的總預算，但從本句正式處理起計，不在 Main 接手時重新給 60 秒；不含 ASR 錄音等待與 TTS 播放 |
| 已發出的 checkpoint 等待接續 | 保留 15 秒；各模型呼叫另受該階段與整輪 deadline 限制 |

固定裁決多數會直接分出結果；只有少數語意仍不明者多花完整理解一輪。正式 Main 的正常工具迴圈另外計數，仍沿用現有批次／工具上限與剩餘總時間。最壞情況是「新增 2 次恢復呼叫，再進正式 Main」，不能宣稱整個任務最多只有 2 次模型呼叫。

Jev 的 24 題上限照舊；恢復進度不計入 Jev 題數。若接續協定需要更多進度事件，分開限制「Jev 問題數」與「總進度事件數」，仍有有限總上限，不能因增加事件繞過預算。

沒有可用 Main、剩餘時間不足、取消、provider 失敗、非法選項，均為明確終止原因，不再自動重試整句。重試僅由使用者重新送出，且不可重播已接受的寫入。

## 前端呈現

沿用 `KioskConversation` 旁的現有進度列與耗時顯示，模型名稱與工程欄位放在 Inspector。前端以同一 utteranceId／turnId 更新階段，不為每個模型階段增加一個氣泡。

| 階段 | 主動送出文字 | 自動語音 |
| --- | --- | --- |
| 輸入已送出，尚未確認服務 | 立即顯示「正在確認您的意思…」與耗時 | 維持既有麥克風狀態；不顯示服務承接文字、不新增對話、不播等待語音 |
| Main 固定裁決／完整理解中，服務尚未成立 | 同一列持續更新；過 5 秒可顯示「還在確認，請稍候…」 | 仍安靜；Inspector 顯示實際階段、耗時與狀態 |
| 服務成立且正式接手 | 同一列改為「正在處理您的需求…」；接回既有工具進度 | 此時才允許服務處理進度與既有等待語音，不假稱已查到或已點餐 |
| 需要服務釐清 | 顯示具體問題一次，清除處理動畫 | 已確認服務才顯示／朗讀具體問題一次 |
| BACKGROUND | 停止轉圈，以短狀態顯示「這句沒有進行點餐操作。」 | 安靜結束，不產生招呼或重試邀請 |
| 最後仍 UNCERTAIN | 停止轉圈，顯示「我還不確定您的需求，請換個說法，或直接使用畫面操作。」 | 安靜結束；不能因聽不懂環境音就邀請點餐 |
| 技術失敗／逾時 | 停止轉圈，顯示「目前暫時無法確認，請再試一次或使用畫面操作。」與手動重試 | 服務未成立時安靜；已成立者沿用清楚的未完成提示，不宣稱操作成功 |

文字送出不代表內容一定是服務需求，只代表 UI 必須確認收件並收尾。來源使用既有 asr／simulation 的實際送出路徑辨識，不能把文字模擬當成語意已放行。對話與歷史每句最多記錄一次；短狀態不是正式助手對話，不回灌模型為新邀請。

5 秒狀態延伸只改顯示，不重設 deadline、不自動重問、不插入新氣泡。取消／新句／換訪客立即停止這輪的 timer、pending 標記與等待語音；舊事件不能清除或覆蓋新進度。

### 服務釐清的生命週期

服務已成立但還不知道要查詢或操作什麼時，允許唯讀服務釐清。Host 持有獨立的 service-clarification 記錄，含 questionId、問題、原始需求、owner／版本、30 秒到期與 readOnly 標記，放在既有問題呈現／生命週期模組。

它是理解線索，不是 Menu 的購買／付款確認。有效期間的「對／好」只能承接這個服務問題的語意，不回答背後暫停的 Menu 操作問題，不選商品、不消耗舊票據。需要具體購買或更換時，回到既有真實 Menu 候選／確認流程。新需求、過期、取消或版本改變使它失效；歷史仍保留，但不再是 active question。

## 修改位置與責任

| 位置 | 預計修改 |
| --- | --- |
| `packages/stage-shared/src/kioskConversation.ts` | 中立恢復結果／進度／服務釐清契約；證據來源與執行權分開 |
| `apps/server/src/services/domain/kiosk-interaction-decision/index.ts`、`contracts.ts` | 保留有效語意不明與無效／失敗的區別，產生可恢復 checkpoint，從服務事實接續，不偽造 confidence |
| 同目錄 `serviceRecovery.ts`（新增） | 集中入口資格、一次裁決／完整理解、輸入投影、嚴格輸出驗證、階段預算、合法處置組合與來源；外部 gateway／時鐘等才作 IO seam |
| 同目錄 `stages.ts` | 擴充既有 owner／generation／checkpoint 生命週期以發布獨立恢復進度，清理逾時與取消，不建第二份 queue |
| `apps/server/src/routes/kiosk/index.ts` | 接模型與 deadline、排除既有電話／價格重複裁決；路由保留接線，政策留在 module |
| `apps/stage-kiosk/src/services/kiosk-device.ts`、`kiosk-fast-path.ts` | 接新進度／結果、傳遞取消與剩餘預算；保留入場證據與真正 NEEDS_ASSISTANT 的區別 |
| `apps/stage-kiosk/src/services/questionPresentation.ts` | 服務釐清的有效性與唯讀回答線索；不冒充 Menu pendingCustomerChoice |
| `apps/stage-kiosk/src/composables/useKioskConversationProgress.ts` | 同輪恢復／接手／結束狀態與 timer；根據明確入場狀態投影顧客可見訊息 |
| `apps/stage-kiosk/src/components/KioskScene.vue` | 串接事件、輸入來源與現有 turn／queue／等待語音；不內嵌模型判斷規則 |
| `KioskConversation.vue`、`KioskDecisionInspector.vue` | 前者沿用 props 呈現進度／終態及 retry emit；後者顯示真實階段與來源，不將模型起跑當成服務成立 |
| `useKioskInteractionRecording.ts` | 正式 Main 只使用整輪剩餘時間，記錄恢復與正式接手的關聯，不重送原句 |
| `packages/i18n` 既有 stage 翻譯 | 顧客用語集中翻譯，避免顯示 Jev／工具錯誤字串 |

不新增通用模型互聊框架、回呼轉送服務或第二套訂單狀態。元件保持 Composition API，Scene 為接線層，狀態／呈現政策留在既有 composable 與擁有問題的 module。

## Trace 與效能驗收

- 獨立記錄 stage、trigger、checkpoint、原句關聯、admission／disposition、valid／invalid／timeout／cancelled、durationMs、resume／assistant 去向。只有白名單失敗碼，不記 provider 原始錯誤內容或思考過程。
- Jev modelCalls／modelQuestions 不混入 Main 恢復計數；新增 recoveryCalls、recoveryDurationMs，與正式 Main rounds／任務耗時關聯。input tokens 僅使用 provider 提供的 usage，缺值明示；不將 bytes 當精確 token。
- 沿用已有 Main 輸入量紀錄，在新裁決／理解呼叫也量實際 body 大小。每輪僅送一次目前情境，來源原句不累積多份，不為摘要另呼叫模型。
- 比較正常強判斷、有限裁決成功、完整理解後交接、最後仍不明、背景及技術失敗的呼叫數與 p50／p95；沒有實測不得宣稱更快。正常已確定的流程不得平白增加 Main 呼叫。

## 實作順序與驗收

1. 先把目前漏接入口、舊 mock 缺漏與前端無收尾補成可單獨執行的測試；明確模擬每種問題，未預期的模型問題直接讓測試失敗。
2. 實作中立契約與 Server 深 module，先通過無工具的裁決／理解與合法狀態組合測試。
3. 接既有 checkpoint／deadline／generation 與 Kiosk protocol，驗證原位接續、正式交接、取消與 stale，不重跑整段。
4. 接前端進度／終態與服務釐清；文字必收尾，未入場語音安靜，正常 Main 工具進度不受影響。
5. 執行局部測試、實際 DOM／跨來源測試、相關 app typecheck／修改檔案 lint／diff check。後續使用者已授權分批 commit，因此追加專案要求的提交前 root lint／typecheck；不推送／部署。

| 案例 | 必須成立 |
| --- | --- |
| 真正需求但有效 serviceRequest 不明 | 固定 Main 裁決；REQUEST 後接續或交接，原句完整、尚未執行 |
| 固定裁決有效 UNCERTAIN | 只做一次較完整理解，輸入確實多了相關情境；不循環 |
| Main 理解仍不明 | 終態明確；文字有提示，語音不邀請點餐，沒有訂單變更 |
| 你昨天有看那部電影嗎／笑聲附和 | 強背景不進恢復；若走恢復仍不可因「你」或先前助手招呼就授權服務／操作 |
| 對／一份／不要了＋有效問題 | 只理解目前問題的效果，不套用歷史或暫停問題 |
| 兩項需求被錯問成二選一，再說對 | 不選第一道；保留原始兩項需求與問題錯置，不以服務裁決授權單一道菜 |
| 手機畫面略過／點餐／撤回 | 既有有限 skip 成功只執行一次；其他結果不自行略過、不提前提供菜單操作 |
| 固定／完整理解非法格式、逾時、缺模型 | 技術終態，無自動整句重跑；錯誤不冒充 UNCERTAIN |
| 新句、觸控、換訪客、重整、晚到回應 | 撤銷相依恢復；新進度不被舊清理覆蓋，無過期執行 |
| 文字與語音同一句 | 入場政策相同、呈現不同；文字必收尾，未成立語音無氣泡／TTS |
| 已有 Main／工具或部分成功 | 不開平行訂單任務，不重播寫入／付款，不重綁舊任務版本 |
| 服務釐清＋肯定短答 | 唯讀理解線索，不消耗 Menu 的購買／付款問題票據 |
| 正常強判斷、推薦、combo | 不增加恢復呼叫，不改既有正常行為 |
| segmented／非 segmented、上限與取消 | 相同最終政策，來源／耗時／次數正確；進度事件不冒充 Jev 問題 |

既有 `clarificationDiagnosis` 拆清「歷史錯誤重建」與「目前正常期待」：正常複合點餐應辨識兩項；不確定答案不可買第一道；服務確認有效／不明／無效各自有完整 mock。不能把 `UNCERTAIN_OPERATION` 一律換成 `UNCERTAIN_SERVICE_REQUEST` 來湊通過，也不能將已知錯誤的單項購買永久當成功標準。

本計畫已實作於工作目錄，未做新語句的外部模型重播；相關 README／CONTEXT 與 handoff 同步更新。真實 Jev／Main 的新案例重播需另外確認既有外傳授權範圍，與本機合成測試、實機語音／觸控／POS 驗收分開列結果。

## 實作對應與時間驗證

- 第一版恢復入口是標記為 eligible 的最終服務語意不明；無效／缺答與 provider
  失敗另記 failed，不啟動通用恢復。REQUEST 通常轉正式 Main，因為此時操作
  判斷已經 abstain；未建立通用任意選項的 Jev 回跳框架，也不假裝有原位 continuation。
- 回傳進度在真正呼叫 Main 前發布，started／completed 各自一次性接續；Jev
  計數不含恢復事件，客戶端亦分開驗證題數與總事件上限。
- 已有服務釐清的下一句不重做服務入場裁決，直接用一輪 review 分辨 new-request
  與 clarification-answer；後者正式交接仍為 readOnly，不能吃掉舊 Menu 問題。
  服務釐清只能問服務種類，不能拿它來確認購買／刪除／付款。
- 8s／12s／60s／15s 由同一中立 limits 匯出。正式 Main 不重新取得一分鐘。
  60s 到期停止後續模型規劃，已接受的訂單工具仍等權威回執，不能假裝未執行。
- 文字在送出／排隊時有狀態，處理時有耗時與 5s 延伸；終態停止 timer。恢復階段
  的新文字可撤銷舊判斷，普通語音不能因此任意取消已接受的訂單操作。僅未開始
  操作的技術失敗可重走判斷；執行結果未明不顯示可重送原句的 retry。
- 本機 HTTP 測試將 Main promise 保持未完成，驗證開始通知已先送達（測試上限
  1 秒），再驗證完成通知及正確 Jev 計數。客戶端測試也驗證 onProgress 在慢
  continuation 完成前先執行。
- 真實 Chromium 測試在受控模型尚未完成時驗證「正在確認」、耗時與最後的不明
  提示。固定裁決 8s 與完整理解 12s 的假時鐘測試包含不理會取消的 provider；
  另以真實短 deadline 驗證 Main 使用剩餘預算。這不是外部模型 p50／p95。
- 固定裁決與完整理解共用 20s 截止時間，開始／完成通知等待前端接續的時間
  也計入。測試刻意延遲接續，驗證不會因通知等待而重新得到完整 8s／12s。
- 本機結果：Server 477 passed／80 skipped、Kiosk 227 passed／48 skipped、
  Menu 725 passed／177 skipped。最後合計截止／HTTP／stages 子集 25 項通過。
  Kiosk 四個瀏覽器檔案逐檔執行 15 項通過，跨來源通訊另外 15 項通過。
  並行瀏覽器檢查曾發生逾時；分開執行並修正仍預期電話頁可瀏覽的舊測試後
  通過，沒有放寬電話門檻或加長產品逾時。
- 額外的 ScenarioSurface 瀏覽器測試 1 項通過。修改的 TypeScript／Vue 檔案
  ESLint 通過，修改的情境 JSON 亦通過。提交前 root typecheck 找到跨套件載入
  Menu 虛擬驗證模組時缺少型別宣告；宣告改由 owning entry 引入後，受影響的
  stage-ui package typecheck 通過，未重跑整個 root typecheck。原一輪其餘
  套件未回報型別錯誤。
- root lint 未通過：仍包含未修改的 chats／kiosk-audio、provider、研究文件與
  PoC 資料等既有錯誤。未為提交混入無關修正；這與已通過的修改檔案檢查分開。
  全專案並行編譯曾造成大量交換空間使用，不將這種開發檢查耗時當產品延遲。
