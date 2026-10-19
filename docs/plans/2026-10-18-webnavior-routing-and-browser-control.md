# Webnavior 入口、登入復原與第三方網頁操作

日期：2026-10-18；登入復原於 2026-10-19 依使用者要求修正。入口與登入修正已於 2026-10-19 部署至公開環境；瀏覽器控制為待選型規劃。

## 環境檢查

- Stage Web 開發埠為 5167，API 為 5168，Nginx 公開入口為 5169。
- `apps/stage-web/.env.production.local` 與 Kiosk 正式環境檔均指向
  `https://webnavior.aikcitri.qzz.io`；API 本機覆寫亦使用此網域。
  此結論是檔案檢查，不代表已核對執行中程序的全部環境。
- 2026-10-18 公開 HTTPS GET/HEAD 檢查：根路徑回應 `302 /kiosk/`。
  公開 admin 入口 bundle 也已有 `/` → `/kiosk/`，未發現 AIRI API 網域字串。
- `/etc/nginx/sites-enabled/airi-web` 已有相同根目錄規則；版本庫原本的
  `scripts/deployWebUbuntu.sh` 缺少這條規則，本次補齊以防重新設定時遺失。
- HEAD 的 Stage Web 路由原先明確將 `/` 轉至 `/admin`；既有未提交修改
  已將其改成 Kiosk，並排除根路徑的 PWA navigation fallback。本次保留。
- 若特定瀏覽器仍跳 admin，下一步應記錄實際 origin、Service Worker controller、
  入口 JS hash 與 navigation redirect chain；目前不能把快取推測當成已重現原因。
  更新 SW 的排除規則不會立即移除瀏覽器既有的舊 SW。
- Stage Web 缺少 `VITE_SERVER_URL` 時已有設定錯誤頁，且延後載入 API 使用者。
  共用 `libs/server.ts` 仍有 AIRI API 預設值，其他 host 必須另行檢查其建置設定。

## 入口與登入契約

`/` 為顧客 Kiosk 入口，管理人員從 `/admin` 進入。API 的 401 在一次既有
refresh 復原失敗後，Webnavior 清除失效憑證並自動開始 OIDC，導向自己的
`/auth/login` 管理登入頁。登入成功後回到原管理頁。
403、5xx 與網路錯誤交由原頁顯示，不作為切換應用的理由。

沿用共用 Auth Store 的 `needsLogin` → `triggerSignIn` 流程，Server 的
`/auth/sign-in` 保留 OIDC 參數後導向本機 `/auth/login`。不可直接跳到缺少 PKCE
參數的裸登入網址。已移除先前誤加的留頁提示與自動登入停用政策。
Kiosk device auth 不在本次修改範圍。

OIDC flow 在同一份 sessionStorage PKCE 記錄保存原路徑；不傳給 provider。
callback 先驗證 state、交換 token 並確認 session，再還原本機路徑、query 與 hash。
外部 origin、協定相對網址、auth 路徑或缺少記錄時返回 `/admin`，避免登入迴圈。
既有其他平台 callback 不變。沒有取得 session 時顯示 callback 錯誤。

驗收：401 且 refresh 失敗時進入 Webnavior 管理登入頁；403/500/502 不啟動登入；重新登入回原店別頁；
OIDC callback 錯誤停留錯誤頁；全新瀏覽器與既有 SW 瀏覽器的 `/` 都應到 Kiosk。
單元測試涵蓋登入啟動、API status 與 return path。2026-10-19 部署後已確認公開根路徑載入新版 Kiosk 資產，Kiosk 設備設定頁與獨立菜單可在瀏覽器開啟；真實登入、既有 SW 瀏覽器及語音流程仍待驗收。

## 不依賴 WebMCP 的第三方操作

目標網站：<https://maifood.tw/damai/Derek1/menu?table=12641>。
唯讀 GET 可取得「大麥智能餐飲」HTML，未找到 `modelContext`、`registerTool`
或 `webmcp` 字串；這不證明執行時完全沒有工具，也不構成 iframe、購物車或結帳驗證。
本次沒有操作購物車、送出訂單或付款。

目前 Kiosk 的第三方 iframe 顯示與 Agent 操作是兩種能力：一般父頁無法直接讀取
跨來源 iframe DOM。停用 WebMCP 不能讓既有 Agent 自動取得第三方頁面的控制權。
既有 `webmcp-adapter`、Fast Path 與 owned Menu 的語意快照不能冒充第三方事實。

先比較下列候選方案，待使用者選型後才引入依賴或實作 production bridge：

| 方案 | 與目前環境的關係 | 主要驗證成本 |
| --- | --- | --- |
| Chrome 擴充套件 | 保留現有 Chrome Kiosk；可研究既有 `plugins/airi-plugin-web-extension`，其現況為 context/subtitle 擷取，尚無點餐執行器 | 網域與 frame 授權、tab/session 綁定、套件部署更新、真實觸控與 DOM 操作 |
| Electron `WebContentsView` | 以受控遠端頁面承載第三方站；需確認既有桌面工程能否承接 Kiosk | 桌面發布維運、遠端內容隔離、觸控、相機音訊與 session 所有權 |
| 本機 Playwright/CDP companion | 可連至受控 Chromium，適合評估或執行器候選 | 與顧客所見頁面是否同一 session、連線隔離、斷線復原；CDP 連線能力低於 Playwright 原生協定 |

建議先做同一台現場裝置的唯讀可行性比較：確認實際登入／桌號、讀取可見菜單、
識別規格及購物車、確認能由受控通道觀察顧客正在操作的同一頁面，再決定框架。
不得以 Server 上另一個隱藏瀏覽器的狀態冒充顧客螢幕。

接續分四個驗收單位：

1. **讀取**：可見品名、價格、規格、售罄及購物車；每次觀察綁定 device、visitor
   session、tab/frame、navigation generation 與時間。不可見／不確定則回報 unknown。
2. **可逆操作**：在測試店或經確認的測試環境新增／調整／移除購物車，逐步觀察結果。
   元件重排、DOM 過期、手動觸控介入、timeout 後重新讀取，禁止盲目重放寫入。
3. **語音接合**：保留 Jev 的 recipient 與有限意圖辨識、Main Agent 的規劃；將執行
   接到實際頁面觀察／操作邊界。第三方沒有穩定語意快照時，重新定義候選與驗證，
   不沿用 owned Menu 的真實 item ID、revision 或確認紀錄。
4. **結帳**：獨立驗證確認、付款與完成證據；沒有明確回執不得宣稱完成。
   不沿用自有 POS simulator 的支付結果。確認前不觸發不可逆訂單／付款。

維持既有自有菜單測試直到第三方方案驗收完成，但第三方目標不以 WebMCP 為依賴。
本文件尚未選定工具，也未宣稱第三方操作已可用。

官方依據：

- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)：DOM 存取、isolated world 與 host permission。
- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)：受控頁面容器。
- [Playwright CDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)：連線方式及相較原生協定的限制。
