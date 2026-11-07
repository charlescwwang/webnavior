# Webnavior／PB：實際 Kiosk 整合驗證

日期：2026-10-29。店家：<https://app.esgpb.com/order/store/1kgJeql/pick_up/menu>。

## Oct30 零安裝接入查證：尚未完成正式串接

使用者要求 iframe 保留 PB 原網址，且一般 Kiosk 不安裝套件、不使用本機控制器。
下文原型成功案例均有控制器協助，不能視為這個使用方式已完成。

新增 `scripts/inspectPbClientCapabilities.mjs` 可在真正本機 Kiosk、1080×1920、
已安裝 Firefox159、空白會話中重現差距，不注入 PB peer、不搬移登入或操作購物車。
它透過正常開發 UI 註冊測試設備；測試設備紀錄會保留。
結果存於 `output/playwright/pb-client-capabilities/report.json`。

- iframe 仍是原 PB URL，父頁讀取 child document 得到 `SecurityError`。
- 使用實際 client 公開 factory 對同一可見 iframe 發送 discovery，五秒內未收到
  有效握手，工具清單為空。另建 discovery lifetime 是為了把站點握手與 Kiosk
  自身的切換／撤銷區分；不是安裝另一個 PB 接收端。初版直接觀察 UI singleton
  曾被頁面生命週期撤銷，該結果已標為不確定，未拿來判定 PB 不支援。
- PB 公開資產確實包含 `xorder:menuReady`、`xorder:actionResult`、
  `xorder:searchProduct` 及聊天整合邏輯，不能說原站完全沒有控制介面。
  靜態接收器會分派搜尋／開品項等事件，結果發送對象是其內部 `chatFrame`。
  從 Kiosk 父頁送原生 `search_product` 後，此次未登入頁的搜尋欄未變，
  父頁未收到回執；程式資產存在不等於該功能在此店家／此狀態已啟用。
- 後續已完成登入後測試：使用者於專用 Firefox 手動登入，第一方菜單核對為
  authenticated；原站測試程序結束並釋放 Profile 後，重新執行
  `node scripts/inspectPbClientCapabilities.mjs --retained-profile`。
  第一方與實際 Kiosk PB iframe 均 authenticated=true，沿用既有3種核准 Cookie
  準備及 scoped storage policy，但沒有注入 PB peer。既有 discovery 仍逾時空工具，
  `search_product` 仍無搜尋欄效果／父頁回執，且沒有掛載 `chatFrame`／eventData。
  因此本店目前登入狀態也不能以此原生介面實作完整點餐；這不排除 PB 另有未公開
  合作介面或須商家啟用的功能。受控 Profile 的 Cookie 配置也不是零配置相容證據。
  本次店家請求全為 GET／HEAD，未改購物車、送單或付款。結果見
  `output/playwright/pb-retained-capabilities/report.json`；程序 exit0。

歷史 commit `953831e` 的一般瀏覽器接法是在**自有 Menu** 安裝 window-message
接收端；`cb48ac0` 的舊 WebMCP 檢查也修改自有 Menu。已讀的 computer-use-mcp
外站通道依賴 extension／CDP。使用者後續已提供同事 0.22.5 的重建部署 Word
文件與 Skill；成功案例是在同事自己的專案，不需再查本專案分支定位。
該文件第02、04–07節及架構圖明確採用 FastAPI→Playwright→既有偵錯 Edge
CDP9222→同一 iframe，使用者手動管理本機 API7002／Edge／Ollama。
一般未連入該 CDP 的瀏覽器不在控制範圍；文件也明載本機單一環境與公開多客
使用須另設認證、隔離與瀏覽器分配。因此它證明同事可操作原 PB iframe，
不能證明任意未設定 Kiosk 開網址即能控制。核對及重用邊界見現有整合計畫。
附件的重建／安裝／送單內容是參考資料，沒有當成此專案的執行授權。

## 使用的是真正 Kiosk

使用本機 `apps/stage-kiosk`（`http://localhost:5169/kiosk/#/`）、既有 Server、設備註冊、Admin 草稿／發布、模擬 ASR 輸入、Server Main Agent、工具回執與對話紀錄。Chrome viewport 固定 1080 × 1920。沒有另外架設 iframe fixture，沒有 mock LLM 回答，也沒有假造自家 Menu／POS 情境。

目前是開發原型：`scripts/tryWebnaviorPbPrototype.mjs` 啟動獨立 Chrome，或以 `--firefox` 啟動已安裝的 Firefox，將 `packages/stage-ui/src/services/pbBrowserBridgePrototype.ts` 注入顧客所見的 PB child document，再以既有 Eventa 互動服務協定發現／執行工具。PB 原站並未提供這個 listener。重新載入 PB 會移除注入程式；正式 Companion 的配對、部署、撤銷及通道仍未完成，遠端公開 Webnavior 沒有因此部署這段程式。

```bash
# 前提：本機 API、Stage Web、Kiosk 已啟動；在原本 Admin 發布上方 PB 網址。
node scripts/tryWebnaviorPbPrototype.mjs --bridge-smoke
```

控制器只接受此店家的 PB 網頁、`http://localhost:5169` parent 與目前 document，提供查詢、搜尋、報價、選品澄清、開商品與草稿備註；購物車新增／改量／移除／換餐另受最新版本、規格及顧客語意檢查約束。不提供任意 JS、導航、登入、送單或付款。沿用專用瀏覽器的 PB Cookie 相容處理；這不代表無需控制器。測試瀏覽器停留供檢查，關閉視窗或終止該控制器後只移除建置暫存檔；專用瀏覽器 Profile 與 Server 的測試設備／歷程保留。

Kiosk 的外部 `browser_observe` 能力分支讓 Main Agent 使用外部工具，沒有捏造 Menu revision、POS receipt 或 System One finite candidates。自家 Menu 繼續要求其原本的每輪情境與授權。

## 專用登入常駐

2026-10-30 Firefox 相容實測：使用已安裝的 Firefox 159 / WebDriver BiDi、獨立
`.webnavior/pb-prototype-firefox` Profile，已沿用使用者手動登入狀態跨重啟，並由
真正 Kiosk 內的 PB iframe 確認登入。沿用 1080 × 1920；部署網址未變更。
結果寫入 `output/playwright/pb-firefox/`，不覆蓋 Chrome 驗收。

Firefox 同時受 SameSite 與第三方儲存分區約束。只準備同一個專用 Profile 的
三種核准 Cookie，仍不足以分享登入；另以 Mozilla 的
`privacy.restrict3rdpartystorage.skip_list` 設定精確的
`http://localhost:5169,https://app.esgpb.com` 配對例外。
沒有全域停用儲存分區。合成測試實際確認其他父頁仍拿不到 PB Cookie，且沒有
referrer 的核准父頁能搜尋、錯誤來源無法呼叫橋接工具。
[Mozilla 配對匹配實作](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/antitracking/PartitioningExceptionList.cpp)、
[偏好與配對清單格式](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/antitracking/PartitioningExceptionListService.sys.mjs)。

Playwright 1.60 的 persistent BiDi 啟動會等待 Firefox 159 新空白頁未發出的 load；
`firefoxBrowser.mjs` 保留原啟動參數，略過這個啟動等待，再驗證真正目標頁面。
同一版 BiDi 的請求物件將 postData 固定為 null，因此自然點餐測試改從本測試
Kiosk 的 fetch 輸入觀察紀錄；不改寫、重試或記錄 PB 請求與認證標頭。
這些驗證不包含實體麥克風陣列或 Windows 點餐機。

本輪 Firefox 159 真站驗收已通過：當日現有菜單查詢、單份白飯加購、明確不要
加購、兩份便當每份各加一份白飯，以及換客後撤銷舊同意／保留登入／人員交接。
`catalog-cases.json`、`addon-cases.json`、`handoff-cases.json` 均記錄原購物車
保持一致，沒有送單或付款。加購實測曾揭露模型把每份選項數量當總份數，及
把含加購單價算錯：已補明確的欄位語意，並讓已確認「尚未派送」的單價不符
回傳有限的提案修正。原價與規格驗證仍保留，結果不明的寫入不重放。
跨 iframe 測試 18 項、PB 商品／購物車 25 項、登入 Cookie 準備 2 項及
兩個正式 Firefox 合成驗證腳本通過；相關檔案 lint 通過，未跑全專案 typecheck。

使用者選擇「在專用瀏覽器手動登入一次」。控制器現改用 Playwright
`launchPersistentContext`，Profile 位於使用者家目錄的
`.webnavior/pb-prototype`，目錄權限為 `0700`，不在 Git 工作區。不匯出明文
`storageState`，不把帳密交給 Agent，也不在登入階段保存截圖或頁面快照。
瀏覽器子程序不繼承 `ESGPB_EMAIL`／`ESGPB_PASSWORD`。

每次啟動先以第一方頁面讀取 PB 菜單的 Inertia `props.auth.user` 是否存在，
只使用登入布林值，不記錄身分內容。未登入時開啟指定店家的登入頁，等現場人員
手動登入；若有「記住我」，可由人員選取。收到登入後再重新載入 PB 菜單，
確認 Server 仍認定已登入，才進入真正 Webnavior Kiosk。第一次仍使用既有
開發註冊；已保留設備 Cookie 的重啟不會每次新建設備。

關閉後保留瀏覽器資料，並不代表可延長 PB 的 Session 或保證永久有效。
PB 到期、登出或撤銷後仍需再登入；不自動重放帳密，不加登入 Agent 工具。
不要同時啟動兩個控制器使用同一個 Profile，也不要把個人的 Chrome Profile
指定給此原型。

獨立無頭 Chrome 測試已確認持久 Profile 可跨關閉／重開保留帶有效期的
HttpOnly 測試 Cookie，且未碰使用者的 PB 資料。這僅驗證瀏覽器儲存方式；
使用者已完成手動登入；實際重開驗證確認第一方 PB 菜單仍登入，並在修正交接後確認 Kiosk iframe 本身也維持登入。
[Playwright 官方介面](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)。

## 驗收修正：橋接 smoke 不等於智慧點餐

使用者指出先前「搜尋、開詳情、填測試備註，不要送單」是技術操作指令，不是
顧客點餐情境。此指令只保留為明確的 `--bridge-smoke` 選項；一般啟動不自動
送出它。它的通過不能計入 Jev、自然點餐、多輪理解、購物車或結帳驗收。
既有的 53 項測試也只是對應程式邊界的單元測試，不是 53 個真實點餐案例。

後續沿用 [A01–A22 驗收案例](../plans/2026-10-21-kiosk-main-context-and-ordering.md#驗收案例)
與 [D/H 多需求評測](../plans/2026-10-22-kiosk-multi-demand-evaluation.md)，
保留原有 oracle，不把 PB 改寫版本冒充歷史重現；只把品項換成此店實際的雞腿、
排骨、控肉便當。例：

| 原案例 | PB 自然語句改寫 | 必須核對；目前狀態 |
| --- | --- | --- |
| A13／D11 | 雞腿便當跟排骨便當都有嗎？ | 本機實際 Main 通過，查到兩款且未加車 |
| D12 | 雞腿便當兩份多少錢？ | 本機實際 Main 通過，兩份 20 元且未加車 |
| D04 | 我要一份便當。 | 本機實際 Main 通過，詢問三款便當哪一種，未擅自加車 |
| D01 | 雞腿便當、排骨便當各一份。 | 兩項及份數都進真實購物車；現有原型尚無此操作能力 |
| A06／D13 | 雞腿不要了，改控肉一份。 | 真正替換、保留失敗前原餐；現有原型尚無此操作能力 |
| D14 | 雞腿改兩份，不要換排骨。 | 只改雞腿數量；現有原型尚無此操作能力 |
| A16／D19–D21 | 一份／第二個／對。 | 只承接目前有效問題；待實測 |

每例分開記錄 Jev 原始判斷、Main 接手、PB 畫面／購物車實際效果及回覆。
Jev 在本輪橋接 smoke 走停用／交接 Main 路徑，不能宣稱 Jev 已理解 PB 點餐。
不為了讓案例過關，把測試句寫成工具操作步驟，也不把「開商品」算成「已點餐」。

## 已重現的整合障礙

- 自然案例曾查到 PB 資料，但回覆層只接受原 Menu 回執，顧客看到「沒有可驗證結果」。新增測試先重現，再接納明確 `ok:true/source:browser` 的唯讀回執；保留同輪多筆比較，價格由實際商品卡解析與程式計算，不採用模型自行口述的金額。曾觀察到模型把 $10 說成 100 元，此輸出不能直接呈現。
- 模型曾把空物件工具呼叫成 `{"none":""}`，嚴格輸入驗證拒絕後被當成連線故障。觀察工具改為有實際用途的必要參數：是否包含描述、查詢或選品釐清目的。原型目前沒有購物車／訂單寫入；明確參數或 UI 拒絕回傳 `ok:false`，不冒充丟失寫入回執。每個文件只允許一個橋接；初始化串行，並移除會中斷 PB 分類載入的多餘重載。
- 後續問句曾直接用歷史口述計價或追問，缺少本輪回執。外站提示與工具政策現在獨立於 owned Menu，要求本輪工具證據；釐清文字亦由真實選項產生，不把模型問題隱藏在無效的 Menu 回覆分支。

- 首次把第一方登入帶進 iframe 時，Lax Cookie 沒有隨第一個請求送出，後續匿名 Session 會取代登入。現改在進入 iframe 前，依明確 PB 保留登入策略，只準備原有三個指定 Cookie，保持值、HttpOnly、範圍及期限；Strict、其他站及其他名稱不變。新增案例先失敗再修正，七個 Cookie 測試通過；實際 iframe 登入亦已確認。
- 新註冊開發設備曾繼承已刪除設備的舊 `localhost:5166` 設定，而非已發布的 PB。測試先重現，再將註冊改為讀取店別最新發布版本；不讓保留的歷史設備決定新設備 UI。
- 開發測試自行動態匯入不含 Vite `?t=` 的 client URL，可能建立另一個 singleton，因此不能用它的狀態冒充真正 Kiosk 的狀態。控制器改以實際 Kiosk 的連線提示、恢復按鈕與最終 PB 畫面驗收。
- PB 商品卡片是帶 `role="button"` 的區塊，並非原生 button。只用 `closest('button')` 時，搜尋成功但開商品失敗；公開前端模組與真實工具回執確認後，改為同時定位原生及 ARIA button。

已驗證真正 Main Agent 呼叫 `browser_search` 後，PB 篩出雞腿便當，再呼叫 `browser_open_product` 開啟商品詳情。這不是測試程式直接替 Agent 點商品。補驗亦通過：真正 Agent 呼叫 `browser_set_note`，在 PB 的 `input[type=text]` 填入「整合測試，請勿送單」，畫面讀回一致，並等到整輪完成後保存截圖。PB 備註雖設定 rows=3，實際是文字 input，並非 textarea；此差異由前端模組與失敗回執確認後修正。沒有測試登入後購物車、送單或付款，也沒有語音、Windows Edge／觸控實機驗收。

## PB 的 API／function 證據

來源是同一 PB iframe 的實際 Network，以及已觀察到的公開前端模組：

- [菜單模組 Show-BuNSD4av.js](https://app.esgpb.com/order/build/assets/Show-BuNSD4av.js)
- [商品模組 ProductDialog-yEQARuAF.js](https://app.esgpb.com/order/build/assets/ProductDialog-yEQARuAF.js)

這些是當日版本的內部實作證據，不是 PB 承諾的公開 SDK／版本契約；資源 hash 可能變更。

| 介面／路由名稱 | 證據等級 | 已確認事項 |
| --- | --- | --- |
| `GET /order/store/1kgJeql/pick_up/menu-categories` | 真實 Kiosk 請求 200＋菜單模組 | 帶 `pickUpDate`、`pickUpTime`；前端使用回應的 `categories` |
| `GET /order/store/1kgJeql/pick_up/menu-category-items` | 真實 Kiosk 請求 200＋菜單模組 | 帶 `category_id`、`pickUpDate`、`pickUpTime` |
| `GET /order/store/1kgJeql/pick_up/getAttrByProduct/2503` | Agent 開雞腿便當時請求 200 | 商品選項／加購資料的讀取；其他商品及價格類型仍需逐一驗證 |
| `shopping.getPricesByProduct` | 商品模組程式碼；本輪未直接呼叫驗證 | `store_hash`、`flow_type`、`product`、`source`、`product_group`、取餐日期／時間參與路由產生；某些價格類型直接用已提供價格，不一定發送此請求 |
| `shopping.getProductByProductGroup` | 商品模組程式碼；未實測套餐 | 依店家、取餐模式、商品群組讀取子商品 |
| `shopping.getAttrByProduct`／`shopping.getAttrByPriceByProduct` | 商品模組程式碼，前者另有上述 Network | 選項可能隨商品或價格版本變動，不能只快取品名與單價 |
| `shopping.orders.details.store` | 商品模組程式碼；未呼叫 | 菜單商品動作會 POST，包含前端表單及取餐情境，`order` 參數在 menu 分支為字串 `null`；不能把此路由當作已驗證的最終送單／付款 API |

商品操作 handler 位於 Vue 元件內部，沒有證據它們是供外部呼叫的穩定全域 function。`route(...)`、Axios／Inertia 呼叫不等於 PB 對外提供的整合介面。現階段由 Agent 透過有限的瀏覽器工具觸發原本 UI，PB 仍使用它自己的請求及表單狀態；沒有另接金流。

另在當日實際載入的 `ShoppingLayout-CmXhi5CK.js` 與菜單模組找到 PB 自有
`message`／CustomEvent 入口：`search_product`、`product_category`、`product`
分別轉成 `xorder:searchProduct`、`xorder:selectCategory`、`xorder:selectProduct`；
`order_create` 導向購物車確認頁。商品 ID 使用 `p-`／`pg-` 前綴。其結果原本送往
PB 自己的 chat iframe，不是 Webnavior parent；部分 handler 即使未命中商品仍回成功，
不能只信事件回傳。這些是後續可評估的原生操作入口，本批自然案例仍使用有畫面讀回的
DOM 工具，尚未把原生入口當成穩定 SDK 或完成整合。

唯讀 `GET /order/store/1kgJeql/pick_up/orders/create` 可取得新的頁面 props：
購物車 `details[].id/amount/unit_price/item.name` 與 `subtotal`。一般 HTML GET
搭配 DOMParser 讀取 `data-page` 已驗證；缺少正確 Inertia version 的 JSON GET
會回 409。SPA 導頁後原 document 的 `data-page` 不保證更新，不能拿它驗證後續變更。
只保存餐點行與總額，不保存 buyer、會員或發票資料。

## 第一批自然案例結果

最終以同一實際 Webnavior Kiosk、1080×1920、Main Agent 連續三輪完成：

| 既有案例改寫 | 顧客原句 | 畫面驗證結果 |
| --- | --- | --- |
| D11-pb | 雞腿便當跟排骨便當都有嗎？ | 實際查到兩款，單份各 10 元 |
| D12-pb | 雞腿便當兩份多少錢？ | `browser_quote` 回執與顧客畫面均為兩份 20 元，未加購 |
| D04-pb | 我要一份便當。 | 詢問雞腿／排骨／控肉哪一種，未自行挑選加購 |

驗收腳本為 `node scripts/tryWebnaviorPbPrototype.mjs --natural-cases`。
`output/playwright/iframe-probe-20261029/natural-cases.json` 保存各輪實際回覆、
工具名稱及購物車前後比較，三例 passed=true、cartPreserved=true。
原購物車兩行控肉便當，數量各 1／2 份、合計 30 元，前後完全一致。
這是 Main 的查詢、計價與選品釐清驗收；Jev 仍走停用交接 Main，
加購、改數量、替換、短答完成點餐、送單／付款均未驗收。

## 產物及驗證範圍

### 基本購物車切片：四個自然寫入與唯讀回歸

現已提供 `browser_cart_get/add/quantity/remove/replace`，僅限核准本機 Kiosk＋
店家。`pbCart.ts` 擁有新鮮版本、序列操作、完整效果核對與 unknown 政策；PB Adapter
負責現有 UI 加購、站方路由函式產生 PUT／DELETE 網址、CSRF 與新鮮讀回。
商品／分類 ID、名稱和價格都從 PB 當次回應取得；沒有內建三款便當或單價。
`browser_quote` 亦改讀新鮮商品資料，不以目前搜尋畫面是否顯示某餐作價格依據。

實站找到兩個具體問題並修正：PB 對修改／移除回 302，Fetch 若跟隨會把 PUT／
DELETE 帶到 `/orders/create`。現停止轉址，以新鮮購物車證明效果，並不把 302
當作成功。首輪移除已完成但轉址錯誤，寫入鎖保持；獨立讀回逐行確認原 30 元
購物車還原後，才解除該次測試鎖，未重送移除，證據 `cart-redirect-resolution.json`。
另 Element Plus 會保留已隱藏的商品 dialog，開第二款時需判斷可見性，不能只看
DOM 是否仍有上一款 h1。這些是原站實際觀察，不是另一個 iframe fixture。

新增寫入能力後，唯讀回歸曾發現模型對「我要一份便當」擅選雞腿。該筆隔離測試
新增行已依已記錄前後狀態移除、原車還原（`readonly-regression-cleanup.json`）。
現由 Host `browserCartTask.ts` 在每次寫入前讀真實商品／行資料，要求目標名稱
在本輪原句有明確依據；未指定、同名多行、舊任務或無效參照不得交給 PB 寫入。
原句留在 Host，不為此把完整原句送到 PB。這只是必要目標限制，不冒充完整意圖分類；
別稱、指代／短答與後續有效問題票仍依第三階段完成，不能擅自放寬。
Host 產生的無效果釐清會結束本輪，不讓模型再猜下一個商品。明確拒絕／部分失敗
會呈現實際回執並停止，不將已知新增說成已回滾。

替換由一個工具固定先加新餐、核對完整效果、再次檢查原車，再移除原行；
第二步不能確認就記錄新餐已加入的已知部分，保持 unknown。修改前後同時檢查
取餐情境與人工操作世代。每次派送前寫入不含顧客資料的持久暫停標記，只有
本次擁有者已驗證完整效果才清除；重載／重啟不會自動消除未知寫入。
沒有清空全部、最終送單、付款、模型可用的原始 JS／任意路由或解鎖工具。

Oct29 當時的 `--cart-cases --natural-cases`，同一實際 Kiosk 的 Main 完成（Oct30 擴充後另重新驗收，見下節）：

| 案例 | 實際效果 |
| --- | --- |
| D01：雞腿、排骨各一份 | 各增加一份，小計由原 30 變 50 元 |
| D14：雞腿改兩份，不要換排骨 | 只有雞腿數量變更，小計 60 元 |
| D13：雞腿不要，改控肉一份 | 新控肉先加入並核對，原雞腿行移除，小計 50 元 |
| 移除：排骨不要了 | 只移除排骨，小計 40 元 |
| D11／D12／D04 | 查有無、兩份 20 元、不指定商品先問均通過，不新增購物車行 |

測試最後僅清理本次新增／變更，原兩行控肉 1／2 份、30 元完整保留。
`cart-cases.json`、`natural-cases.json` 各例 passed=true、cartPreserved=true。
額外 `--cart-guard-cases` 對真正 Kiosk 注入兩個錯誤模型呼叫：泛稱餐點卻猜商品、
同名兩行卻猜第一行。兩例都在 Host 阻擋，PB POST／PUT／DELETE 次數為 0，
車內容不變；`cart-guard-cases.json` 明確標示是故障注入，不計為模型語意正確率。

本批 scoped 驗證：購物車協調器 12、Kiosk 105、Server route 66 個測試通過；
Kiosk／Server package types、橋接 targeted tsc、受影響檔案 lint 與 diff check 通過。
未做 root typecheck、commit 或遠端部署。固定售價、未配置必選規格／付費加購的
基本商品已驗收；必選規格／付費加購選取、套餐群組、完整跨日資料變動、麥克風、
Jev／SLM、共用帳號隔離與正式 Windows／Companion 仍未完成，不宣稱五階段完成。

### PB 恢復與重試第一個切片

已將恢復／重試的服務政策移至 `kioskConversationRetry.ts`，保留 Menu 的
task ownership 與 END 驗證；PB 改用 Host-only `browser_recovery_context`，
不需要 Menu 工具。新鮮 menu/category、cart、取餐條件及目前搜尋／草稿狀態
產生 digest，與 documentId 一起檢查重試上下文。API 仍由實際網站提供商品／分類
ID，沒有將三款便當或價格寫入此判定。此 digest 不是 PB 全域版本或寫入回執；
目前分類回應與可見範圍不等於已完成全站分頁／庫存與跨日驗收，後續依主計畫補齊。

`--recovery-cases --natural-cases` 已在真正本機 Kiosk＋登入 PB 通過：
故意讓唯讀 RPC 回執逾時，待 PB 已完成後按原恢復按鈕成功；另攔截一輪模型回覆
模擬失敗，按「再試一次」經正常語音佇列保留原句、產生新 utterance ID，
重新得到兩份雞腿便當 20 元的已驗證回覆。這是故障注入，不是宣稱供應商當時故障。
三個自然案例再度通過，原購物車兩行、數量 1／2、總額 30 元前後一致。
最終加入資料格式驗證後，另跑 `--recovery-cases` 亦通過；證據在
`output/playwright/iframe-probe-20261029/recovery-cases.json`。
沒有購物車寫入／送單／付款、Jev／SLM、Windows 或真實麥克風驗收。

新增重試測試先重現 PB 因缺 Menu 工具失敗，再驗證 PB 與 Menu 各自政策、
資料／文件變更失效、pending／缺少證據拒絕。Kiosk 相關 96 個測試通過，
Kiosk package 型別檢查、橋接 targeted TypeScript 與受影響檔案 lint 通過。
原跨 iframe fixture 載入缺少 Menu validator virtual module，補用 Menu 擁有的
`toolValidationPlugin`，不以 mock 或替代 import 繞過真正依賴。
另捕獲 fixture 對 `127.0.0.1` 請求被 IPv6-only localhost listener 拒絕；
Vitest browser API 明確綁定 loopback IPv4 後，原三項跨 iframe 測試通過：
pending 寫入阻擋、替換文件拒絕、永不完成的操作不重播。使用已安裝 Chrome
執行，因 Playwright 對應快取版本缺失；臨時 Chrome 設定與診斷腳本已移除。

`output/playwright/iframe-probe-20261029/webnavior-pb-agent.png`、`webnavior-pb-agent.txt` 為實際 Kiosk 畫面；`webnavior-pb-api.json` 只保留方法、路徑、query key 與 HTTP status，不保存 Cookie、Token、帳密或完整 HTTP body。較早的 `failure`／`loading` 檔案保留失敗證據，不能當作最後結果。

針對 interaction recording 與設備註冊的 53 個測試通過；Kiosk package typecheck 及受影響檔案 lint 通過。沒有執行 root／全專案 typecheck，沒有 commit 或遠端部署。

本批另通過 Server route 63 個測試、Kiosk presentation/retry 49 個測試；
Server/Kiosk package typecheck、橋接檔 targeted TypeScript 檢查與受影響檔案 lint。

### Oct30：新鮮菜單、付費加購及獨立份數核對

最新實際 Main 的付費白飯、D01 多項加入、D14 改量、D13 兩份換一份與指定移除
均通過；原兩行控肉 1／2 份、30 元完整保留，未送單付款。D11／D12／D04 與
兩個錯誤目標故障注入通過。雙品項查詢可由兩筆有效回執組成；驗收逐品項找證據，
且要求所有顧客資訊均已顯示，不假定模型只呼叫一筆查詢。

二元「整體效果相符」核對曾把逐道加入誤判為漏單。現由 Main 只依原句、指定目標、
本輪已驗證效果與網站現況抽取每個目標尚需份數；提案數字及描述不送入抽取。
程式逐項比較目標、份數及備註判定，缺項、重複或未知目標與失敗回覆均不授權。
整句目的仍由設定中的 Jev／SLM 優先判斷，弱判斷交 Main；不因此變更模型設定。
13 個零 PB 寫入的供應者契約案例通過，包含多項點餐的正確／錯誤份數與已完成步驟。

新鮮分類完整性、跨分類 SKU 去重、批次完整規格查詢與模型資料壓縮已接通；
真站 batch getter 通過。離開菜單但保留同文件 listener 的案例先重現失敗，
修正後在工具入口與實際派送前均拒絕，購物車不變。

本批 Server 領域 18＋route 68、Host 12 個相關測試與 scoped types/lint 通過。
每日七品項／三分類／換名換價與規格變動目前是領域資料測試；完整跨日瀏覽器、
必選與價格規格、套餐、有效短答、共用帳號交接、真語音及正式 Windows Companion
仍須各自完成，不能將本批通過當成五階段完成。

### Oct30：原站表單與有效短答的當前驗收

固定商品加購現依每次重讀的 PB 商品／規格／取餐情境建立原站表單，不依賴
長時間開啟頁面的舊 Vue 商品卡片。原站 ProductDialog 的 unit_price 是基本價，
attrs 是每份的規格／加購數量；配置後價格只用於預期效果及完整車核對。
新增兩個表單資料測試先重現未提供功能，再驗證必選 radio、選填零值、隔日新 ID、
新價格及過期規格拒絕。真站白飯加購配置單價15元通過且原車還原。

最新 `--conversation-cases --cart-cases --natural-cases --question-cases` 全部通過：
三個一般對話只選 Host 非操作工具、四個購物車操作、三個原查詢及八輪選餐／更正／
取消／完整確認／重複同意。`cart-cases.json`、`natural-cases.json`、
`conversation-cases.json`、`question-cases.json` 均保留逐例證據。
原兩行控肉 1／2 份、30 元完整保留，未送單付款。Host 恢復準備仍讀取新鮮 PB
狀態；一般對話未選商品工具不等於完全沒有 PB 背景讀取。

多名稱查有無的回歸曾發現 Main 只報第一道。Host 現在單道 quote 後補讀當次
資料，對原句其他明示名稱補上基本／存在證據，不替其推測份數、規格或庫存。
此症狀的測試先失敗再通過；不改原 D11 必須涵蓋兩道的判準。

Host 問題與一次確認綁定客人、documentId、購物車、規格、價格及120秒期限。
選品項不寫入；更正撤銷舊確認，重新顯示完整提案；同意後也只允許精確相同設定。
`--answer-cases` 十二個零 PB 寫入案例全通過，其中七例有 Main 裁決、五例全由
當前 Jev 完成；單例中位1173ms、最慢3271ms，是本輪有限判斷觀察，不是硬體效能
保證或 Jev 本身正確率。記錄 relation／selection 的實際 provider，未切換模型。
尚未啟用的 SLM、其他商品型態、全跨日瀏覽器／語音／共用帳號交接與正式 Windows
Companion 仍不得視為完成。使用者已確認只能測目前品項、無法改菜單，先用 Mac 與正確 ASR 文字；實機語音及 Windows 延後。


### Oct30：現有加購、真實空車及客人交接

本次依使用者決定，先使用 Mac／Chrome、1080×1920 與模擬辨識文字，假設 ASR
正確。可用資料只有三款便當及白飯；不修改店家商品、不等待其他規格或實體機台。
未新增 Electron 封裝或替換現有 Kiosk。

新鮮讀取發現 PB 的空車是 order:null、details:null、subtotal:0，舊解析器把它誤當
錯誤。現在只有明確空訂單與零明細／零小計一致才承認空車，其他缺資料仍拒絕。
清掉舊 orderHash；首次加餐可建立 orderRef，但時段、人工操作代數與完整效果仍須
相符。`--cart-smoke` 真站的加餐／改量／移除通過，還原當次空車。歷史兩行30元是
早先驗收基準，不宣稱它們仍在當前車中；本次沒有清空舊車，也未確認其消失原因。

`--addon-cases` 三個實際 Main 自然輸入全通過：

| 輸入 | 實際驗證效果 |
| --- | --- |
| 雞腿便當一份，另外加一份白飯 | 一份、每份白飯1、配置單價15、小計15 |
| 雞腿便當一份，不要加白飯 | 一份、白飯0、單價10、小計10 |
| 雞腿便當兩份，每份都加一份白飯 | 兩份、每份白飯1、配置單價15、小計30 |

每例只移除有已驗證回執的獨立測試行，原始空車皆還原。否定加購以零份省略約束
交給獨立數量抽取核對；若原句要求加購而提案漏掉，抽取正數就要求修正。只有選項
可使用零約束，產品／原車行的零份不授權寫入。沒有用字串看到「白飯」就選白飯。

`--handoff-cases`（最後成功日誌 `/tmp/pb-proposal-handoff-live.log`）包含舊客人的
待確認問題、已開商品視窗、未送出備註與搜尋；使用真實重新開始按鈕。核對結果：

- 同一 PB 文件及共用登入保留；草稿／搜尋清除、舊確認失效。
- 新客人說「對」不承接舊問題；未交接的非空車拒絕代操作且不傳舊行給 Agent。
- 菜單查價仍可使用；交接前 PB 寫入為0。
- 真實工作人員檢視／勾選／繼續 UI 確認後，僅加入新客人明示的一份餐點。
- 只移除可證明的兩個測試行，最後還原當次空車，沒有送單或付款。

測試登入工作人員使用本地 session fixture；不代表 PIN 認證或實體機鎖定已驗收。
管理員的檢視權限結束、快照過期與未知結果拒絕另有4個實際 Chrome 元件測試。
本地 owner 只保留不透明 visitor ID，不保存車內容；不能宣稱已解決遠端共用帳號的
跨設備購物車隔離。未知結果也不能用交接確認解除。

最小草稿測試先重現 PB 的 role=dialog 在 el-overlay-dialog 外層、menu-dialog 在
內層，原 selector 漏選卻回成功的問題；修正後 `--draft-reset-cases` 與上述完整換客
均通過。Host 的 bounded reset 只關已觀察的商品草稿、清搜尋與驗證不變的車，然後
遞增人工代數、更新連線；不重建 iframe、不按泛用確認、不清車或登出。

完整重跑也遇到 Main 的確認提案以一般工具錯誤結束。規格／價格／缺選項的
未寫入提案現在回傳可修正結果，使用最新同品項設定重建確認，不直接加車；
三個回歸先失敗再通過。驗收程式亦保存非 JSON 的工具錯誤，而非解析失敗掩蓋原症狀。

本批相關 Kiosk117、PB29、Server26個單元測試與交接畫面4個 Chrome 測試通過；
Server／Kiosk package typecheck、PB bridge targeted strict tsc、受影響檔案 lint
通過，未跑 root／全專案 typecheck。沒有 commit、部署、送單或付款。
證據：`addon-cases.json`、`draft-reset-cases.json`、`handoff-cases.json`，均在
`output/playwright/iframe-probe-20261029/`。最後成功日誌分別為
`/tmp/pb-reset-addon-live.log`、`/tmp/pb-draft-reset-fixed-live.log` 與上述換客日誌。

五階段仍未全部完成。正式 Companion 配對／撤銷／單一執行者與持久操作紀錄、
跨設備共用車隔離、未知結果維護，以及尚無商品型態的真站驗收仍有各自門檻；
Windows／觸控／真實語音與日後封裝依使用者決定延後，不能用本次 Mac 結果替代。


### Oct30：瀏覽器與 Electron 共用控制程式

`pbBrowserService` 現在擁有同一份 PB 操作、範圍限制、文件 ID、去重紀錄與未知
暫停政策；iframe 的 Eventa peer 和原生隔離 world entry 僅負責各自傳輸。
`interactiveServiceClient.activateTransport` 可接原生傳輸工廠，保留原工具身份、
connection/document/operation 關聯與遺失回執恢復政策；window transport 仍檢查
來源 window 與 origin。原生等待取消只終止等待，不能推論網站效果未發生或重送。

Electron 主程序只在 trusted Kiosk 主 frame 的有限 RPC 進入時，驗證 serviceId、
documentKey、精確 PB 菜單範圍與 navigation generation，然後在 world1001 執行
建置時打包的 service。呼叫者不能提供 JavaScript，只能提供 discover/execute/
inspect 的已驗證封包；遠端頁面沒有 preload、Node 或主 world 可見的控制物件。
主畫面 resize、暫時遮罩不會重建工具授權；換頁後舊回應不能成為新文件的效果。

Mac 真 Electron 程序測試使用攔截 HTTPS 的合成 PB-origin 頁面，通過可見搜尋、
工具探索、重複 operationId 回執、查證、錯參數重用／舊 documentKey／任意程式碼
與離開菜單的拒絕。它沒有碰真店家 Session 或帳號，不能稱為 Electron 真站點餐。
`/tmp/pb-native-electron-live.log` 保留成功結果。

原 iframe 的18個瀏覽器契約測試、共用 client3、原生取消2、Desktop policy3、
原生 View／ScenarioSurface3、PB cart16個相關測試通過；Desktop build、Shared／
Kiosk／Desktop scoped types 及 bridge/client strict targeted tsc 通過。
瀏覽器測試最初遇到缺少新版 Playwright Chromium，改用已安裝 Chrome 通過，
不下載額外執行程式。Stage UI 已有專用的 vitest.interactiveService.config.ts。

實際 Webnavior／Chrome 的 PB 單行加入、改量、移除再次通過且原車保留，日誌
`/tmp/pb-shared-service-real-kiosk-final.log`。首次嘗試在工作人員恢復查核時被擋，
尚未寫入；重新唯讀查核 canRetry:true 後才以新鮮車況另跑，沒有放寬保護或重送。
這個 smoke 是傳輸／回歸證據，不重新宣稱整套自然點餐或五階段都已完成。

沒有新增依賴、提交、部署、送單／付款或原生音訊。Electron 真實 PB 自然點餐
仍需它自己的人工登入與驗收，Chrome 專用登入不複製。正式 Companion 配對與
撤銷、持久操作紀錄、上游多設備車隔離與 Windows／實機音訊仍有獨立未完成門檻。
