# 手機上的外部點餐 iframe：控制方式與替代架構

日期：2026-10-29。範圍：普通客人手機開啟我們的網站，網站內嵌 PB 頁面；客人已登入我們網站，期望系統代填營運方的共用帳密。本文是官方文件研究，沒有宣稱 PB 已提供登入 API，也沒有選定、安裝或部署任何新依賴。下方另記錄當日 PB 登入前實測，與官方文件推論分開。大麥已由使用者排除，不列入本研究範圍。

## 判斷方式

「外部網站可以被自動操作」與「外層網頁有權操作 iframe」是兩個問題。前者可由瀏覽器控制工具完成；後者取決於同源、接收端合作或額外執行權限。同源比較 scheme、host、port，與是否手機、是否遠端 Server 無直接關係。跨來源的 `Window` 存取受限，但仍有 `postMessage` 溝通入口。[同源政策](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)

現有 Kiosk 自家 Order Menu 走 Eventa `window-message`：參見 [client](../../packages/stage-ui/src/services/interactiveServiceClient.ts) 與 [README](../../apps/stage-kiosk/README.md)。PB 的 CDP 可行性實驗是另一條路；它不能自動證明普通手機頁面已獲得控制權。

## 候選方式

| 方式 | 手機免安裝 | 能否保留手機直接載入 PB iframe | 現況與待驗證事項 |
| --- | --- | --- | --- |
| PB 接收網頁指令／短效登入串接 | 可以 | 可以，仍須符合 PB 嵌入與 Cookie 條件 | 需要 PB 實作或確認已存在的介面；目前沒有其支援證據 |
| 伺服器受控瀏覽器＋遠端畫面及輸入 | 可以 | 改成遠端瀏覽器畫面，可仍包在我們網頁裡 | 官方已有 browser-only 遠端桌面技術；PB、觸控、輸入法、付款及併發須另實測 |
| 反向代理並改寫／加入橋接 | 可以 | iframe 改為我們提供的代理 URL | 登入前頁面操作的隔離原型已通過；真正登入與完整流程未驗證 |
| 手機原生 App 的 WebView 注入 | 需要安裝 | 改在我們管理的 WebView 裡 | 可用平台 API；不是必須 Electron，也不是一般網頁自行獲得權限 |
| 瀏覽器擴充功能／使用者腳本 | 需要安裝支援環境與授權 | 可在符合權限的 frame 內操作 | 須逐瀏覽器驗證，不能假設 LINE 內建瀏覽器有相同能力 |
| 手機遠端除錯／CDP | 需要事先開啟及建立除錯通道 | 控制已連線的手機瀏覽器 | 適合受管理測試設備，不符合普通客人單純掃碼的既定流程 |

### 接收端合作

`postMessage` 傳送的是資料，不是自動授予 DOM 權限；對方要註冊 listener、驗證來源並執行允許的操作。已有這種接收程式時，網頁端工具呼叫不需要 Electron 或 CDP。登入介面亦可由廠商設計，但不能由通用文件推定 PB 有 SSO/API。[MDN postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)

### 伺服器瀏覽器

Playwright 可啟動或連接受控瀏覽器；`connectOverCDP` 是附著既有 Chromium 的能力，不是向任意網站訪客自動取得權限。[Playwright BrowserType](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)

Apache Guacamole 官方展示無外掛、無客戶端安裝的 HTML5 遠端桌面，證明「手機網頁呈現遠端受控環境」有既有技術路線。這裡只列候選，沒有決定採用它。依此架構推論，PB 可以在伺服器瀏覽器中登入，由使用者及 Agent 操作同一個遠端 session；需實驗每位訪客隔離、延遲、觸控、中文輸入、斷線復原及登入／付款跳轉，不能把可傳畫面當成完整點餐驗收。[Guacamole 官方](https://guacamole.apache.org/)

### 反向代理

NGINX 具備 upstream 代理、redirect、Cookie domain/path 改寫，以及 response 字串替換功能。[proxy 模組](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)、[sub 模組](https://nginx.org/en/docs/http/ngx_http_sub_module.html)

依這些能力可提出另一個待驗證方向：把廠商頁面完整轉送至我們控制的來源，並在代理後文件加入明確的操作橋接。它不等於控制原始跨網域 iframe；SPA 的絕對 API URL、動態 JS、資源、導向、Cookie、CSP、Origin／CSRF 驗證及 OAuth 都可能需要適配。通用代理功能不足以證明 PB 可用，必須從登入前頁面做獨立實驗，不改正式 Kiosk 設定。避免把外部程式直接併入我們主要登入來源；若採專用隔離來源，可在其內注入接收指令的橋接，再由外層用訊息控制。正式橋接仍是設計候選；下方同源原型只驗證公開登入頁的欄位操作。

單獨在 Server 登入也不會自動讓手機的原始 PB iframe 登入；Cookie 有 domain 限制，我們來源不能任意替 PB 來源設定 Cookie。[Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)

### 擴充、原生 App 與除錯

Chrome content script 可對符合 URL 規則的 frame 注入；需要擴充功能與對應權限，不是網頁的標準能力。官方 `all_frames` 指的是逐 frame 匹配，不能理解成自動取得任意 iframe 權限。[Content scripts manifest](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)

Android WebView 提供 `evaluateJavascript`，iOS `WKUserScript` 可指定所有 frame 注入。這些屬於我們管理 App／WebView 的功能；普通網站不能向客人的 LINE 或 Safari 要求同等權限。[Android WebView](https://developer.android.com/reference/android/webkit/WebView#evaluateJavascript(java.lang.String,%20android.webkit.ValueCallback%3Cjava.lang.String%3E))、[Apple WKUserScript](https://developer.apple.com/documentation/webkit/wkuserscript/isformainframeonly)

Android Chrome 官方遠端除錯流程需要開發者選項、USB debugging 與裝置連線／授權。這證明手機可以在特定設定下被控制，也說明「手機不能自動化」過度籠統；但它不符合普通客人單純開網頁的使用條件。[Chrome Android 遠端除錯](https://developer.chrome.com/docs/devtools/remote-debugging)

## 後續實驗邊界

先記錄普通 parent-page JS、瀏覽器自動化工具、手機尺寸模擬及真實手機各自的結果。模擬尺寸成功不等於真實手機已部署控制管道。若原始跨域 iframe 路徑不通，仍可實驗代理橋接或遠端瀏覽器，而非直接宣稱整個產品目標無法達成。若要實作上述候選，依專案規則先讓使用者選擇技術方向與依賴；本文沒有選定方案。

## 2026-10-29 PB 登入前實測

使用獨立、可見的 Chrome 156.0.8078.48，分別以桌面與 Pixel 7 尺寸／觸控模擬測試。這不是 Android／iPhone 實機或 LINE 內建瀏覽器驗收。測試只使用假的 `example.invalid` 帳號，不按登入，不建立購物車，不送單、不付款，也不讀取私人瀏覽器 Profile。

| 測試 | 結果 | 證明範圍 |
| --- | --- | --- |
| 本機測試頁嵌入原始 `https://app.esgpb.com/order/login`，外層 JS 直接填欄位／點按鈕 | 桌面與手機模擬均 `SecurityError` | 此原始跨網域 DOM 操作受瀏覽器阻擋 |
| 同一 iframe，由 Playwright 工具填假帳密、點「記住我」再還原 | 桌面與手機模擬均通過 | PB 能由有控制權的工具操作；不能推定普通手機網頁獲得此權限 |
| 隔離本機反向代理 PB 登入頁與資源，iframe 改載同源代理頁，外層頁面自己的 JS 填假帳密並點勾選框 | 手機模擬三項均通過，記錄中沒有資源 HTTP 失敗 | 至少存在不依賴 iframe 直接工具填寫的網頁方案；不是原始跨網域 iframe，也未驗證真實登入 |

首輪桌面 PB 帳號值在填寫後未保留，密碼與點選則成功；延長頁面初始化等待，並在帳號值未保留時重新填寫後，桌面與手機模擬皆通過。此現象尚未定位根因，不把首輪誤記為全部成功。

代理原型只允許 GET、禁止 POST，改寫回應中的 PB 絕對來源 URL，未轉送原站安全政策標頭。它刻意使用無任何正式登入權限的 loopback 測試來源，不可直接部署到主站登入來源。原型沒有驗證 Cookie 轉送、帳密驗證、CSRF、OAuth、購物車隔離與付款，也不代表上述機制能靠字串改寫解決。

測試產物在 `output/playwright/iframe-probe-20261029/`：`retry-results.json` 是原始 iframe 的補驗結果，`proxy-results.json` 是代理原型結果；`pb-*-filled.png` 與 `pb-proxy-mobile-emulation.png` 為截圖。`results.json` 保留首輪結果，其中包含在使用者排除大麥前已開始的舊測試；後續僅測 PB。重現腳本為同目錄的 `directProbe.cjs`、`proxyProbe.cjs`，腳本以此 checkout 的 Playwright 路徑執行，不是正式產品實作。

依目前證據，不能宣稱「手機產品目標無法達成」，也不能宣稱「代理已可完整登入點餐」。下一個有意義的驗證是選定代理架構後，在隔離環境驗證營運方測試帳號登入與刷新，再驗證多位訪客隔離；真實手機／LINE 環境另驗。
