# Webnavior 移除原生 WebMCP 依賴

日期：2026-10-20。分支：`no_mcp`。狀態：Kiosk／本機 Order Menu 的本機實作與自動驗證已完成，並依後續授權分批 commit；尚未部署，實機驗收待執行。

## 目標與範圍

自有 Order Menu 在沒有 `document.modelContext`、沒有 WebMCP Origin-Trial
及專用瀏覽器旗標的環境中，仍能接受 Kiosk 頁面的工具探索與呼叫。
Jev、Main Agent、工具參數與結果、菜單／購物車狀態、確認及付款授權規則保持一致。

使用者已澄清：本次繼續使用目前 `http://localhost:5166` 的 Order Menu，
不改接大麥網頁。「替換 Menu 接入」只指修改這個頁面的原生 WebMCP 接入程式，
不更換菜單網站、餐點或 UI。Kiosk 仍使用其管理設定的 service URL，
不以本次修改覆寫既有設定。

**Stage Web 暫不處理**：`apps/stage-web` 的接線、工具 mapper、權限差異、
README、測試、build 與部署均不在本次範圍。共用目錄可新增 Kiosk／Menu 所需
的新協定與 client，但不得直接替換 Stage Web 仍使用的原生 adapter／export。
Stage Web 對更新後 Menu 的 Agent 控制不列為支援或驗收項目；Menu 移除原生
註冊後，舊 Stage Web 不能因此被宣稱仍可控制該頁。其後續遷移另案處理，
本次不為它保留 Menu 原生 fallback 或雙路工具註冊。

本次處理可修改並配合接入的互動服務。無法修改的第三方網站控制仍依
`2026-10-18-webnavior-routing-and-browser-control.md` 另行選型。
不建立 Server 上的隱藏瀏覽器，不把 UI 狀態搬到 Server，不新增付款能力。

## 已實作的接入與驗證方式

- Kiosk 改用 `services/interactiveServiceClient.ts` 與新工具 mapper，保留既有
  `webmcp` tool registry key，因為它也是 toolset prompt 的識別鍵，與原生傳輸無關。
- `packages/stage-shared/src/interactiveService.ts` 定義 Eventa RPC 與 Valibot
  envelope schemas；host 綁定 Window、origin、connection ID 與 document ID。
- Menu 的 `interactiveService.ts` 承接探索、描述版本、參數驗證及連線內 operation
  去重；`webmcp.ts` 保留既有業務 runtime，只新增傳輸入口並移除原生註冊。
- 原本位於 runtime 的靜態工具契約移至 `toolDefinitions.ts`；四種頁面供應狀態
  移至無 DOM／資產副作用的 `domain/menuPageState.ts`，原 domain API 保留 re-export。
  這讓建置端能直接編譯同一份工具 schema，避免維護另一份手寫驗證規格。
- 使用者在說明後接受以維持原功能為準，採用建議的 Ajv 正式驗證器。
  `toolValidationPlugin.ts` 於 Vite／Vitest 載入時預先編譯，再以既有 Vite 打包
  Ajv helpers；瀏覽器執行靜態 ESM，不需要 `unsafe-eval`。動態 POS enum 透過
  Ajv `$data` 使用當前 descriptor；不轉型、不剔除額外欄位、不套用預設值。
- 原生 adapter／health export 與 `apps/stage-web` 程式保持原樣；Menu 已停止原生註冊。

## 驗證紀錄與交付限制

- Menu：682 項單元測試通過；177 項 env-guard／live replay 未執行。
- Kiosk：195 項單元測試通過；48 項 env-guard／live replay 未執行。
- Kiosk Chrome 元件：52 項通過、2 項略過；電話、iframe、文字模式等沿用既有測試。
- 新連線 Chrome：15 項通過。無原生 `document.modelContext`，真實跨來源與禁止 eval 的
  Menu fixture；涵蓋複合加購、合成 Main 工具串接、推薦、電話、任務鎖、錯來源／
  錯視窗、重複請求、晚到結果、模擬結帳／付款與完成、新頁面新訂單。
- 原生 JSON 序列化邊界另以 Vue readonly 參數先重現 DataCloneError，再修正並
  驗證：client 傳送 JSON 快照，Menu 在緩存回執前只序列化一次，保持舊資料語意。
- Menu／Kiosk scoped typecheck 與 production build 通過；變更檔 lint 與
  `git diff --check` 檢查。未跑 root typecheck，Stage Web 未改、未驗收、未 build。
- 這些證據使用合成菜單／runtime 與模擬終端，不代表真實 Jev／Main 端點、
  目標 Kiosk 瀏覽器、相機／麥克風、真實付款或 POS 已驗收。未操作部署環境。
- 實機下一步：完整重新載入匹配的 Kiosk／Menu，確認 service URL 與 host origin，
  再依本表核對語音／文字點餐、combo、推薦、電話及模擬結帳。此步不授權真實付款。

## 本次程式確認與修改清單

程式已確認兩端直接依賴原生 API：Menu 使用
`document.modelContext.registerTool`；共用 host adapter 使用
`document.modelContext.getTools`／`executeTool`。後者缺少 API 時直接回報
`unsupported-browser`。這是目前可確認的相容性阻點；尚未以目標 Kiosk
實機驗證其瀏覽器版本、政策及部署環境，不能據此宣稱所有載入問題都已定位。

| 層級 | 主要檔案 | 要改的範圍 |
| --- | --- | --- |
| 菜單工具入口 | `apps/order-menu/src/App.vue`、`src/webmcp.ts` | 將原生註冊／卸載替換為 Eventa 接入；保留 `toolDefinitions`、`invoke`、`invokeForAgent` 與 catalog 載入後提供工具的時序 |
| 新協定 | `packages/stage-shared/src/interactiveService.ts`（預定）、`package.json` exports | 新增版本、握手、工具描述與訊息驗證；只遷移本次 Kiosk／Menu consumers；保留 Stage Web 使用的原生 health export |
| 新 host client | `packages/stage-ui/src/services/interactiveServiceClient.ts`（預定）及新測試 | 承接 Kiosk 的 discovery／execute、iframe 綁定與清理；保持 tools、readiness、執行通知、completion revision 語意；不覆寫既有原生 adapter |
| Kiosk 接線 | `apps/stage-kiosk/src/components/ScenarioSurface.vue`、`src/services/webmcp-adapter.ts`、`src/tools/webmcp.ts` | iframe load 時傳入精確 Window；同步工具 mapper、customer entry、fast path、KioskScene 等型別／import；維持電話遮罩與載入時 inert 行為 |
| 套件、提示與部署文件 | Order Menu manifest、受影響測試、Kiosk／Menu README、`CONTEXT.md` | Menu 補既有 catalog 的 Eventa runtime dependency；移除 Kiosk／Menu 路徑原生專用權限與提示，補新連線錯誤及發布要求 |

`App.vue` 現有 `resolveExpectedHostOrigin` 已使用設定的
`VITE_AIRI_ORIGIN`，未設定時依嵌入頁 referrer 解析。新連線沿用這個設定入口，
並核對發布時的允許來源；不得用 `*` 或收到的訊息 origin 自行建立信任。
Menu 端限定已核准的 parent Window；host 端限定目前 iframe 的 Window 與來源。

Kiosk 目前只把 service URL 傳入 `activate`；因此這次不能只改 Menu 的
`registerTool`，必須讓 Kiosk 切到新 client，並調整 `ScenarioSurface.vue`
傳入精確 iframe Window。替換完成後移除 Kiosk iframe 的 `allow="tools"`，
其他功能權限另依既有用途保留。Stage Web iframe 不改。
Origin-Trial／啟動旗標尚未證明存在於目前
部署來源；列為發布盤點項目，不預設 repo 已含全部設定。

本次不改 Jev 判斷、低信心交接、Main prompt、相機／ASR／主動招呼策略、
點餐／付款授權、POS API 或 DB schema。相關流程只做整合回歸；若實作發現
獨立問題，另外記錄，不藉替換傳輸層擴大功能。

## 現有功能對接基準（包含 combo 與推薦）

範圍內的程式沒有名為 `combo` 的 Menu 工具。此處依使用者關切，將現有
「單次工具內的複合流程」及「Main 連續呼叫多個工具」都納入必要驗收，
不因沒有這個工具名稱而漏測；也不新增 combo API 或批次交易引擎。

先以目前 commit、相同 POS catalog／capabilities 及合成訪客狀態記錄基準，
再將相同工具輸入與結果送過新 client。沿用既有 runtime 測試建立預期，
補上真正跨頁傳輸測試，不能只測 runtime 或只確認握手成功。

| 現有行為與程式依據 | 替換前後必須對上的內容 |
| --- | --- |
| `order_add_item` 與 `actionPresentation.test.ts` | 單次指定品項、份數及選項仍走既有可視流程；結果、購物車與畫面焦點一致；缺少必填資料仍補問，不先加購 |
| `cart_get` → `cart_set_line_quantity` → `order_add_item` 的 Main 串接 | 使用每一步實際回傳的 line ID／狀態；「水餃改一份，再加一碗牛肉麵」兩項需求都完成；不得漏掉其中一項或把整串視為可無條件重送 |
| `order_add_item({replaceLineId})` 與 `cartChangeDiagnosis.test.ts` | 保留原有單筆換餐的驗證與一次提交；替代品、選項或 revision 不合法時保留原單；一般多工具串接不宣稱具備整串原子性 |
| `menu_get`／`menu_recommend`／`menu_show_recommendations` 與 `queryActions.test.ts`、`recommendationFlow.test.ts` | `update`／`continue`／`reset`／`clarify`、分類、價格、飲食限制、已展示紀錄與畫面展示一致；不因重連重建 runtime 或消耗下一批 |
| `kiosk_fast_path_context`／`execute`／`continue` | candidate、reference、question／confirmation ID、menu/cart/selectedItem/recommendation/checkout revisions 保持原值與所有權；傳輸層不重建或改寫它們 |
| `kiosk_agent_task` BEGIN／END 與 `invokeForAgent` | 同一 task 的限制、讀取權限與手動操作鎖延續整段串接；舊 task END 不能釋放新 task；傳輸取消不代表可以解除尚未確認的寫入鎖 |
| 電話、待答問題、結帳與完成通知 | 電話頁略過／手動輸入、問題呈現與回答關聯、付款 uncertain、Agent／觸控完成通知及新訂單重設均接回原有狀態機 |
| 工具拒絕及 host 執行通知 | `ok:false`、`rejection`、`customerMessage`、`recovery`、`pendingCustomerChoice`、`interaction` 等現有欄位保留；`called`／`resolved`／`failed` 與完成 revision 不漏報、不重複、不中途更新新連線 |

對接時比對實際提供的工具清單、description、inputSchema、read-only metadata
及 Agent 過濾後清單；不只比工具名稱或數量。以相同 catalog、用餐方式、付款方式、
callback 能力與 testing 設定比較，避免把有條件開放的工具誤當固定清單。
category、strategy、fulfillment 及 payment enum 均來自既有 runtime；工具能力
有變更時重新取得完整描述並撤銷舊描述，不能只在第一次握手硬編碼。

基準比對排除隨機 ID／時間的逐字相等，但必須驗證其關聯、有效期與一次性語意；
不把舊 document 發出的 ID 複製到新 document 使其繼續有效。
工具本身已有的領域拒絕要由新接入層轉成相同結構回執；不能因 Eventa 可傳錯誤，
就把所有拒絕改成 transport exception，讓 Main 只剩共用失敗訊息。

Kiosk 目前以完整 `hostToolNames` 排除 Agent 不應取得的工具；新 client、
Kiosk mapper 與 Menu 接入的 host-only 分流須維持同一邊界並測試拒絕路徑。
盤點中發現的 Stage Web filter 差異留待其後續遷移，不在這次修改或驗收。

## 現有可沿用的 seam

- `packages/stage-ui/src/services/webmcp-adapter.ts` 的 discovery、health、
  tools、execute、執行事件、完成 revision 與 readiness 是 Kiosk 遷移時的語意基準；
  原檔仍由 Stage Web 使用，本次不刪除、改名或原地替換。
- `apps/order-menu/src/webmcp.ts` 已提供 `toolDefinitions`、`invoke`、
  `invokeForAgent`；原生註冊只是其中一個入口。保留這些業務決策與驗證。
- `ScenarioSurface.vue` 已掌握 iframe
  Window；新的連線必須接收該 Window，不能只靠 origin 尋找頁面。
- `scenario-registry.ts` 與 `interactionLifecycle.ts` 已有來源視窗、origin
  與完成事件驗證。沿用既有責任，不為換傳輸層重寫導覽及生命週期通報。

## 通訊選型

依 AGENTS.md 的 Eventa 規範，優先沿用 workspace 的
`@moeru/eventa@1.0.0-beta.8`。使用者已指示依此計畫開始實作；以下保留選型比較。

| 方案 | 現況與成本 | 建議 |
| --- | --- | --- |
| Eventa `window-message` | 已安裝；提供 `targetOrigin`、`expectedOrigin`、`expectedSource`、`acceptMessage`、dispose；需補應用協定驗證與 generation 隔離 | 優先採用 |
| Eventa + MessageChannel | 標準專用 port；本次已檢查的套件入口未確認現成 MessagePort adapter，不能把 EventTarget adapter 當成可直接跨頁傳送的 port adapter；需額外握手、轉接及清理驗證 | 若第一方案有具體阻礙再評估 |

不另選新的 RPC library，也不手寫 request/response RPC 引擎。
目前工具清單沒有 Context7；已改查官方文件與實際安裝版本的 declaration／implementation。
官方主分支可能與安裝版不同，以本地 exports、實際執行及 scoped typecheck 驗證。

已確認的本地實作：

- `@moeru/eventa/dist/adapters/window-message/index.d.mts`：選項與 dispose 介面。
- 同目錄 `index.mjs`：來源過濾、訊息 envelope 與 context abort／listener cleanup。
- `apps/stage-tamagotchi/src/renderer/widgets/extension-ui/shared/eventa-runtime.test.ts`
  已使用相同 adapter；只作既有使用參考，不複製其中的平台 mock／型別轉換模式。

參考：[Eventa 官方 repo](https://github.com/moeru-ai/eventa)、
[HTML Web messaging](https://html.spec.whatwg.org/multipage/web-messaging.html)、
[postMessage 來源驗證說明](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)。

## 目標結構

```text
Jev／Main Agent／Kiosk host-only flow
                ↓
Kiosk 使用的新 interactive service client（Vue 狀態與既有 host interface）
                ↓
Eventa window-message（核准 origin + 目前 iframe + 連線 generation）
                ↓
Order Menu 接入模組（工具清單、輸入驗證、host/Agent 分流）
                ↓
既有 runtime.invoke / runtime.invokeForAgent
                ↓
菜單、購物車、確認、付款與 POS 狀態機
```

共用協定放在 `packages/stage-shared` 的獨立 browser-neutral export，例如
`interactiveService.ts`。集中 Eventa definitions、工具 descriptor 與 Valibot schemas。
不透過 Vue runtime 或 Node 模組轉匯出型別。

共用 client 放在 `packages/stage-ui/src/services`，以 `interactiveServiceClient.ts`
命名；本次只有 Kiosk 使用。保持 Kiosk consumers 需要的 tools、availability、execute、onExecution、
completionRevision、waitUntilReady 等語意；activation 改為接收 serviceUrl 與
明確的 iframe Window。探索、驗證、逾時與清理由這個 module 負責。
不建立只有單一實作卻可任意切換多種 transport 的通用框架。

Order Menu 接入模組只持有連線及 handler lifecycle；點餐規則留在既有 runtime。
host-only 工具仍走 `invoke`，Agent 工具仍走 `invokeForAgent`，不得將來源角色
當成任意可傳入、可提升權限的工具參數。Main Agent 的工具清單仍排除 host-only。

## 協定與生命週期要求

1. **握手與 readiness**：父頁在 iframe load 後主動連線，菜單載入完成後回應。
   支援 listener／catalog 晚於 load 的情況；有界重試僅限無副作用的握手與探索。
   驗證 protocol version、challenge、工具 schemas 與當前 document binding 後才 ready。
2. **隔離**：每次 activation 都有新 generation／connection ID。以精確 targetOrigin
   送出，雙向驗證 origin 與來源 Window。Eventa request correlation 與應用層連線 ID
   分工清楚；禁止只憑相同 origin 接受另一個 iframe 或重新載入前的訊息。
   菜單重載會產生新的 document identity；重新握手立即撤銷舊連線。
3. **執行**：工具名稱、input schema、read-only metadata 與結果語意保持一致。
   schema 是物件；不再依賴原生工具 handle 或瀏覽器的 JSON 字串轉換。
   同一 request 不得重複執行，重複或未知請求的處理在接入模組明確定義並驗證。
4. **結果與錯誤**：區分協定／連線錯誤與既有業務拒絕。保留目前
   `nativeInvocationFailure` 所承載的領域錯誤語意，重命名為傳輸無關的名稱。
   序列化前確認現有工具結果皆能 structured clone；不默認所有 Error 內容可跨頁傳送。
5. **切頁、卸載、斷線**：撤銷 tools、清空 readiness、結束 pending promises、移除
   listeners／handlers。晚到回應不得更新新連線、完成 revision 或訪客狀態。
6. **逾時與取消**：本地 Promise 結束不代表遠端寫入已撤銷。沿用既有任務鎖與
   付款 uncertain 規則；對可能已開始的寫入不自動重送或回報「確定未執行」。
   在同一 document 可恢復時讀取實際狀態；無證據時維持未知，不推定成功或失敗。
   多工具流程若前一步已完成、下一步未確認，保留已知結果並停止後續依賴操作，
   不重播整串、不自動補償或回滾。連線 ID／document ID／operation ID 的用途
   與 Eventa request ID 分開；重複執行保護限定已確認的 document／連線範圍，
   不宣稱重新載入或程序消失後仍能保證 exactly-once。
7. **完成事件**：保留觸控操作的 lifecycle 通報及 Agent 工具完成結果。
   驗證兩路同時到達時，不會重複結束訪客 session、重複顯示回饋或重複重設。
8. **無協定頁面**：iframe 仍可顯示及手動操作；有限等待後顯示未提供 Agent 接入。
   不宣稱單純換傳輸層就能操作未接入的第三方站。

## 分階段實作與驗收

### 1. 先固定基準並證明已安裝 Eventa 能承接需求

先整理上述工具與狀態對照，執行相關現有基準測試，確認測試資料確實包含複合
加購、多工具串接與推薦續批。已存在的失敗要先記錄，不把舊問題誤判為新傳輸
造成；沒有對應案例的關鍵路徑補 focused test，再進行 production 接入替換。

新增最小跨來源 browser test，模擬父頁與子頁，且不提供 `document.modelContext`。
驗證握手、工具清單、read-only 呼叫、雙向錯誤、dispose 後 pending settlement，
並確認本地 package export／型別入口可由受影響的 browser package 正常載入。
DOM 與跨頁行為使用真實 browser；不以 `vi.stubGlobal('document', ...)` 證明可用。
此階段先不改點餐 production code；測試結果決定能否進入下一階段。

### 2. 建立協定、替換菜單接入

新增共用事件／schemas 與 Order Menu 接入；將原生 registration 中的 host/Agent
分流及錯誤轉換接到既有 runtime。先以實際 runtime 驗證工具定義與結果相等，
包含 read-only、加購、拒絕及確認場景。單獨開啟菜單仍可正常觸控操作。
必要套件 manifest 使用既有 catalog 版本，runtime imports 必須是 runtime dependency。

### 3. 接回 Kiosk

將 Kiosk singleton／工具 mapper 切到新 client；修改 `ScenarioSurface.vue`
傳入精確 iframe Window。更新 Kiosk readiness 提示及相關 i18n。
KioskScene、customer entry、模擬 ASR、執行進度、工具回執與完成通知沿用原 interface
語意，避免在大型場景檔案加入傳輸細節。

以明確名稱替換 Kiosk 路徑的 WebMCP adapter／type／factory，移除 Menu 原生
註冊；Kiosk 不保留 native fallback 或雙路自動切換。Stage Web 既有 adapter、
型別與 health export 原樣保留，這不代表更新後 Menu 仍提供原生工具。
既有工具名稱、資料契約及持久化資料不因命名整理改版。
Order Menu 的大型 `webmcp.ts` 本次保留檔名與 runtime API，僅移除原生接入責任；
不為改名擴大跨 app imports 修改，也不順便重拆點餐邏輯。歷史文件與無關產品的
WebMCP 不作全 repo 字串清除。

### 4. 整合回歸與移除部署依賴

測試優先順序：新協定與實際 runtime → Kiosk 流程 → 真實跨來源 browser flow。
涵蓋：

- 推薦／價格查詢／繼續與重設、選項與數量、加購／改購／移除。
- 單次複合加購及 Main 多工具串接；第二步拒絕、已寫入但回應遺失、執行期間
  觸控修改、同一請求重複送達。斷線、逾時與錯誤回執均不得導致重複加購。
- Jev host-only context 與執行、Main Agent 工具執行、模擬 ASR、手機輸入。
- 確認／拒絕、取消、模擬付款 pending／uncertain／accepted，及完成與新一輪。
- 錯 origin、錯 Window、同 origin 多 iframe、舊 connection、未知工具、非法 input。
- iframe 重載／切服務、catalog 延遲、連線失敗、工具執行中斷線與晚到結果。
- 原生 WebMCP 不存在的瀏覽器仍完成整條點餐路徑。

本機整合以目前設定的 Kiosk host 跨來源嵌入 `http://localhost:5166` 驗收，
不包含 Stage Web。`localhost` 指執行瀏覽器的那台機器；實機若不在
開發電腦，須先確認該機可取得 Menu 或既有設定的服務位址。另核對 iframe 載入、
設定的 host origin、CSP、referrer 及瀏覽器網路政策；工具傳輸替換不能解除
頁面本身被瀏覽器阻擋。這不構成改接大麥或擴大部署範圍。

沿用 repo 的 Vitest 與 browser 設定，實作前先核對 package scripts。只跑受影響的
unit/browser suites、package-scoped typechecks、changed-file lint，以及
Order Menu／Kiosk 的相關 production builds；不跑 Stage Web 驗收或 root typecheck。
真實 Jev／Main endpoint 測試依 env guard 執行，未跑須明列；本計畫不授權部署或真實付款。

檢查受影響 iframe 的 `allow="tools"`、Origin-Trial 注入、啟動旗標及測試 harness。
先證明無原生依賴可用，再移除這條產品路徑的專用設定。
Nginx live 設定與瀏覽器啟動器不一定在 repo，須在發布準備時核對實際來源，
不能僅以 repo 搜尋未找到就宣稱已清除。

更新 Order Menu、Kiosk 的相關 README、部署文件、`CONTEXT.md`
中受影響術語與簡短 handoff；先前已存在的第三方控制計畫只補上與本方案的範圍關係。

## 發布與回退

Kiosk 與 Menu 是本次協定相依的一組產物。版本不符必須停止 Agent 接入，
保留手動畫面，不在 mismatch 時執行工具。發布前確認靜態 cache 與舊分頁的更新方式。
發布時備份匹配的兩組前端資產及受影響部署設定，並要求現場完整重載。
Stage Web 不改版、不發布，其後續接入不綁定這次發布。

回退是還原上一組相容資產與原先必要的部署設定；不是新增 runtime native fallback。
本次預期無 DB migration，因此不引入資料結構回退。實作期間不建立 commit。

## 完成條件

未啟用 WebMCP 的一般瀏覽器，可由 Kiosk 頁面在本機 Order Menu 完成查詢、點餐與模擬結帳；Jev、Main、
觸控三條路徑共享原有授權與狀態。舊頁／錯頁訊息不能執行操作或影響新訪客。
整合測試、相關 package checks 通過，並清楚列出未驗證的 live provider／實機項目。
原生接入已從本次產品路徑移除，第三方瀏覽器控制仍明列為獨立工作。
上述功能對接表必須逐項有測試證據；未完成的 combo、多步驟、推薦或狀態同步
驗收不得以「新連線可用」取代。只有計畫文件更新不代表已通過實機驗收。
