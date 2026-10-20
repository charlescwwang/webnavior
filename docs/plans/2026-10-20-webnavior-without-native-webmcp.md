# Webnavior 移除原生 WebMCP 依賴

日期：2026-10-20。分支：`no_mcp`。狀態：規劃完成，尚未實作或部署。

## 目標與範圍

自有 Order Menu 在沒有 `document.modelContext`、沒有 WebMCP Origin-Trial
及專用瀏覽器旗標的環境中，仍能接受 Kiosk／Stage Web 的工具探索與呼叫。
Jev、Main Agent、工具參數與結果、菜單／購物車狀態、確認及付款授權規則保持一致。

本次處理可修改並配合接入的互動服務。無法修改的第三方網站控制仍依
`2026-10-18-webnavior-routing-and-browser-control.md` 另行選型。
不建立 Server 上的隱藏瀏覽器，不把 UI 狀態搬到 Server，不新增付款能力。

## 現有可沿用的 seam

- `packages/stage-ui/src/services/webmcp-adapter.ts` 集中 discovery、health、
  tools、execute、執行事件、完成 revision 與 readiness。
- `apps/order-menu/src/webmcp.ts` 已提供 `toolDefinitions`、`invoke`、
  `invokeForAgent`；原生註冊只是其中一個入口。保留這些業務決策與驗證。
- `ScenarioSurface.vue` 與 Stage Web 的 `OrderMenuPanel.vue` 已掌握 iframe
  Window；新的連線必須接收該 Window，不能只靠 origin 尋找頁面。
- `scenario-registry.ts` 與 `interactionLifecycle.ts` 已有來源視窗、origin
  與完成事件驗證。沿用既有責任，不為換傳輸層重寫導覽及生命週期通報。

## 通訊選型

依 AGENTS.md 的 Eventa 規範，優先沿用 workspace 的
`@moeru/eventa@1.0.0-beta.8`；實作前由使用者確認以下選型。

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
共用 interactive service client（Vue 狀態與既有 host interface）
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
命名。保持現有 consumers 需要的 tools、availability、execute、onExecution、
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
7. **完成事件**：保留觸控操作的 lifecycle 通報及 Agent 工具完成結果。
   驗證兩路同時到達時，不會重複結束訪客 session、重複顯示回饋或重複重設。
8. **無協定頁面**：iframe 仍可顯示及手動操作；有限等待後顯示未提供 Agent 接入。
   不宣稱單純換傳輸層就能操作未接入的第三方站。

## 分階段實作與驗收

### 1. 先證明已安裝 Eventa 能承接需求

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

### 3. 接回 Kiosk 與 Stage Web

替換共用 client 與兩個 host 的 singleton／工具 mapper；修改 `ScenarioSurface.vue`
及 `OrderMenuPanel.vue` 傳入精確 iframe Window。更新 readiness 提示及相關 i18n。
KioskScene、customer entry、模擬 ASR、執行進度、工具回執與完成通知沿用原 interface
語意，避免在大型場景檔案加入傳輸細節。

以明確名稱替換受影響的 WebMCP adapter／type／factory，移除原生實作，不保留
native fallback 或雙路自動切換。既有工具名稱、資料契約及持久化資料不因命名整理改版。
Order Menu 的大型 `webmcp.ts` 若改名為 `menuRuntime.ts`，只同步相關 imports，
不順便重拆點餐邏輯；歷史文件與無關產品的 WebMCP 不作全 repo 字串清除。

### 4. 整合回歸與移除部署依賴

測試優先順序：新協定與實際 runtime → Kiosk 流程 → 真實跨來源 browser flow。
涵蓋：

- 推薦／價格查詢／繼續與重設、選項與數量、加購／改購／移除。
- Jev host-only context 與執行、Main Agent 工具執行、模擬 ASR、手機輸入。
- 確認／拒絕、取消、模擬付款 pending／uncertain／accepted，及完成與新一輪。
- 錯 origin、錯 Window、同 origin 多 iframe、舊 connection、未知工具、非法 input。
- iframe 重載／切服務、catalog 延遲、連線失敗、工具執行中斷線與晚到結果。
- 原生 WebMCP 不存在的瀏覽器仍完成整條點餐路徑。

沿用 repo 的 Vitest 與 browser 設定，實作前先核對 package scripts。只跑受影響的
unit/browser suites、package-scoped typechecks、changed-file lint，以及
Order Menu／Kiosk／Stage Web 的相關 production builds；不自動跑 root typecheck。
真實 Jev／Main endpoint 測試依 env guard 執行，未跑須明列；本計畫不授權部署或真實付款。

檢查受影響 iframe 的 `allow="tools"`、Origin-Trial 注入、啟動旗標及測試 harness。
先證明無原生依賴可用，再移除這條產品路徑的專用設定。
Nginx live 設定與瀏覽器啟動器不一定在 repo，須在發布準備時核對實際來源，
不能僅以 repo 搜尋未找到就宣稱已清除。

更新 Order Menu、Kiosk、Stage Web 的相關 README、部署文件、`CONTEXT.md`
中受影響術語與簡短 handoff；先前已存在的第三方控制計畫只補上與本方案的範圍關係。

## 發布與回退

Kiosk、Stage Web 與 Menu 是協定相依的一組產物。版本不符必須停止 Agent 接入，
保留手動畫面，不在 mismatch 時執行工具。發布前確認靜態 cache 與舊分頁的更新方式。
發布時備份匹配的三組前端資產及受影響部署設定，並要求現場完整重載。

回退是還原上一組相容資產與原先必要的部署設定；不是新增 runtime native fallback。
本次預期無 DB migration，因此不引入資料結構回退。實作期間不建立 commit。

## 完成條件

未啟用 WebMCP 的一般瀏覽器，可在自有菜單完成查詢、點餐與模擬結帳；Jev、Main、
觸控三條路徑共享原有授權與狀態。舊頁／錯頁訊息不能執行操作或影響新訪客。
整合測試、相關 package checks 通過，並清楚列出未驗證的 live provider／實機項目。
原生接入已從本次產品路徑移除，第三方瀏覽器控制仍明列為獨立工作。
