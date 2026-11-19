# PB 非營業時間點餐測試站

這是[指定周氏蝦捲內用頁](https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table)
的隔離模擬環境。使用原站公開菜單快照、原有 PB 執行器需要的 DOM 與唯讀 API 格式，
供非營業時間繼續測試。2026-11-16 已依實站購物車編輯畫面對齊加量選項「水餃1顆」（每顆8元）；基本一份8顆，10顆是一份加量2顆。所有加入購物車、送單、付款與發票都是本機測試，不連回商家。


頁面頂部常駐「自建測試環境｜非商家正式網站」橫幅，菜單、購物車與結帳捲動後仍可見；頁首與封面也明示測試站。只保留執行器需要的控制項結構與資料格式，不把測試頁當作商家正式頁面或實單證據。
## 啟動與使用

從 checkout 根目錄執行：

```bash
./test-sites/pb-order-lab/start.sh
```

開啟 <http://127.0.0.1:5188/>，保持程序執行。預設只監聽 loopback；停止時在執行終端按
Ctrl+C。此站已納入 pnpm workspace，使用自己的 Vite／Vitest 與既有 uuid 套件。
不是純靜態頁：`vite.config.js` 裡的模擬 API middleware 必須一起啟動。

### 不同電腦／不同地點測試

公開入口為 <https://webnavior.aikcitri.qzz.io/pb-test/>。2026-11-17 已確認網域路由生效，
並從實際 HTTPS 入口完成選 A1 桌、加魚丸湯、模擬送單／付款與重載保留驗證；
頁面內建 PB 執行器相容測試的九項讀取、搜尋、加減改餐與原購物車保留檢查亦通過。
公開服務只供應建置檔，不公開 Vite 原始碼入口；Windows EXE 實機仍需另外驗收。

Kiosk 的自建點餐網站應設定為
`https://webnavior.aikcitri.qzz.io/order/store/1kgJeql/internal_use/menu/select-table`，
不是 `/pb-test/`。共用測試場域發布版本 38 已包含此網址；EXE 關閉重開後核對所選網站，
若仍顯示 `127.0.0.1:5188`，需檢查該設備的發布版本。可攜包不會啟動本機測試站；
loopback 網址只有在該台 Windows 已啟動 TestSite 或 SSH 通道時才適用。

建置與預覽：

```bash
PB_LAB_BASE=/pb-test/ PB_LAB_ORIGIN=https://webnavior.aikcitri.qzz.io pnpm -F @proj-airi/pb-order-lab build
./test-sites/pb-order-lab/public.sh
```

`public.sh` 只監聽 `127.0.0.1:5198`，經既有 HTTPS 網域代理。
`public.nginx.conf` 是同一 server block 的路由片段；只代理 `/pb-test/`、指定商家的
模擬點餐／模擬付款與 `/test/orders`，不替換既有 `/kiosk/`、`/api/` 或管理後台。
`PB_LAB_DIST` 可指定已凍結的建置目錄。正式啟用使用獨立 user service
`webnavior-pb-public-site.service`；重新啟動它會清掉此公開模擬程序的記憶體資料。
本機 5188 模擬程序與公開 5198 的 session 分開。

每個瀏覽器各有測試 session，不能跨電腦接續同一筆購物車；同瀏覽器重載保留資料，
同 profile 的分頁共用 session 並有版本衝突保護。重要結果請匯出 JSON。
可測選桌、搜尋、加減改餐、發票、通知資料、模擬送單及模擬付款；不需安裝 Kiosk EXE。
此入口提供 PB 網頁及執行器相容檢查，沒有另外內建 AI／語音 Kiosk。

### 網頁版 Kiosk 備援

公開測試站現在可嵌入同來源的 `https://webnavior.aikcitri.qzz.io/kiosk/`，
由既有 Eventa 通訊呼叫相同 PB 執行器；請在 Kiosk 設備設定選自建站。
橋接只接受核准 Kiosk 的 parent window 與 origin，並保留文件／operation journal 核對。
單獨開測試站不啟動橋接，既有手動操作及頁內相容測試照常使用。

這項備援不支援正式 PB 網站。普通瀏覽器請使用公開 HTTPS Kiosk；
Tailscale HTTP 入口沒有 EXE 的安全來源特例，跨站 iframe 也不能沿用模擬站的
Strict cookie。EXE 的 Tailscale 與公開入口都仍走 native View，不使用此網頁橋接。

若只需區網手動測試，可明確指定來源及監聽介面：

```bash
PB_LAB_ORIGIN=http://192.168.8.52:5188 PB_LAB_HOST=0.0.0.0 ./test-sites/pb-order-lab/start.sh
```

其他電腦的手動頁面 ID 使用 uuid，不依賴 HTTP 下不可用的 `crypto.randomUUID()`。
執行器相容檢查及 Kiosk 整合請使用 HTTPS 公開入口或原 loopback；不把任意區網 origin
加入原生執行器允許清單。

可手動測試選桌 → 開始點餐 → 搜尋／分類 → 商品／份數／加量／備註 → 購物車 →
發票 → 送出測試訂單 → 模擬付款 → 完成頁／JSON 匯出。通知可填
`tester@example.test` 或 `0912345678`；請只使用假資料。

「測試工具 → 執行現有 PB 執行器相容測試」會直接載入專案的 `createPbService`，
走原本的 discovery/execution 契約、資料讀取、DOM 控制及結果核對；不使用
`data-testid` 定位，也不 mock 控制器。它新增一行有唯一測試備註的水餃，改份數，
再用原來的刪除控制移除，核對先前餐點與金額仍一致；不送出訂單或付款。
跑完請重新整理再測，讓文件、服務生命週期與元件 ID 重新建立。未完成時應先看
測試報告與購物車，不盲目重跑；「重設」需確認，只清除此瀏覽器的模擬資料及本
模擬站的 unknown-write 標記，不能用於清除正式站的未決狀態。

## 與原環境對齊的範圍

- 11 個桌位：櫃台取餐、A1–A3 桌、B1–B7 吧檯；桌號清單使用 `role=combobox`、
  `aria-controls`、`role=option` 與 `.el-select__placeholder`。
- 13 項商品，使用原站 numeric product/category/attribute IDs；本機卡片別名只供
  手動測試工具定位。商品 `h4`、外層按鈕、詳細對話框及 `.product-item` 選項結構
  對齊既有執行器。圖示使用 Iconify 的 `ep`（Element Plus）圖庫，存成本機檔案。
- `.dialog-footer` 中的份數輸入與唯一加入按鈕、原站備註 `input` 的 placeholder。
- 商品份數、加量與購物車加減使用 `.el-input-number` 與具名 span 控制項。
  依 [Element Plus repeat-click](https://github.com/element-plus/element-plus/blob/dev/packages/directives/repeat-click/index.ts)
  事件契約，由左鍵 `mousedown` 立即增減、`mouseup` 停止；長按先等600ms，
  再每100ms增減。單獨 `.click()` 不改數量，Enter 可操作；最小／最大值以
  `aria-disabled` 與 `is-disabled` 表示。視窗／路由移除、失焦或頁面隱藏會終止長按。
  商品草稿的合計於microtask更新；購物車該行輸入與控制項則在真實模擬API寫入期間
  禁用，回應後重新渲染，不以固定延遲冒充網路完成。這是事件與同步邊界模型，
  尚未證明商家目前部署版本、完整載入遮罩或所有更新時序與本機完全一致。
- 購物車 `.order-create .produce-item` 的名稱／單價／份數、選項／備註與
  編輯／刪除兩顆 `button.is-circle` 控制；原生移除使用份數 0，避免混淆兩顆按鈕。刪除最後一行仍保留 draft order context，避免原有
  核對器誤判為別人的購物車。
- 五種發票選項、原站 radio 值、載具／憑證欄位位於所選 `.el-radio` 之內，讓既有
  scanner adapter 可接管。Enter 不送單；通知手機或 Email 擇一。只做本地格式檢查。
- `data-page` 的 Inertia 版本／component／props、Ziggy route declaration、
  `menu-categories`、`menu-category-items`、`getAttrByProduct/:id` 及 menu/cart
  partial GET 回應。這些只提供本機模擬讀取；商家寫入 API 回傳 405。

`browser_state_get` regression coverage uses the production PB adapter in Chromium:
all five invoice choices, manual invalid/valid entry, and contact readiness read
back from actual DOM; pending/paid/cancelled order snapshots use fresh matched
Inertia reads. Failed/uncertain payment attempts remain `unknown` when the PB-shaped
record does not prove a final result. Result-page cart writes are rejected. The
browser bridge test also manually submits a TEST order and reads payment state
through the parent Kiosk client. These tests do not contact merchant/payment APIs.

`quantityControls.test.js` verifies that click-only automation cannot pass the
fixture, a native press counts once, Enter and held presses respect release and
dialog removal, and cart controls remain disabled while an intercepted real
fixture write is pending. It also runs the production PB executor through bentos
2/260 → 3/390 → 1/130 → 2/260 and closes an open product before cart review.
Run against the local Vite fixture only:

```bash
PB_LAB_URL=http://127.0.0.1:5188 VITEST_BROWSER_CHANNEL=chrome pnpm -F @proj-airi/pb-order-lab exec vitest run quantityControls.test.js
```

`VITEST_BROWSER_CHANNEL=chrome` selects an installed Chrome; omit it to use
Playwright's installed Chromium. The tests create independent browser sessions
and do not submit orders. The public test site and native PB payload must be
released together: an old click-only EXE will intentionally fail these controls.

`nativeCheckout.test.js` also imports the production Kiosk dialogue/cart workflow
in Chromium. It checks donation entry, invalid-code guidance, manual cart edits,
contact continuation after **好了**, and renewal of a stale native confirmation
without creating an order. Changed final fields require another summary. This
is a deterministic Host/native regression, not a live Jev/Main or speech test.

Result-page restart regressions call the production Host reset with native
state-only descriptors. They check repeated unpaid refusals, manual payment or
abandonment followed by entry reload and a new cart, preservation of the old
order, and an unknown payment or persisted order barrier surviving reload.
These verify Host decisions/native facts; the entry navigation is driven by the
test, with visitor retirement/reload sequencing covered by Kiosk lifecycle units.
The fixture's standalone order-history controls are separate from Host Restart.

水餃基本每份 8 顆／64 元，可額外加 0–100 顆，每顆 8 元；份數與加顆分開計價。
原站只有雞腿／排骨兩張商品照片，照片、封面與標誌都已複製到本機。

資料來源為 `vendorCatalog.json`，目前版號 `pb-1kgJeql-2026-11-15-v5`。菜單快照沿用v3；
v4修正送出後的草稿生命週期：已送出的訂單保留在orders，不再當作下一位空購物車的
草稿；新加入餐點才建立新的草稿身份。商家後續API欄位與未驗證範圍見
[結帳及資料保存規劃](../../docs/plans/2026-10-28-windows-kiosk-electron.md)。此前再核對
公開 API 時，原站已把套餐分成第三類，A 套餐 136 元、B 套餐 150 元；與較早
畫面看到的 116／128 元不同。以此版快照為準，不在每次載入時跟隨原站更新。
更新 fixture 時必須更新版號，避免不同菜單版本的測試結果混在一起。

11/15 已用實際商家訂單核對送單後的 `Order/ChoosePayment`（待付款20）與
LINE Pay 付款後 `Order/Show`（接單製作50），包含取餐編號、付款方式、餐點明細、
通知及發票業務欄位。v5 使用相同 `/orders/{hash}/choosePayment` 路由，
訂單 hash 與畫面編號分開；付款成功不再直接當成餐點完成70。
唯讀 Inertia 回應補上 `order/details/invoices/times/actions`、通知手機／信箱及
發票類型與輸入值；未選用的專用欄位為 null。原始真實資料不放進版本庫，
本機只產生 TEST 訂單與發票，沒有任何認證權杖。

付款入口沿用商家 `/order/linepay/redirect/{hash}/LinePay` 及
`/order/ecpay/redirect/{hash}/Credit` 的本機路徑；之後呈現本機模擬授權，
可選成功、失敗、取消或結果不明。真實LINE Pay每次跳轉未完整捕捉，
信用卡、商家退款、未付款取消79亦尚未取得實際訂單樣本。
放棄付款的確認步驟依同版公開前端復刻；未付款取消不同於付款嘗試取消或退款。
不連金流、不寄通知、不開發票，不是原站所有後端及所有分支的等價承諾。

本機會話資料格式升為2、sessionStorage使用 `pb-order-lab:v2`；舊格式不遷移，
請以新的測試接待／瀏覽器設定檔驗證。舊v1備份不會被自動覆寫或刪除。

## 2026-11-14 營業期間實站行為比對

以同一瀏覽器分別操作指定實站與本機站，沒有送出商家訂單。商品資料快照仍是
11 月 13 日的 13 項，當日畫面核對品名、價格及說明一致；v3 更新的是互動行為。

| 流程 | 實站觀察與本機修正 |
| --- | --- |
| 選桌 | 11 個選項；每次進入預設櫃台取餐。下拉選擇先保留於畫面，開始點餐才提交所選桌位；選桌頁不公開先前購物車資料。 |
| 分類／搜尋 | 分類是捲到該區，不隱藏其他餐點；總覽是分類清單。搜尋跨全部分類及商品說明，只保留有結果的分類；清空搜尋恢復全部餐點。 |
| 水餃 | 每份基本 8 顆 64 元，另加 2 顆後一份 80 元、兩份 160 元；同配置重複手動加入仍是兩列。 |
| 修改購物車 | 修改份數保留配置、備註及原列；0 份移除該列。修改加量更新原列；加量 1 顆顯示「水餃」，2 顆顯示「水餃 X2」。 |
| 份數／備註 | 商品份數欄位 min=1，購物車 min=0，兩者 max=9007199254740991；移除本機額外的 99 上限。實站 235 字元商品備註已加入並回讀，移除本機 200 字元欄位限制及靜默截斷。極端份數的商家後端上限未驗證；本機仍拒絕無法精確計算的金額，AI 工具限制未放寬。 |
| 結帳欄位 | 在同頁修改購物車保留欄位；離開後重新進入，發票方式、載具、通知與訂單備註重設。發票 radio 原始值為無載具 5／憑證 2／手機載具 3／統編 4／捐贈 6。 |
| 清空 | 留在空購物車頁，仍有 draft 訂單資料，不自動回到選桌。 |

這些是逐項操作與資料核對，**不是整站等價證明**。實站網路延遲、處理遮罩、滾動時
自動切換分類、瀏覽器返回快取、跨裝置／商家 cookie、斷線與逾時等競態，不能由本機
的簡化流程代替驗收。實站的初始空選單載入狀態也確實存在，本機較快載入不能證明
Host 已處理完實站載入競態。11/15已補核對一筆LINE Pay付款後的訂單與發票；其他金流、退款、通知行為與最終送達仍未
比對，只能在本機測模擬分支；切換環境必須開始新接待，不能沿用原有文件或工具綁定。

## 隨機 ID、瀏覽器與時間

原站 `el-id-*`、Vue `data-v-*`、建置雜湊屬於渲染／資產識別，不是商品身份。
本機桌號 input/list 的 ID 每次重新載入會換一組，保留 `aria-controls` 的對應關係。
現有 PB 執行器以角色、語意結構、欄位 placeholder、商品／規格 ID 及即時回讀定位，
不硬編碼那組隨機 ID。可變外觀工具另外加入隨機 class 和 `data-render-id`，不改動
必要的語意 class。

測試不檢查營業時間；用固定可點餐日期／時段讓同一輪 cart context 穩定，訂單與
付款時間仍記錄實際 UTC ISO 時間，畫面顯示台北時間。固定快照能隔離原站更新，
不能保證原站將來修改 DOM／欄位／API 時仍相容。若正式站更動，需重新擷取並核對。
目前瀏覽器操作驗證為 Chromium；未宣稱 Firefox／Safari 或完整 Electron/語音驗收。

## Kiosk 使用界線

`readPbJourney` 明確允許本機 `http://127.0.0.1:5188` 與公開
`https://webnavior.aikcitri.qzz.io` 的 `1kgJeql/internal_use` table/menu/cart 頁。
不允許其他 port、商家或 localhost 別名，也不容許從商家正式站既有 binding 跳到
測試站。既有 EXE 內的原生執行器不會因網頁發布而更新允許清單；若要由 Kiosk
操作此新公開站，仍須另行建置並換用包含此契約的原生包。

若要讓現有 Electron Kiosk 使用它，需在**測試互動體驗**設定上述選桌 URL，並
重新建置／載入含新版 shared journey 與 PB service 的測試版 Electron。此修改
未發布 profile、修改現場設備設定，亦未重啟既有正式／隔離 Kiosk。瀏覽器內的
原執行器相容檢查，不等同模型、語音、硬體及完整 Electron 端到端驗收。

## 訂單資料與生命週期

`window.pbTest.version`、`getCatalog()`、`getState()`、`getOrders()` 回傳快照複本。
完成頁可看／匯出 JSON，欄位包含 `orderId`、`items`、`total`、`table`、`createdAt`、
`invoice`、`status`、`payment.{method,status,amount,paidAt,attemptId}`。同文件會發出
`pb-test:order-submitted`／`pb-test:payment-updated`；這不是跨視窗 IPC 或可重播事件
匯流排。需要歷史結果時讀 `getOrders()`。

server 以 HttpOnly 測試 cookie 隔離不同瀏覽器 profile；同 profile 的分頁共用
模擬 session。每次 UI 寫入帶 expected revision；其他分頁更新後，過時頁面寫入會
被拒絕，需重新整理核對，不會靜默蓋掉另一分頁的資料。

server session 在程序記憶體內；24 小時未使用才淘汰。`sessionStorage` 是每個分頁
的重新整理／server 重啟備份，只能初始化尚未建立的 server session，不能覆蓋已有
session。重要結果先匯出；關閉分頁、清除瀏覽器資料或換 profile 都可能遺失備份。
JSON 包含測試填寫的通知及發票值，請只填假資料。

同 checkout key 重複送單回傳原訂單；付款成功或結果不明不能再次模擬扣款；失敗／
取消可在同張單重試。結果不明不代表已付款或未付款，不會自動重送。

## 驗證

```bash
pnpm exec vitest run --config vitest.config.js --root test-sites/pb-order-lab
pnpm -C packages/stage-shared exec vitest run --config vitest.config.ts src/pbJourney.test.ts
PB_LAB_URL=http://127.0.0.1:5188 pnpm exec vitest run --config vitest.config.js --root test-sites/pb-order-lab
node --check test-sites/pb-order-lab/app.js
```

17 項 fixture/model/protocol、3 項 opt-in 本機 HTTP 整合測試。protocol 測試直接用原有
catalog、cart、route parser，不重寫解析器。瀏覽器相容測試直接使用原 PB 執行器，
涵蓋換 ID 後的選桌、搜尋、加量、加入、改份數、icon 刪除與金額核對。
另經實際手動 DOM 加入建立兩列完全相同的加量水餃，使用原生執行器部分換餐，
核對留下的水餃加量及測試後原有購物車／金額不變；不以直接修改測試state代替操作。
未執行全專案 typecheck；沒有 commit 或部署。

原生重開回歸測試 `nativeReset.test.js` 隨上述 `PB_LAB_URL` 整合測試執行，只接受精確的本機5188網址。使用獨立Chromium驗證空／非空購物車的舊待確認紀錄、清空前失敗可再試、已派送但結果不明即使重新載入仍持續攔截，以及送單待確認紀錄不得被重開解除。它不操作商家或操作者登入。

`nativeCheckout.test.js` uses the same opt-in `PB_LAB_URL` boundary and separate
Chromium sessions. It checks that passive speech cues preserve checkout/search,
explicit product presentation can still reveal cards, and all five invoice
methods survive a focused-field cart quantity edit. It validates notification
input, total and a final local confirmation token without submitting an order.

送出前另有與 PB 實站核對過的「確認訂單」視窗：取消不建立訂單，確定才寫入本機
測試訂單。原生執行器在第二個按鈕前再次核對資料，開視窗本身不算送單。
