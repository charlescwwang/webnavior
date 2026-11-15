# PB 非營業時間點餐測試站

這是[指定周氏蝦捲內用頁](https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table)
的本機模擬環境。使用原站公開菜單快照、原有 PB 執行器需要的 DOM 與唯讀 API 格式，
供非營業時間繼續測試。所有加入購物車、送單、付款與發票都是本機測試，不連回商家。

## 啟動與使用

從 checkout 根目錄執行：

```bash
./test-sites/pb-order-lab/start.sh
```

開啟 <http://127.0.0.1:5188/>，保持程序執行。只監聽 loopback；停止時在執行終端按
Ctrl+C。不安裝新套件，沿用此專案已安裝的 Order Menu Vite。不是靜態檔案伺服器：
`vite.config.js` 裡的模擬 API middleware 必須一起啟動。

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
- 購物車 `.order-create .produce-item` 的名稱／單價／份數、選項／備註與
  `button.is-circle` 刪除控制。刪除最後一行仍保留 draft order context，避免原有
  核對器誤判為別人的購物車。
- 五種發票選項、原站 radio 值、載具／憑證欄位位於所選 `.el-radio` 之內，讓既有
  scanner adapter 可接管。Enter 不送單；通知手機或 Email 擇一。只做本地格式檢查。
- `data-page` 的 Inertia 版本／component／props、Ziggy route declaration、
  `menu-categories`、`menu-category-items`、`getAttrByProduct/:id` 及 menu/cart
  partial GET 回應。這些只提供本機模擬讀取；商家寫入 API 回傳 405。

水餃基本每份 8 顆／64 元，可額外加 0–100 顆，每顆 8 元；份數與加顆分開計價。
原站只有雞腿／排骨兩張商品照片，照片、封面與標誌都已複製到本機。

資料來源為 `vendorCatalog.json`，目前版號 `pb-1kgJeql-2026-11-15-v4`。菜單快照沿用v3；
v4修正送出後的草稿生命週期：已送出的訂單保留在orders，不再當作下一位空購物車的
草稿；新加入餐點才建立新的草稿身份。商家後續API欄位與未驗證範圍見
[結帳及資料保存規劃](../../docs/plans/2026-10-28-windows-kiosk-electron.md)。此前再核對
公開 API 時，原站已把套餐分成第三類，A 套餐 136 元、B 套餐 150 元；與較早
畫面看到的 116／128 元不同。以此版快照為準，不在每次載入時跟隨原站更新。
更新 fixture 時必須更新版號，避免不同菜單版本的測試結果混在一起。

原站付款及完成頁需要先送正式訂單才能查看，本次未送正式訂單，因此這兩個階段
仍是明確標示的模擬流程。LINE Pay／信用卡可選成功、失敗、取消或結果不明，
不使用真實登入、卡號、發票驗證、付款 callback、POS 或商家訂單 API。
不是原站全後端、逐像素還原或所有瀏覽器版本的相容承諾。

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
Host 已處理完實站載入競態。完成頁、付款、正式通知／發票及送出訂單後的狀態仍未
比對，只能在本機測模擬流程；切換環境必須開始新接待，不能沿用原有文件或工具綁定。

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

`readPbJourney` 已加入唯一明確的本機測試 origin：`http://127.0.0.1:5188`，限
`1kgJeql/internal_use` 的 table/menu/cart 頁，不允許其他 port、商家、localhost
別名，也不容許從正式站的既有 binding 跳到測試站。沒有放寬成任意 origin。

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
