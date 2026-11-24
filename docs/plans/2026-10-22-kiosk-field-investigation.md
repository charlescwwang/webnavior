# Webnavior Kiosk 10 月 22 日場域異常分析

日期：2026-10-22，時間均為 Asia/Taipei。狀態：調查、修改與測試已分批提交，2026-10-22 16:30 更新場域供實測；真實模型八例 pilot 有一例混合需求失敗，現場語音及完整流程仍待驗收。下文「未部署／未呼叫模型」為各階段當時狀態，以文末更新為準。

今天主要問題集中在付款資料契約、操作回覆與實際狀態不一致，以及菜單查詢條件無法解除。公開入口與服務健康檢查目前正常，不能將這批互動失敗歸因於網域或服務停機。

## 調查範圍

- 場域：<https://webnavior.aikcitri.qzz.io/>。
- API journal：10/22 00:02:33 至 11:56:06 的快照，共 44,798 行。
- 今日資料庫互動紀錄：09:19:06 至 11:13:47，共 1,122 筆、25 個 session。包含 161 筆 ASR transcript、79 筆 user text、170 筆 assistant text、51 筆工具呼叫、49 筆工具結果、611 筆服務事件與 1 筆訂單結果。
- Journal 可解析 679 組 Jev 請求及回應；這是模型內部呼叫數，不能當作顧客說話次數或成功率分母。
- 資料庫 `created_at` 是無時區欄位，依 journal 同一事件確認為 UTC，再換算台北時間；查詢界線為 UTC 10/21 16:00 至 10/22 16:00。
- 本次沒有重播語音、呼叫模型、操作現場購物車或付款。ASR 文字不能單獨證明原音說了什麼，也不能判定聲源來自電視、同伴或 TTS 回授。

## 問題與優先順序

| 優先 | 問題 | 證據強度 | 影響 |
| --- | --- | --- | --- |
| P1 | LINE Pay／街口支付被快速判斷 API 的 schema 拒絕 | 日誌與原始碼均確認 | 付款階段的語音判斷路徑失效 |
| P1 | 宣稱完成操作，但未執行修改 | 對話、工具結果及後續狀態均確認 | 顧客相信已修改，實際訂單仍是舊設定 |
| P1 | 要求全部菜單仍保留單品查詢及排除條件 | 工具參數、queryState 與結果均確認 | 顧客反覆被告知沒有餐點，導覽無法復原 |
| P1 | 畫面顯示與實際狀態不同 | 使用者現場回報；已確認有無工具的導覽宣告，尚缺當時畫面對照 | 顧客所見、Agent 所理解及訂單狀態可能各自不同 |
| P1 | 誤以為餐點已加入購物車 | 使用者回報經常發生；本次快照尚未定位同日加購幻覺的完整案例 | 未加入的餐點可能被後續對話當作已訂購 |
| P2 | 附和與無關片段被接受為問候或服務需求 | 分類與對話有具體案例 | 重複問候、偏離流程、引入錯誤上下文 |
| P2 | 發票問題把內部操作指示直接呈現給顧客 | assistant text 確認 | 問句冗長且混入執行細節 |

### 付款資料契約不一致

10:45:50–10:46:23 共 9 次、10:56:51–10:57:15 共 12 次，`POST /api/kiosk/interaction-decisions` 回應 HTTP 400。21 次均包含相同的兩個欄位驗證錯誤：`linepay` 與 `jkopay` 不符合只接受 `card | mobile` 的 picklist。

瀏覽器送出的 phase 為 `checkout_payment_select`，`allowedPaymentMethods` 為 `["linepay", "jkopay"]`；這是當前菜單實際提供的付款方式，不是模型憑空生成的值。Server 在進入語意判斷之前就拒絕請求。

程式位置：`apps/server/src/routes/kiosk/index.ts:181` 的 `allowedPaymentMethods`；`:322` 起的路由在 safeParse 失敗時回傳 `INVALID_REQUEST`。Menu 在 `apps/order-menu/src/kiosk-intents.ts` 依現有付款方式建立候選，`webmcp.ts` 已接受 LINE Pay 與街口。

同一時間仍有 Main 回覆及工具呼叫，不能將 HTTP 400 解讀為全站付款不可用。10:46:24 Main 執行 `checkout_select_payment({method:"jkopay"})`，10:46:31 保存一筆 130 元、內用、`environment:test`、`status:accepted` 的訂單結果。這只證明測試付款／測試 POS 流程完成，不能當作真實收款。

後續修正應統一付款契約的擁有者與所有 consumer，先加入 HTTP 層的 LINE Pay／街口重現測試，再驗證付款語音路徑。還需追查當時 HTTP 400 與 Main 接手的完整關聯；不能只憑時間相鄰斷言錯誤會自動轉交 Main。

### 修改用餐方式只回覆成功，實際沒有修改

主要 session：`-P5dg5ANoXS371a95szIt`。

使用者進一步確認現場表現：在內用與外帶之間來回調整時，有些回合口頭說已調整，畫面卻維持錯誤選項，而且這部分沒有操作動畫支援。這項回報具體指向用餐方式切換；應與加購幻覺分開記錄。下表的工具與 cart 證據支持「部分切換未真正執行」，畫面選項及缺少動畫則是使用者的現場觀察。

| 時間 | 顧客要求／系統行為 | 實際證據 |
| --- | --- | --- |
| 10:49:54 | 工具將水餃訂單設為內用 | `order_set_fulfillment` 有結果 |
| 10:50:01 | 「還是外帶好了」→「已改為自取」 | seq134–137 沒有修改工具；本輪 metrics 的 `toolBytes:0` |
| 10:50:36–45 | 「我要改自取」「你沒有改字取」→反覆宣稱已設定 | seq143–153 沒有修改工具 |
| 10:54:04 | 加入招牌便當兩份 | seq329 的 cart 仍為 `dine-in`，證實前述自取沒有生效 |
| 10:54:36 | 明確執行自取修改工具 | seq341 的 cart 為 `takeout` |
| 10:54:52 | 「改內用好了」→「已設為內用」 | seq346–349 沒有修改工具；本輪 `toolBytes:0` |
| 10:56:15 | 「等等我要改成內用」→再次宣稱完成 | seq368–371 沒有修改工具；本輪 `toolBytes:0` |
| 10:56:56 | 讀取購物車 | seq396 仍為 `takeout`，總額 370 元 |

這不是單純畫面更新慢；後續工具回傳的 domain state 也未改。`toolBytes:0` 表示當輪模型請求沒有附工具 schema，因此不能只要求模型「記得呼叫工具」，也要追查語意交接、工具範圍與任務編譯為何把修改需求變成無工具回合。

Server `apps/server/src/routes/kiosk/index.ts:1044` 會在沒有 tool call、沒有強制菜單讀取、也沒有待呈現工具結果時，把模型文字保存為 `assistant_text`。今日後續 Jev state 已包含這些未驗證成功宣告，錯誤回覆會影響後續理解。此失敗模式延續 10/21 的未驗證成功宣告，但今天有用餐方式與後續狀態的直接對照證據。

後續應先用穩定公開行為重現「修改要求 → 實際 cart 不變卻回覆完成」，同時驗證工具暴露及成功回覆的證據來源；不能以無條件放開所有工具來處理。

### 全部菜單要求沒有解除舊查詢

使用者補充的現場流程是：先詢問單一餐點（以排骨便當為例），畫面展示該品項；接著問有沒有其他推薦，系統持續回答沒有；最後要求全部菜單，系統用文字列出全部餐點，但菜單畫面沒有更新呈現的菜色。這同時包含「推薦範圍沒有放寬」與「文字回答沒有驅動畫面呈現」兩個問題。排骨便當是使用者提供的例子；下列已定位紀錄則以椒麻雞便當為查詢條件，不能混成同一段逐字紀錄。

同一 session 的工具紀錄顯示：

1. 10:49:08 將 `query` 更新為「椒麻雞便當」。
2. 10:51:25 顧客說「我要看你們全部的菜單」，Main 先 `menu_get({display:false})`，再 `menu_recommend({action:"update",limit:3})`；queryState 仍為「椒麻雞便當」，只推薦椒麻雞。
3. 10:52:09 顧客說「了解」，Main 卻執行 `menu_recommend({action:"update",excludeItemIds:["spicy-chicken-bento"]})`。這個附和被轉成排除唯一候選，回傳沒有符合餐點。
4. 10:52:20 再次要求全部餐點，Main 仍只送 `update + limit`，保留舊 query 與 exclusion，繼續回覆沒有餐點。
5. 10:52:41 再次要求全部餐點，Main 改分類但未解除單品查詢；同輪接連查詢多個工具，最後回報已達處理上限。
6. 10:52:59 要求移到麵食分類，回覆「為您顯示麵食分類」，該輪沒有對應導覽工具。

另在 10:51:53，顧客問「全部有什麼啊」（seq219），10:51:54 Main 以文字列出七樣餐點（seq221），這一輪沒有菜單呈現工具。這支持「列出文字與更新菜單是不同操作」的分析；畫面菜色當時未更新則由使用者現場回報補足，不能把完整文字回答當成畫面已復原的證據。

`apps/order-menu/src/webmcp.ts:2315` 起明確規定 `update` 保留未指定清除的 browser-owned 條件，包含 query 與排除品項。今日工具結果符合這項既有政策，問題在需求的語意解析與呼叫參數沒有表達「回到全部菜單」，不能直接把所有 `update` 改成清空。

後續以完整連續流程驗收：

1. 查詢並展示排骨便當等單一品項，再要求「有沒有其他推薦」，不能仍把該單品名稱當成唯一查詢範圍。若沒有真正的額外限制，應能推薦其他可供餐點；不因單品結果已看完就宣稱整份菜單沒有其他選擇。
2. 要求「全部菜單」時，解除先前單品查詢及不再適用的瀏覽範圍，實際更新畫面菜色；不能只把完整 catalog 寫在對話裡，或只作 `display:false` 的內部讀取。
3. 畫面更新後，Agent 的新 snapshot、目前分類／篩選與可見品項需相符；後續「這個」「其他的」應引用更新後的呈現。
4. 明確的過敏／飲食限制仍保留，不把「全部」解讀成撤銷安全相關條件；若限制下確實沒有其他餐點，應說明適用範圍，不能泛稱全店無餐點。
5. 「了解」等附和不新增排除。整段流程保持既有購物車，不因重設瀏覽而清空或新增訂單。

### 畫面顯示與實際狀態不同

使用者補充的具體案例是內用／外帶切換：系統宣稱已調整，但畫面仍維持錯誤選項，且沒有操作動畫。這應同時追蹤口頭宣告、實際修改與畫面回饋，因為至少涉及三個不同事實：

- 顧客螢幕實際顯示的分類、彈窗、購物車與結帳階段。
- Menu domain 的 cart、selection、checkout 與 revisions。
- Agent 本輪讀到的 snapshot，以及它口頭宣稱的狀態。

目前可以證明第二、三者之間有落差，例如取餐方式成功宣告與後續 cart 不符；10:52:59 也有宣稱已顯示麵食分類、卻未執行導覽工具的案例。但資料庫中的 assistant text 不是畫面證據，不能據此斷言 DOM 當時停在哪個分類，或已確定是哪個 UI 同步機制失效。

原始碼中，`App.vue` 的 cart 使用 `onCartChange` 更新，screen 由 customer entry、checkout、cart review、item configuration 的顯示優先序推導；Menu 的 domain selection 與畫面可見 selection 仍須分別核對。檢查這些路徑不等於已重現 UI 同步問題，也不能用本機未部署的 Menu 修改推定現場畫面已修復。

接續重現要在同一個 device／visitor session／頁面與同一次操作中，對齊「操作前畫面及 snapshot → 工具結果與 revisions → 操作後畫面及新 snapshot」。選中餐點、打開規格彈窗、加入購物車、顯示購物車與進入結帳各自有不同效果，不能互相代替成功證據。尤其需涵蓋手動觸控介入、關閉彈窗、回到菜單與 session 重設。

用餐方式切換的驗收必須一起檢查：

1. 內用 → 外帶／自取，以及外帶／自取 → 內用，都真正執行對應工具，cart 與新 snapshot 一致；畫面名稱沿用當前 POS 的 `fulfillmentModes`，不擅改店家的「自取」標籤。
2. 畫面選項反映執行後的實際值，連續改口與語音／觸控交替操作後也維持一致。
3. 操作時有可見的目標提示與切換動畫，顧客能辨識正在調整哪個選項；完成回饋只在實際成功後呈現，不能用動畫冒充操作成功。
4. 工具未執行、失敗或結果不明時，不說「已調整」，也不把畫面或動畫顯示成成功。

動畫缺失與狀態錯誤需分別驗收：補動畫無法修正沒有寫入的 cart，只有改對 cart 而畫面／回饋仍錯誤也不算完成。

### 誤以為已加入購物車

使用者補充指出這種幻覺經常發生；這是現場回報的頻率描述，不是本次快照計算出的發生率。需要追蹤兩種表現：本輪說「已加入」但沒有成功寫入，以及後續把只曾展示／選取／討論過的餐點當作購物車既有品項。

截至本次資料庫快照，實際保存的三次 `order_add_item` 均有成功結果：

| 時間 | Session 與 sequence | 已確認加購 |
| --- | --- | --- |
| 10:44:25–26 | `UCZiTYfAwR0TrdDiC0L4V`，seq34–37 | 炸排骨便當 1 份 |
| 10:49:36–37 | `-P5dg5ANoXS371a95szIt`，seq116–119 | 水餃 1 份 |
| 10:54:04 | 同上，seq328–331 | 周氏蝦捲招牌便當 2 份 |

這三筆本身不是已證實的加購幻覺，也不能拿來否定使用者在其他時刻看到的問題。本次快照中尚未找到另一筆明確「已加入」宣告與失敗／缺少加購結果的完整同日案例。10/21 交接另有實際加購合計 3 份、後續 Main 卻聲稱 2／4／5／7 份的已知案例；該證據屬於前一天，不能併算成今天的新發生次數。

修正與驗收應以目前 session 的權威 cart 為準：推薦結果、選中品項、待確認草稿及對話歷史都不能證明已加入。只有當次成功加購結果及其 cart line／quantity 可以支持加購成功回覆；聲稱「目前購物車有什麼」也必須與相同 session 的最新 cart 對齊。沒有結果、結果不明或 session 已改變時，不能補寫成成功，更不能為了讓狀態符合口頭宣告而盲目重送加購。

### 重複問候與不當服務承諾

- 今日 assistant text 有 49 筆完全相同的「您好！」，不含固定迎賓文案。這是回覆數量，不能當作 49 個誤判；其中已確認有誤判案例。
- 11:09:57–11:10:29 同一 session 連續 ASR「好」後反覆回覆「您好！」。Jev 的 customer-entry `service` 分類對「好」回 `HELLO_ONLY`、confidence 0.9348；對「好，謝謝」回 0.876。這些案例已高於目前 0.6 接受門檻，單純略微調高門檻無法保證解決。
- 10:47:50「放電視」被回覆「好的，我幫您點餐」；11:09:26「請用茶」被回覆「為您準備茶水」，沒有對應服務執行證據。
- 10:42:18 回答「目前系統尚未開放點餐功能，僅提供資訊查詢」，與當前可點餐服務不符；這不是服務健康狀態查核結果。

後續應分開驗證純問候、附和、有效問題回答、無關服務及現場討論，不以「有辨識到文字」等同「已向本機提出可執行需求」。是否存在收音或回聲問題，需另取原音與裝置證據。

### 發票問句暴露內部規則

10:45:20、10:56:07 的顧客回覆包含「不輸入捐贈碼，也不執行付款」「資料未確認前停留在輸入畫面」等執行指示。來源是工具的 `pendingCustomerChoice.question`，由 `verified_reply` 呈現。

後續應將顧客問題與執行規則放在各自的契約欄位；顧客只需聽到可選方式與下一個必要問題。

## 服務與入口核對

- 公開根路徑目前 HTTP 302 至 `/kiosk/`。
- `webnavior-api` active/running，PID 2642311，自 10/21 13:37:43 啟動。
- 正確的本機 `http://127.0.0.1:5168/readyz` 回傳 ready，DB／Redis 均 ok。
- 公開 `/menu-api/health` 回傳 ok。`/api/readyz` 不是健康檢查路由，該路徑的 404 不代表 API 故障。
- 本次沒有重現既有一般瀏覽器跳 admin 的問題，因此舊 Service Worker／快取假說仍未證實。

## 原始碼深入調查與診斷結果

下列結果是在目前 checkout 上驗證的程式行為；它們能解釋日誌中的失敗模式，但不代表已重播現場的完整瀏覽器與模型流程。

| 環節 | 已確認缺口 | 修改意義 |
| --- | --- | --- |
| Kiosk `kiosk-fast-path.ts` 的 `conversationDecisionStateFrom` | `UNCERTAIN_OPERATION` 在 checkout 或仍有 checkout-entry 問題時轉唯讀，且不要求菜單讀取 | 不確定時不授權寫入是必要限制；不能直接取消限制來解決改口 |
| `KioskScene.vue` 的 `prepareRound` | `includeCatalog` 為 false 時回傳空工具清單，將菜單資料需求與工具提供綁在一起 | 應分開處理菜單資料、可讀狀態、合法操作與本輪需求 |
| `questionPresentation.ts` 的 `replyFromConversation` | 只對部分已知加刪改 intent 要求 outcome；未包含 `SET_FULFILLMENT`，未解析交接的 no-tool 回覆可直接使用 `result.answer` | 回覆完成與否必須依本輪效果及對應成功結果，而非是否生成文字 |
| Server Kiosk route 的 JSON／SSE 路徑 | 無 tool call 的模型文字可先保存為 `assistant_text`，早於 host 最終結果驗證 | 只擋螢幕回覆仍不足，錯誤文字會先進入後續歷史 |
| Menu `order_set_fulfillment` | 已有 reveal review → 精確 controlId 動畫 → 更新 machine／回呼；OrderReview 亦已註冊控制項 | 現場缺動畫不等於沒有動畫程式；先修工具未執行與動畫未到達的路徑 |
| `App.vue` 的 `animateAction` | 只有移除控制項找不到時會報錯；其他目標不存在時可靜默等待後返回 | 用餐方式目標缺失應可辨識，不可偽裝已完成可見操作 |
| Menu `update`／`reset` | update 保留單品條件；reset 與 continue 都排除已展示歷史 | 單用 reset 也不能實現包含已看品項的完整菜單 |
| `SEARCH_MENU` 候選、operation compiler 與既有測試 | 泛問全部仍被定義為最多三項的下一批推薦 | 這是需要明確變更的既有行為契約，不能只修 Main 提示詞 |
| Main 共用 context | 有完整 catalog、cart、selection 與 revisions，但沒有目前可見品項與查詢呈現的明確投影 | catalog 完整不代表模型知道畫面目前只顯示哪幾樣 |
| `kiosk-intents.ts` 的 `createQuestion` | invoice 會用候選的執行 description 重新組裝顧客問句 | 既有簡潔問句被覆蓋，導致內部規則外露 |

Jev 原始回應也顯示「改內用好了」曾選到 start-checkout、「等等我要改成內用」曾選到 donation，後續 relation／serviceRequest 再進入不確定或服務交接。這不能視為兩個操作已獲授權；計畫須保留原句與真實要求，不能把錯選候選帶成已執行的事實。

### 本機診斷驗證

- 隔離 Vitest 診斷 5／5 通過：確認目前會接受無回執的切換成功文字、無交接的加購成功文字，以及有 `SET_FULFILLMENT` 交接但無結果的成功文字；重現單品 query 被保留、排除後結果為空、data-only catalog read 不觸發呈現；確認真正執行 fulfillment 工具已有精確目標動畫事件。
- 這五項是「觀察目前缺陷」的診斷斷言，不是預期修復後通過的回歸測試，也沒有連線模型或現場 POS。
- 既有 Menu `actionPresentation.test.ts`、`recommendationFlow.test.ts`：29 通過、1 個選用診斷跳過。Kiosk `questionPresentation.test.ts`：43 通過。既有測試通過不能代表本次新案例已處理。
- 診斷檔與輸出在 `/tmp/webnavior-field-planning.test.ts`、`/tmp/webnavior-field-planning.config.mjs`、`/tmp/webnavior-field-planning-tests.log`；既有測試輸出為 `/tmp/webnavior-field-planning-{menu,kiosk}-baseline.log`。

## 修改規劃

本節保留本次實作依據；完成狀態與驗證見下方「本機實作與驗收」。沿用 Menu domain、既有工具與游標動畫、Valibot、Vitest 和瀏覽器測試，不新增第三方套件、另一套訂單 store、額外模型審核輪次或通訊方案。不新增泛用工具函式來包裝現有流程；必要的契約擴充放在原擁有模組。

### 一致性與責任邊界

Menu 擁有 cart、checkout、查詢／呈現與 revisions；Vue 從這些狀態呈現選項與菜色。Kiosk 綁定 task／session、取得每輪快照、執行工具並核對最終回覆。Server 負責 schema、模型工具範圍及歷史保存，不從模型文字推導已完成操作。

同一個已受理操作應依序完成：核對 task／session 與版本 → 顯示合法目標 → 既有動畫 → domain 寫入一次 → Vue 更新與新快照 → 依結果回覆。動畫前的目標缺失與寫入後的畫面失敗必須分開：前者尚未完成操作，後者保留真實寫入結果並回報呈現未完成，不能重送加購或付款。

共用契約沿用 `packages/stage-shared/src/kioskConversation.ts` 的 context、handoff、ConversationOutcome，補上必要的操作／呈現結果及當前可見 item IDs／查詢範圍。任務關聯與 freshness 使用既有 taskId、session、contextId 與 revisions，不另造一套生命週期。

完成檢查必須匹配本輪要求的 intent、對象及實際結果，不能只看任意 `customerMessage` 或有沒有問題收據。未解析效果的不確定回合使用應用程式擁有的釐清／未完成回覆，不任由模型把它寫成成功；已確認的 FAQ 仍使用服務資訊回答。這項規則沿用現有對話回合，不增加另一個模型來審核文字，也不靠成功關鍵字黑名單判定真假。

### 分批實作

| 批次 | 修改範圍與具體做法 | 完成條件 |
| --- | --- | --- |
| 1 付款契約 | 修正 Server decision schema 與 Main schema 對 allowedPaymentMethods 的不一致；沿用服務提供的有界方法 ID，實際付款仍由 Menu／POS 能力清單驗證，不在通用 API 再保存一份舊 card/mobile enum | 真實 Menu 的 linepay/jkopay payload 通過 HTTP 驗證；不存在的方法仍不能執行；不將 selected 回覆視為收款成功 |
| 2 成功回覆與歷史 | 以本輪效果及 Menu outcome 判定完成，擴充 fulfillment／checkout／畫面呈現的檢查；無法解析為合法操作的回合只能釐清或顯示未完成。Server 先保存模型草稿為 service event，host 驗證後再保存一次可用 assistant text；JSON、SSE、取消與手動接管走相同規則 | 未執行、失敗、只有讀取或只有選取時都不能說已加入／已修改；未驗證成功文字不進後續對話歷史；一般服務資訊仍可回答 |
| 3 用餐方式與畫面動畫 | 解開 includeCatalog 與工具清單的耦合，依當前合法能力及本輪效果提供工具；保留不確定回合的唯讀限制。order_set_fulfillment、onCartChange、OrderReview 與 context 對齊；精確目標缺失不能靜默假裝動畫完成 | 內用↔自取雙向、連續改口、語音／觸控交替後，cart、畫面選取、新 snapshot 與回覆一致；每次實際切換有目標動畫且只有一次寫入 |
| 4 推薦與全部菜單 | 區分精確單品查詢、其他推薦及完整菜單。其他推薦釋放先前精確單品 subject，保留真正有效的顧客條件；全部菜單用既有 menu_get 擴充明確 catalog 顯示模式，產生完整 query-results 呈現，不再轉成三項推薦 | 排骨便當→其他推薦→全部菜單流程可完成；完整顯示可包含先前看過的餐點，文字不是唯一輸出；購物車與明確飲食限制保留 |
| 5 附和與問候 | 在既有語意題目與 Main 任務效果中區分純問候、附和及新要求；「了解」沒有新的拒絕依據不能新增 excludedItemIds。加入觀察到的 provider 回應與完整上下文案例，不以單純調高門檻作修正 | 「好／謝謝／了解」不反覆啟動問候或改查詢條件；有效待答問題的「好」仍能正確承接；不增加語意分類輪次 |
| 6 發票文字 | 保留短顧客問題，候選 description 繼續作內部語意與執行規則；顧客用語放既有 i18n 擁有模組 | 顯示／語音只說可選發票方式，不朗讀不執行付款、資料未確認等內部指示；發票與付款狀態機不變 |

批次 1 可獨立實作；批次 2 是後續操作修正的基礎，批次 3／4 都依賴它。每批先建立預期行為的失敗重現測試，再改程式；不先改 production、最後才補一個會通過的測試。

### 用餐方式的階段處理

- 尚未結帳：切換是獨立新要求，不能被舊的「開始結帳嗎」問題吞掉；明確效果走既有有限候選或經驗證 Main 操作，不因等待 checkout-entry 就一律失去修改能力。
- 已進入發票／付款選擇且尚未付款：目前合法工具不允許直接改用餐方式。沿用既有取消結帳確認，確認返回訂單後再切換；在完成這些步驟前不得說已修改。結帳取消與切換需保留任務需求，但不能重用舊確認票據。
- 付款 pending／uncertain 或訂單完成：保留現有鎖定，不切換、不自動重送付款；回覆明確說尚未變更。
- 重新指定相同方式：回覆目前已是該方式，不偽裝成新切換，不重釋放桌位、重寫 cart revision 或播放重複成功操作。

### 推薦與完整菜單的契約變更

完整菜單使用 `menu_get` 的明確 catalog scope 與 display 模式，直接建立全範圍的 `query-results`，沿用現有呈現回呼與畫面載入狀態；不擴大 `menu_show_recommendations` 的 1–4 項推薦契約，也不把 recommendation 的 limit 改成無界。必須同時更新靜態工具定義、runtime schema、SEARCH_MENU compiler、Server 提示與既有「全部等於下一批三項」測試。

目前每批三項的推薦保持原規則；「其他推薦」從可用範圍選下一批，不能沿用精確單品 query 形成只有一樣的封閉範圍。「全部菜單」則重新呈現完整可瀏覽範圍，已看過的品項仍可見，不受推薦 seenIds 排除。明確飲食／食材排除維持，其他價格／分類條件依顧客本輪是否明確保留處理；不能從「全部」推導成撤銷過敏限制。

模型不自行重建完整 UI 狀態。Context 增加 Menu 擁有的目前呈現種類、範圍與 item IDs，Server 只投影當輪必要資訊；完整 catalog、selected draft、cart lines 與 visible items 各自有明確含義。呈現成功驗證應查真正的畫面更新，不只看 callback 被呼叫。

### 修改位置與既有驗證入口

| 擁有模組 | 主要檔案 | 驗證入口 |
| --- | --- | --- |
| Server API、模型輸入及保存 | `apps/server/src/routes/kiosk/index.ts`、`services/domain/kiosk-agent-interaction/conversationContext.ts` | `routes/kiosk/index.test.ts`：真實 Menu payload、JSON／SSE 草稿與最終保存、工具範圍 |
| 共用中立契約 | `packages/stage-shared/src/kioskConversation.ts` | 既有契約測試及 consumer 的 scoped typecheck；不從 Server runtime 取得共用型別 |
| Kiosk 交接、工具迴圈與回覆 | `services/kiosk-fast-path.ts`、`services/questionPresentation.ts`、`composables/useKioskInteractionRecording.ts`、`components/KioskScene.vue` | 既有同名 unit tests、`KioskConversation.browser.test.ts`、`mainScopeReplay.test.ts` 的隔離 mock 路徑 |
| Menu 執行、授權、查詢與呈現 | `apps/order-menu/src/webmcp.ts`、`kiosk-intents.ts`、`toolDefinitions.ts` | `actionPresentation.test.ts`、`recommendationFlow.test.ts`、`configurationFlow.test.ts` 與 domain tests |
| 顧客畫面 | `apps/order-menu/src/App.vue`、`components/OrderReview.vue` | `OrderReviewFlow.browser.test.ts` 加雙向連續切換；`MenuSimulation.browser.test.ts` 或相近現有測試加完整菜單流程 |
| 顧客文案與正式契約 | `packages/i18n`、Order Menu README、既有 Main 計畫 | 發票問題組裝測試；同步修改過時的全部菜單與批次政策敘述 |

不以此次任務為由拆整個 KioskScene 或 Menu runtime。小範圍整理只處理工具能力、效果驗證與呈現政策的實際責任邊界，保留目前既有未提交的 Menu 行為修正。

### 必須先建立的回歸案例

1. 真實 checkout_payment_select payload 含 linepay／jkopay：HTTP 不回 400，合法方法由當前 Menu 決定；未知／過期候選拒絕。
2. 「還是外帶好了」「我要改自取」「改內用好了」連續操作：不承接成同意結帳，每輪核對 cart、畫面 selected、target 動畫與最新 snapshot。
3. 發票中「等等我要改內用」：先完成受確認的結帳返回流程，不先說成功；付款鎖定時不修改。
4. 模型沒有工具卻回「已加入排骨便當／已改內用」：不呈現成功、不存成可信 assistant 歷史；有其他餐點的讀取結果也不能完成修改任務。
5. 選取／規格草稿／暫停餐點：不得被當成 cart line。加購成功後依實際 line quantity 回覆；timeout、失去回執、session reset 不重送寫入。
6. 排骨便當展示 → 其他推薦 → 沒有更多後再看全部：最後 DOM 中呈現完整符合條件的菜色，包含已看過品項；next context 的 visible IDs 與 DOM 一致。
7. 同一流程加上明確不吃豬肉等限制：放寬單品範圍不能移除飲食限制；「了解」不新增排除。
8. 控制項尚未註冊、動畫失敗、寫入後呈現失敗：正確區分未寫入與已寫入，不產生假成功或雙重加購。
9. 純服務 FAQ、有效問題的短答與無關附和：正常回答保留，但不假裝操作或反覆問候。
10. 發票問題只呈現顧客選項；raw trace 仍保留執行限制，付款成功仍只信正式結果。

測試註解引用本調查文件及 session／sequence，無外部 tracker 時不虛構 issue ID 或報告網址。對模型路徑使用已觀察到的回答與注入式 provider stub，保留真實 producer／schema／consumer 邊界，不用 Vitest mock 掩蓋 import 問題。

### 驗證與發布界線

實作時先執行新增案例與受影響檔案的 Vitest，再跑相關 package typecheck／changed-file lint；最後執行隔離瀏覽器驗收，確認畫面與實際 cart 而不只檢查呼叫次數。Menu、Kiosk、Server 與 stage-shared 使用 package-scoped 指令，不預設執行 root typecheck。

完整流程採人工菜單、測試付款與新 visitor session。需真實模型驗收時，另記模型／設定／prompt 與實際結果；mock 通過不等於現場語意辨識已通過。使用者後續已授權實作。本機程式修改與隔離驗證已完成；未 commit、重啟服務、操作正式付款或部署。

## 歷史問題與固定回歸範圍

此表集中索引已知案例，不表示所有歷史問題已收齊。每次修正先重現當次問題，再執行同一流程的歷史案例；發布 Menu／Kiosk／Server 的整合版本前，執行三個相關 package 的完整單元測試及下列瀏覽器案例。不能只以新案例通過代替既有流程驗證，也不需要每次小改動重跑無關的全專案測試。

### 向前盤點範圍：2026-08-31 至 2026-10-22

本次核對 Menu／Kiosk／Server decision 的 Git 歷史、既有 handoff、9 月控制平面／POS／System One 計畫、10 月決策研究與入口／傳輸改造文件，以及目前測試內容。最早可追溯的功能基準是 8 月 31 日 `d7220f5`／`ecf240c`；這是功能建立日期，不是每個問題的發生日期。沒有逐筆重讀全期間的正式站日誌、私人對話或語音，不宣稱涵蓋所有現場事故。

以下「已重跑」指本輪本機預設測試通過；診斷、跳過、歷史驗收及尚缺的完整流程另列。舊 Speech Guard／native WebMCP 的實作已被替換，只保留顧客行為與安全邊界作為回歸要求，不復活舊架構。

| 時間／來源 | 歷史需求或問題 | 目前證據與覆蓋 | 尚缺部分 |
| --- | --- | --- | --- |
| 08-31 初版 `d7220f5`、`ecf240c` | 菜單、選餐、數量、加購與 Kiosk 基礎功能 | Menu `domain/order-machine.test.ts`，已重跑；此列是功能基準 | 不以初版日期推定當時所有操作曾驗收 |
| 09-07 `faec7d8` | 未選內用／自取不能跳入完成流程 | Menu `domain/order-machine.test.ts`、`kiosk-intents.test.ts`，已重跑 | 實際 POS 提供的能力與門市用詞需現場驗收 |
| 09-13 `f64498e` | VAD 遺失句首音訊 | Kiosk `services/kiosk-audio.test.ts` 核對 WAV 前置樣本，已重跑 | 真實麥克風、瀏覽器與噪音下的辨識品質 |
| 09-15 `e79faad`、`9b1c7b4` | 權限請求順序、重設失敗後不可操作 | Kiosk `kiosk-startup-permission-gate.test.ts`、`useKioskCustomerSession.test.ts`，已重跑 | 實際裝置授權視窗及拒絕後重試 |
| 09-17 背景聲改單、09-29 `3df4044` 改造 | 顧客／背景語音、合法候選、版本與確認隔離 | 現行 Server decision、Menu intents、Kiosk Fast Path，已重跑；舊 Speech Guard 已移除 | 高信心誤判仍有診斷失敗，見下表 |
| 09-21 POS 計畫／09-23 串接 | 訂單、會員、發票、付款鎖定及失敗狀態 | Menu checkout／POS Bridge 測試與 simulator，現行 Menu 套件已重跑 | 本輪未另跑 Bridge 全套；廠商 adapter、設備及 uncertain 對帳未完成 |
| 09-30 `7572a14` | ASR 返回順序、連續語句、重設中止舊工作 | Kiosk `kioskUtteranceQueue.test.ts`、`stagedInteraction.test.ts`，已重跑 | 整個 Scene 搭配真實 ASR 網路失敗的生命週期 |
| 10-01 重複輸入調查 | IME Enter／按住 Enter 造成提前或重複送出 | `KioskAsrSimulationPanel.browser.test.ts` 的實際 DOM／鍵盤案例已重跑 | 原事故未記錄鍵盤事件，不能斷言原事故唯一成因 |
| 10-02 決策研究、10-03 handoff | 成分／素食、價格、查詢、付款及 confirmation 權限 | Menu `composition`／`priceFlow`／`questions`，Server `stages`／`context`，已重跑 | 真實模型的語意準確率不是這些單元測試的證明 |
| 10-03 至 10-06 handoff | 份數與顆數混淆、必選規格預設、插入查詢後草稿遺失 | Menu `configurationFlow.test.ts`；`RequiredConfiguration.browser.test.ts`，均已重跑 | 現行店家無客製選項，規格案例使用明確人工 POS 宣告 |
| 10-05 至 10-06 handoff | 廣泛瀏覽、片段品名、單一分類成員被誤當精確商品 | Menu catalog／target identity／resolver 測試，已重跑 | 縮寫、錯字的安全解析仍有未滿足診斷，不可自動猜餐 |
| 10-06 至 10-08 附件／決策研究 | 短答失效、錯誤轉交、其他推薦重複、多餐點被簡化 | Server question routing、Menu clarification／recommendation 診斷已明確開啟重跑 | 9 個診斷斷言未滿足；不是預設測試全綠就已解決 |
| 10-07 HTTP 500 後語音停住回報 | 後續 ASR 仍有字但無 decision | Queue／Fast Path 拒絕後繼續處理的既有測試已重跑 | 原始失敗 endpoint／完整 Scene 證據不足，不能標成事故已修復 |
| 10-17 至 10-20 傳輸改造 | iframe 重載舊工具、跨 origin、普通瀏覽器接入 | 既有 `interactiveServiceClient.browser.test.ts` 與 10-20 計畫記錄測試；本輪未重跑跨 origin harness | 不以 Menu runtime 測試取代真正跨頁傳輸驗收 |
| 10-18 至 10-19 入口／登入計畫 | 首頁誤入管理頁、401 登入復原、舊 SW 狀態 | 已核對原計畫；Kiosk `kioskAssets.test.ts` 的重複 base 路徑測試已重跑 | 管理登入及既有 SW 瀏覽器本輪未驗；無痕正常不能證明舊快取問題已修復 |
| 10-18 至 10-20 handoff | 換餐變加餐、台灣口語價格、查詢範圍與手機略過 | Menu cart／pricing／queryScope／customerEntry、Server cartCorrections／phone，已重跑；PhoneEntry DOM 已重跑 | 真實語音／模型仍另驗；不能只測固定正確意圖 |
| 10-21 至 10-22 調查 | 假成功、內外帶、全部菜單、付款 payload、附和與發票問句 | 本節下方逐項索引；新加飲食／價格／全菜單／下一顧客與舊確認隔離兩個連續案例 | 正式網址仍是舊部署；本機通過不代表現場已生效 |

### 尚未滿足的診斷與驗收缺口

本小節保留向前盤點時的結果。後續「多餐點被當成單選」已完成本機修正並轉為預設回歸測試，詳見文末後續修正；其餘診斷仍需分別處理。

本輪開啟既有診斷開關，使用本機注入 provider 重播，沒有對外傳送訪客原文或呼叫真實模型。9 個斷言未滿足，分為 7 類；這是尚未達成的歷史預期，不等於 9 個已確認的正式站缺陷。尤其「應直接 FAST_ACTION」與現行保守轉交 Main 的設計須分別評估，不能為了變綠降低門檻或把安全轉交一律當作失敗操作。

| 類別／原報告 | 本輪結果 | 後續處理與優先性 |
| --- | --- | --- |
| 多餐點後回答「對」，10-08 附件 `fedc8278` | `clarificationDiagnosis` 1 斷言失敗；重建既有釐清狀態仍可授權第一個餐點 | 優先補齊整句多餐點／逐項完成契約；正確 MULTI_ACTION 交接已受測，錯入單選後的集合肯定仍未解決 |
| 「其他推薦」卻被模型選成新推薦，10-07 附件 `196c07ec` | `recommendationFlow` 1 失敗；執行後重複 dish-0／1／2 | 優先核對 fresh／more 語意契約；Oct22 修的是正確 more 路由之後的範圍，未修此上游誤選 |
| 無關談話高信心轉助手，10-07 附件 `2c567045`／`fb20874f` | Server `index` 2 失敗；回傳 NEEDS_ASSISTANT 而非 IGNORE | 優先列入服務範圍驗收；錄得高信心不是相關性的證明，不能聲稱現場誤入助手已根治 |
| 「排骨的一份」／「蕉麻雞便當來一份」，10-07 記錄 | `asrNameDiagnosis` 2 失敗；片段證據不提供 ADD 候選 | 現行保守邊界仍有效；需求是安全解析／釐清，不是直接讓猜測取得加購權限 |
| 「有水餃嗎」低信心 NO_FILTER，10-07 附件 `73501877` | `filterDiagnosis` 1 失敗；NEEDS_ASSISTANT 而非 FAST_ACTION | 區分有限路徑效率與服務完成；需驗 Main 是否實際完成查詢，不降低 filter 門檻 |
| 「牛肉麵一碗」弱路由後 NEW_REQUEST，10-07 附件 `9b8c37b5` | `questionRouting` 1 失敗；有效補充 admission 後轉交 NEEDS_ASSISTANT | 補 Main 接手完成的整條鏈；此結果不是原本的「缺 fixture 答案」或證明購物車已改動 |
| 「還是內用好了」誤選結帳，10-08 附件 `1842461e` | `fulfillmentDiagnosis` 1 失敗；NEEDS_ASSISTANT 而非 FAST_ACTION | Oct22 已補執行回執／DOM 與合法結帳返回；仍須驗錯路由轉交後是否完成用餐方式變更 |

其中 recommendation 與 NEW_REQUEST 的舊 stub 最初缺少後來加入的 recipient／serviceRequest 回答，會先在錯的邊界失敗。本次僅補測試的明示人工回答，保留錄得的 route／relation 與原斷言；`// NOTICE:` 註明補充答案不屬於原始訪客紀錄。修補後分別重現真正的重複菜色與保守轉交，沒有修改產品程式或重新調整模型分數。

診斷執行方式（預期非零 exit code，獨立於已通過的固定回歸，不可計為發布通過）：

```sh
KIOSK_ASR_NAME_DIAGNOSIS=1 KIOSK_CLARIFICATION_DIAGNOSIS=1 KIOSK_RECOMMENDATION_DIAGNOSIS=1 pnpm -F @proj-airi/order-menu exec vitest run src/asrNameDiagnosis.test.ts src/clarificationDiagnosis.test.ts src/recommendationFlow.test.ts
KIOSK_FILTER_DIAGNOSIS=1 KIOSK_NEW_REQUEST_DIAGNOSIS=1 KIOSK_FULFILLMENT_DIAGNOSIS=1 KIOSK_OFF_TOPIC_DIAGNOSIS=1 pnpm -F @proj-airi/server exec vitest run src/services/domain/kiosk-interaction-decision/filterDiagnosis.test.ts src/services/domain/kiosk-interaction-decision/questionRouting.test.ts src/services/domain/kiosk-interaction-decision/fulfillmentDiagnosis.test.ts src/services/domain/kiosk-interaction-decision/index.test.ts
```

診斷結果：Menu 30 通過、4 失敗；Server 104 通過、5 失敗。紀錄：`/tmp/historical-menu-diagnosis-final.log`、`/tmp/historical-server-diagnosis-final.log`。原始補 fixture 前的結果另保留，不混用作最終結論。

### 本輪補強與重跑結果

- 新增連續案例：不吃豬肉 → 改價格／排除已看 → 切自取 → 看全部菜單，驗證飲食限制與兩份 cart 保留；reset 後下一位顧客恢復完整菜單、空 cart 與未選用餐方式。
- 新增 session 隔離案例：上一位顧客取得清空確認 → reset → 新顧客點同一道兩份 → 重播舊確認，必須拒絕並保留新 cart。
- Menu 全套 737 通過／177 跳過；Kiosk 全套 231 通過／48 跳過；Server decision domain 422 通過／80 跳過；Kiosk proactive 24 通過。跳過中包含 live replay／診斷／實驗，不是全部都代表可忽略的可選功能。
- Chrome 歷史元件測試 23 通過／2 跳過：IME 輸入、手機頁、必選規格、FieldState；完成訂單的 2 項測試需要獨立 loopback Bridge／payment simulator 與明確環境設定，本輪未啟用，未觸碰正式 POS。跨 origin harness、本輪未重跑的管理登入、實機、真實模型與全專案 typecheck 均不列為通過。
- 本輪只修改測試與既有文件，不修改產品程式、不 commit 或部署。預設測試與故意開啟的未滿足診斷結果分開記錄。
- 補齊兩個 stub 後，Menu 相關 26 項與 Server routing 20 項預設測試再驗通過，各保留 1 項診斷跳過；Menu package typecheck、修改檔案 ESLint 及 diff 格式檢查通過，未跑全專案 typecheck。

結果紀錄：`/tmp/historical-{menu,kiosk,server,proactive}-suite.log`、`/tmp/historical-browser.log`。後續新增案例應進入對應的現有測試檔，由各 package 的 `test:run` 自動收集；跨頁／實機與已知診斷仍須依本表另外追蹤，不能因預設 suite 跳過就把它們標成已解決。

### Oct21–22 現場案例明細

| 歷史問題／來源 | 自動化案例位置 | 目前覆蓋與界線 |
| --- | --- | --- |
| Oct21 加購後彈窗／原有瀏覽位置被改變 | Menu `configurationFlow.test.ts`；Kiosk `OrderReviewFlow.browser.test.ts` | 草稿恢復、完成後關閉與既有畫面流程；現場裝置仍需驗收 |
| Oct21 實際加購 1＋2，後續說成 2／4／5／7；Oct22 回報假加購 | Menu `fieldRegression.test.ts`；Kiosk `fieldRegression.test.ts`、`questionPresentation.test.ts` | 驗證實際合併為 3、無回執不能宣告操作成功；尚非完整真實模型逐句重播 |
| Oct21 不存在的鱔魚品項被替換成牛肉麵 | Menu `targetIdentity.test.ts`；Server `unresolvedOrder.test.ts` | 品項身份與未確認替換的邊界；語音辨識及現場模型另驗 |
| Oct21 未加入草稿、換餐與插入詢問互相干擾 | Menu `configurationFlow.test.ts`、`mealClarification.test.ts` | 未完成餐點與已加入購物車分開、暫停後恢復及過期答案拒絕 |
| Oct22 內用／外帶口頭成功但未變更 | Menu `fieldRegression.test.ts`；Kiosk `FieldState.browser.test.ts` | 精確控制項、連續切換、失敗不寫入、DOM selected 與快照一致 |
| Oct22 發票階段改用餐方式 | Menu `fieldRegression.test.ts`、`kiosk-intents.test.ts` | 一次性確認後返回；付款鎖定不切換；不接真實付款設備 |
| Oct22 單品後「其他推薦／全部菜單」卡住 | Menu `fieldRegression.test.ts`、`recommendationFlow.test.ts`、`queryScopeFlow.test.ts`；Kiosk `FieldState.browser.test.ts` | 單品範圍釋放、保留限制、完整菜色及 rendered IDs；不是只比對回覆文字 |
| Oct22 LINE Pay／街口付款候選被 HTTP 400 拒絕 | Server `routes/kiosk/index.test.ts` | 真實格式通過 schema；付款執行合法性仍由當前 Menu／POS 驗證 |
| Oct22 附和變問候、發票問題洩漏內部候選描述 | Server decision `fieldRegression.test.ts`；Menu `fieldRegression.test.ts` | 獨立附和不呼叫模型、有效待答問題不被一律忽略、發票問句不含內部規則 |
| Oct22 修正 A 後 B 被破壞的交互風險 | Menu `fieldRegression.test.ts` 的 `browse-first`／`fulfillment-first` | 同一 runtime 中 1＋2 加購 → 兩種順序的推薦／全部菜單及反覆切換 → 再加另一餐；每階段核對 cart 與快照，最終數量為 4 |

Menu 路徑相對於 `apps/order-menu/src/`；Kiosk 服務測試在 `apps/stage-kiosk/src/services/`，瀏覽器測試在 `apps/stage-kiosk/src/components/`；Server decision 測試在 `apps/server/src/services/domain/kiosk-interaction-decision/`。

快速重跑本次與鄰近歷史案例：

```sh
pnpm -F @proj-airi/order-menu exec vitest run src/fieldRegression.test.ts src/configurationFlow.test.ts src/targetIdentity.test.ts src/recommendationFlow.test.ts src/queryScopeFlow.test.ts src/actionPresentation.test.ts
pnpm -F @proj-airi/stage-kiosk exec vitest run src/services/fieldRegression.test.ts src/services/questionPresentation.test.ts
pnpm -F @proj-airi/server exec vitest run src/services/domain/kiosk-interaction-decision/fieldRegression.test.ts src/services/domain/kiosk-interaction-decision/unresolvedOrder.test.ts src/routes/kiosk/index.test.ts
```

每筆新問題應補上來源、觸發前狀態、操作順序、權威結果及測試位置；無法自動化或尚未補齊的部分明列為待驗收。可重現的缺陷先建立失敗測試再修正；跨流程問題加上同一 session 的連續操作案例。模型設定／prompt、ASR、實機與正式 POS 的驗收結果應分開記錄，選用測試跳過不能當成通過。

建立此索引並增加兩種操作順序後，上述三條快速重跑指令結果：Menu 85 通過、1 跳過；Kiosk 46 通過；Server 65 通過。新增測試檔 ESLint 與 `git diff --check` 通過；此輪只增加測試及文件，未修改產品程式、重跑瀏覽器或全專案 typecheck。

## 本機實作與驗收

六批修改已在目前 checkout 實作，工作區原有的加購後關閉彈窗／保留瀏覽位置修改維持原狀。本次沒有將本機改動發布到公開場域。

- 付款：decision API 改為有界付款方式 ID，與 Main transport 一致；實際付款仍經目前 Menu／POS 的方法與階段驗證。
- 回覆與歷史：無工具的未知操作不能用模型文字宣告成功；已知操作必須有同輪對應工具結果，單純查購物車不能完成切換方式。服務 FAQ 與獨立問候保留正常回覆。JSON／SSE 的模型文字先存草稿，host 驗證後保存一次正式 assistant 回覆。
- 用餐方式：沿用真實按鈕的游標動畫，目標缺失不再靜默略過，動畫完成前不修改 cart。已進入未付款結帳時先建立一次性確認，確認後取消結帳、返回訂單再切換；付款鎖定仍不可切換。同一方式重申不重寫、不重放動畫。
- 菜單：完整 catalog 模式更新實際菜色，包含已看過品項；其他推薦釋放精確單品 query、排除剛看品項。保留飲食／食材排除，不把完整菜單縮成推薦的三項。`display:false` 的單品查詢也不再改動畫面。
- 快照：增加目前呈現品項與查詢範圍；Menu 等待 Vue 呈現 callback 完成後回傳結果，與完整 catalog、選餐草稿、cart lines 分開。
- 附和與發票：沒有可回答問題的獨立「好／嗯」保持安靜；「了解／謝謝」不啟動推薦或問候；合法待答問題的肯定仍保留原判斷流程。發票用既有 i18n 的簡潔問句，執行限制留在候選描述。

### 重現與驗證結果

新增預期行為測試先在修改前失敗，涵蓋付款 payload、無回執成功文字、fulfillment 完成驗證、單品到其他推薦／全部菜單、獨立附和與 data-only 查詢。另測一次性結帳返回確認、動畫失敗不寫入，以及真實 DOM 的菜色／選項／snapshot 對齊。

| 檢查 | 結果與紀錄 |
| --- | --- |
| Menu package Vitest | 733 通過，177 個選用測試跳過；`/tmp/field-menu-complete.log` |
| Kiosk package Vitest | 231 通過，48 個選用測試跳過；`/tmp/field-kiosk-complete.log` |
| Server decision domain 與 Kiosk HTTP routes | 482 通過，80 個選用測試跳過；`/tmp/field-server-suite2.log`。最後語意規則調整後的 domain 422 項再驗證通過，見 `/tmp/field-decisions-final.log` |
| Chrome 整合 | FieldState、OrderReviewFlow、KioskConversation、ServiceRecovery、CheckoutActions 共 21 通過；`/tmp/field-browser-final.log` |
| Package typecheck | Menu、Kiosk、Server 均通過；`/tmp/field-{menu,kiosk,server}-types-final.log` |
| Lint 與格式 | 本次修改的程式檔限定檢查通過；未跑 root lint/typecheck |
| Production build | Menu 與 Kiosk 通過；`/tmp/field-{menu,kiosk}-build.log` |

Chrome 使用主機已安裝的瀏覽器及隔離本機測試服務，沒有對正式站送出訂單或付款。agent-browser CLI 不支援其技能文件要求的 `skills get`，因此使用既有 Vitest Browser 工作流，沒有安裝或下載另一個瀏覽器。

上述結果驗證本機程式與人工情境，不代表已驗收真實模型對所有自然語句的分類、現場麥克風／回聲或正式 POS。下一個階段是以測試 session 驗收實際語音與既有瀏覽器狀態，再依部署流程發布。

本機原始證據僅保存於 0600 暫存檔，未放入版本庫：

- `/tmp/webnavior-20261022-api.log`
- `/tmp/webnavior-20261022-entries.json`
- `/tmp/webnavior-20261022-decisions.json`

Session ID 與 sequence 為上述資料庫快照的關聯鍵。25 個 session 不等於 25 位顧客，也不能排除操作測試；資料只支持上述具體案例與計數。

## 後續修正：多餐點需求與單選確認分離

使用者指定優先處理第一類問題。本機根因是 ADD 的多個命名餐點被當作同一 target 的替代候選，顧客看見「您指的是 A、B？」後回答「對」，高信心 route／relation 又可把它解成第一個候選。修正不以降低信心門檻或直接把全部候選加入購物車實現。

- 同句有多個不同的明確商品名稱／別名時，ADD 即使被錯選，也交接整句與所有已識別商品 ID；不建立單項釐清、不執行部分加購。商品共用同一店家別名或分類造成的真正歧義仍使用釐清。
- 單選問句明示「其中一項」，提示名稱／序號／取消。用既有 i18n 保存文案；序號解析增加「第 N 項」，保留原有「個／筆」。
- 共用的 bare-assent 規則只撤銷選擇權限，不產生商品或操作。Server 不把「對／是的／好／沒錯／yes」解成多候選的其中一項；仍使用既有 recipient 檢查，合格回答保留問題，背景／不明對象維持靜默或 unavailable。Menu 執行端獨立拒絕同一回合的猜測 index，保留 pending demand，讓後續明確選擇可繼續。單餐 Yes/No 確認與正常結帳同意不受這個多 target 邊界影響。
- 原本 opt-in 的集合肯定診斷轉為預設固定回歸；新增錯選 ADD 的原始多餐句、直接繞過 Server 的肯定回答、背景／不明對象、後續「第二項」及共用別名對照。測試先失敗再修正，見 `/tmp/collective-confirmation-before.log`。
- 現行 domain 會先阻擋多餐句，effect PoC 的 c09 fixture 因此改驗「模型推論前 DOMAIN_UNRESOLVED／NEEDS_ASSISTANT」；凍結的 MULTIPLE_REQUESTS 語意 gold、既有實驗結果與模型設定均未改動。

驗證：Menu 全套 748 通過／176 跳過；Kiosk 231 通過／48 跳過；Server decision domain 422 通過／80 跳過；Chrome FieldState／RequiredConfiguration／OrderReviewFlow 共 7 通過。Menu／Server package typecheck、修改檔案 ESLint 與 diff 檢查通過；未跑全專案 typecheck。紀錄：`/tmp/collective-{menu-final,server-suite,kiosk-suite,browser,menu-types-final,server-types,lint-clean}.log`。

其餘歷史問題未在這批修正。重新開啟 Menu 診斷後，ASR 名稱兩項、錯選 fresh 推薦一項仍失敗，見 `/tmp/collective-remaining-menu-diagnosis.log`；原集合肯定案例不再被跳過。本批保證上述明確邊界不發生部分寫入，尚未驗收真實模型是否完整接手、逐餐解析與完成全部多餐需求；沒有宣稱建立了所有需求的完成清單。未部署、commit、操作真實 POS 或呼叫真實模型。


## 場域實測版更新（2026-10-22 16:30）

使用者明確授權分批 commit，包含測試案例，並更新公開站供場域實測。本批提交：

- `6666541`：保留瀏覽位置並同步菜單、購物車與用餐方式，包含對應回歸測試。
- `1eaf6a4`：避免多候選誤選，依實際操作記錄點餐結果。
- `2ab99ec`：依操作回執回覆，拒絕未完成的成功宣告，包含 Chrome 畫面測試。
- `5795db6`：保存歷史對話節錄、逐需求 evaluator、離線控制及設定模型的 opt-in 測試與文件。

已部署上述版本至 <https://webnavior.aikcitri.qzz.io/>。更新前備份舊 Menu／Kiosk 與 PostgreSQL，dump 已用 pg_restore --list 驗證；備份、staged builds、驗證結果位於 `/tmp/webnavior-field-release-20261022-e7vo7dwm`，release.json 狀態為 deployed-verified。沒有 schema、Nginx、管理前端、Bridge 或模型設定變更；保留舊雜湊資源供既有頁面載入，index 最後替換。API 於 16:30:18 重啟，PID 4107684。

公開 Menu `index-CC4ZOIK-.js`、Kiosk `index-CLs9SjEN.js`，HTML 與直接連結的 2／44 項資源 SHA-256 全部吻合；API livez／readyz、DB／Redis、公開 `/menu-api/health` 及七項 catalog 正常。部署前 Menu 757、Kiosk 233、Server 482 項測試與 Chrome FieldState 2 項通過；本次依提交規範執行一次全專案 typecheck 並通過。修改檔 lint、建置及 diff 檢查通過；全專案 lint 仍有既存 2,370 項錯誤，未擴大修復。

模型八例 smoke pilot 的狀態檢查 7 通過／1 失敗，詳見 [多需求測試設計與結果](2026-10-22-kiosk-multi-demand-evaluation.md)。混合加購＋詢價未修好；多品項與裸肯定仍有 Jev 原始誤判，Application 保護不能當語意理解成功。已提交的測試保留這些限制，未重試或降低門檻把結果改成全綠。此次部署驗證不包含現場語音、付款或正式 POS 驗收。場域端重新載入 Kiosk 頁面後開始實測。

### 2026-11-23 正式 PB 現場案例回放

| 現場紀錄 | 例行回放與驗收 |
| --- | --- |
| 購物車已導航但沒有核對回覆（11/20 seq548、11/23 購物車與延遲調查）。短語音診斷沒有保存原始 ASR 回覆。 | `fieldRegression.test.ts` 用合成短句「對」重建重疊時序。確認換頁後顯示餐點與核對問題、下一句排隊一次且確實進發票步驟。 |
| 送單結果格式不符（11/23 seq698–708），後續付款頁只有原生狀態讀取。 | `fieldRegression.test.ts` 先重現 Main 回合完成時把待確認回執蓋成一般查詢回覆，再驗證原始提示獲保留。換頁後只讀訂單，保留 LINE Pay 與信用卡指引。 |
| 口說七碼統編（11/23 seq462）。 | `browserOrderingTools.test.ts` 使用合成七碼與補報一碼，保留前導零，明確確認後只填一次。 |

三案隨 Kiosk 預設 `test:run` 執行。採用紀錄中的事件順序，替換購物車、統編及訂單識別碼。短語音從已產生逐字稿開始，未驗證麥克風或 ASR 是否會漏收。送單與付款使用離線回執，未執行實際交易。

使用者在同一正式 PB 結帳分頁手點後，畫面仍在 Order/Create。彈窗消失後結帳頁仍顯示「目前非營業時間，暫時無法點餐。」。這與菜單上的營業公告是不同訊息。隔離回放以此可見文字作為拒單結果，在派送前已出現、初次點按後出現、最後確認後出現三種時序都停止等候；只在確認後的明確拒單解除該次由 adapter 建立的送單待查標記。確認憑證仍一次性，無可見拒單且未取得結果時保留原本防重送。此修正需要更新 Electron 原生 PB 介接層與前端，尚未部署。

複合句「對 然後我還要再蛋花湯」補回放。現場 seq100 與 seq114 的公開加餐參數相同，均為周氏水餃一份、蛋花湯一份。第一次伺服器已認領計畫，Kiosk 的派送前資料檢查拒絕，未加餐。舊回執把不同失敗包在同一句說明，無法追出是哪個欄位。例行回放重建菜單、購物車及上一個推薦問題，固定模型分流及授權回覆。新版 Kiosk 執行器在穩定資料下一次成功，主機端觀測順序是讀狀態一次、加水餃一次、加蛋花湯一次，第二品沿用第一品的完整購物車回執。模擬的是原生回執，沒有真 PB 網路耗時。另加入具體拒絕原因，測試價格、規格與購物車版本不同時均在派送前拒絕。

RC6 後顧客回報購物車確實增加，但 Agent 顯示「結果尚未確認」。本機可讀的 RC6 發布後紀錄尚未對到該筆精確回執。程式確認有可重現的缺口：原生加餐已讀到符合目標份數的明細，協調器仍讀第二次；第二次若失敗，將整筆標為不明。回歸先重現、再讓協調器對原生加餐已取得的同一份完整明細做整車核對，不重讀同一份資料。保留真正未取得明細時的防重送。修改在 Electron PB 介接層，需配套 EXE 更新後實機複驗。

### 2026-11-23 PB 資料傳遞與送單回應交接

使用者在受監看的獨立 Chrome 視窗手動操作正式 PB。以下是該次非營業拒單的實際網路順序，時間為台北時間。

| 時間 | 實際事件 |
| --- | --- |
| 20:11:01.087 | 送單前讀取結帳頁，GET 回 `200`，頁面為 `Order/Create`，未帶 `diningTime` 或 `order` 錯誤。 |
| 20:11:11.987–20:11:12.060 | 按確認後發出一次送單 POST，PB 回 `302`。 |
| 20:11:12.192 | 重新導向的 GET 回 `200`，仍為 `Order/Create`。`props.errors.diningTime` 帶回「目前非營業時間，暫時無法點餐。」 |
| 20:11:12.226 | 結帳頁顯示相同提示。 |

這筆已確認在後端拒單。送單後的 `302` 和重新導向的 `200` 都不能單獨證明收單。現有本機修正辨識網頁上的非營業文字，直接承接重新導向回應的資料仍待實作。

現場優先情境是顧客送單時有餐點缺貨，Kiosk 應呈現 PB 給這次送單的原因，讓顧客能改餐。非營業時間是測試時取得的已知拒單樣本，可先用來驗證回應是否漏接。缺貨是否走相同路徑、使用哪個欄位，以及訊息是否指出品項，仍須以正式缺貨樣本核對。

| 順序 | 調整與驗收 |
| --- | --- |
| 1. 承接送單結果 | 從同一次送單及其重新導向取得結果，將回應綁定當次送單，避免拿舊錯誤判定新請求。用本次實測順序做回歸，確認只送一次，收到 `props.errors.diningTime` 明確拒單就顯示 PB 原文並結束等待。畫面文字可作備用。先從既有回應取得資料，避免為了驗證相同結果再發請求。 |
| 2. 售完、其他拒單與成功 | PB 前端也讀取 `order` 錯誤，但售完的欄位與重新導向方式未驗證。若回應明確拒單，顯示原文、保留購物車，讓顧客改餐。若無法確認收單，保留待確認並避免自動重送。成功以同一次流程帶回的訂單識別及狀態確認，付款結果另由付款流程確認。將首筆成功與售完的實際回應補進回歸測試。 |
| 3. 傳遞購物車明細 | 改份數、刪除、清空後沿用已核對的資料。多列調整保留各次改動後的核對，最後一份明細直接做回執。改份數或刪除前，找目標與驗購物車版本共用同一份適用的明細。回菜單、準備結帳、填統編／電話／捐贈欄位等，操作中已有明細就隨結果回傳，欄位結果以實際表單值核對。單次加餐的同類修正已在本機通過回歸，尚未部署。 |
| 4. 結帳邀請 | 先顯示已加餐。邀請若仍需驗購物車版本，只讀購物車。邀請的讀取失敗時略過邀請，保留成功回覆。 |
| 5. 菜單及規格 | Main 與中斷恢復共用一份操作前資料。同一接待沿用已查品項，水餃等有選項的品項按需查規格，避免找到品項後為了讀規格再掃所有分類。重新接待、清空購物車或取餐時段變更時清除規格快取，PB 回報品項變更時更新該品項。是否售完由 PB 判斷。回放需量顧客講完到畫面第一次動作的時間，以及畫面更新到回覆出現的時間。 |

目前沒有已確認的現場案例顯示點按後第一次成功讀回的購物車仍是舊的、稍後才更新。這輪不調整等待上限，也不追查 PB 是否限流。先處理已確認的資料漏接與重讀。

主要接手位置為 `packages/stage-ui/src/services/pbCheckout.ts`、`pbBrowserService.ts`、`pbCart.ts`、`pbCatalog.ts`，以及 `apps/stage-kiosk/src/services/checkoutInvitation.ts`、`browserCartTask.ts` 和 `apps/stage-kiosk/src/components/KioskScene.vue`。送單回應需在 Electron 的正式 PB 流程驗收。本次交接未改程式、未重新打包或部署。

### 2026-11-24 正式 PB 信用卡入口後的付款選項

現場操作人員回報，在 PB 選「信用卡」進入綠界付款頁後，畫面提供三種選項：自行輸入信用卡卡號、Apple Pay、綠界 Pay。目前新版 Kiosk 的語音操作到 PB 第一層的 LINE Pay 或信用卡入口為止，綠界頁內三種選項由顧客手動操作。隔離 Electron 測試記錄了入口跳轉，這三種選項來自現場回報，尚無當次正式畫面的截圖或錄影佐證。

2026-11-24 已在開發機 Electron 的正式綠界頁，沿用既有 PB 訂單實測。先選「Apple Pay」，頁面顯示「Apple Pay 僅支援一次付清付款」，再點一次 Apple Pay 付款按鈕，畫面出現 Apple 的「使用 iPhone 掃描行動條碼」，提示使用 iOS 18 或以上版本的相機繼續。實測停在掃碼頁，未操作手機授權。這次由測試工具點選，Windows Kiosk 語音操作仍待實作及驗收。

同日以同一張待付款 PB 訂單在開發機 Electron 補驗其餘三種方式。綠界「信用卡」顯示卡號、有效期限、安全碼及 3D 驗證說明；「綠界Pay」顯示掃碼快速付款或下載 App，以及登入、掃描付款碼、選擇付款方式三步。回 PB 選 LINE Pay 後到達 web-pay.line.me，顯示 LINE 帳號登入與行動條碼掃描兩個入口。此次驗收到顧客看得到操作畫面為止，未輸入卡片資料、登入或完成付款。

開發版已接入綠界頁內的語音選擇。PB 可接收單一明確方式，跨頁時核對原訂單，綠界頁也能直接接收口述。Electron 只在該筆訂單進入指定綠界收銀台後開放固定選項。隔離測試涵蓋三種顯示、Apple Pay 入口防重複及訂單或頁面版本不符時拒絕。原正式訂單已逾期，更新後的 Windows 麥克風端到端驗收需使用新的待付款訂單。

付款切換與詢問已加入開發版。「換付款方式」先詢問目標，明確指定才切換。跨金流回同一張 PB 訂單，重新核對待付款才開另一入口。詢問其他支付方式或一卡通只回覆可用方式。隔離 Electron 已驗證 LINE Pay 與綠界雙向切換、逾期拒絕；本輪未連線測試正式金流。
