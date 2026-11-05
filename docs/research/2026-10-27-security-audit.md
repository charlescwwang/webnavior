# Webnavior 資安盤查與修補順序（2026-10-27）

狀態：使用者後續指定撤回測試登入與開發註冊新增的限制，資安套件更新保留；付款與訂單防護保留，並依2026-10-28要求納入分批commit。修補已上板；基準為bf14000，提交結果見文末。下方原始盤查保留當時證據，實作結果見文末。這不是完整滲透測試，也不能據此判定是否曾遭入侵。

## 與近期 PHP／Brotli 事件的關係

使用者記得事件疑似從PHP開始。官方10/21公布PHP2Shell兩個PHP核心漏洞；10/26又公布PHP Windows套件的Brotli修補。Node.js同期也發布包含Brotli CVE-2026-111497的安全版。這些事件可能是使用者記憶的來源，不能只憑描述確定。

本專案找不到PHP／Composer來源，這個Nginx站點也沒有PHP fastcgi設定；目前API與Bridge使用Node.js。因此PHP核心漏洞不是目前專案已確認的直接路徑，但Node內建Brotli需要更新。

官方依據：[PHP公告](https://www.php.net/archive/2026.php#2026-10-21-5)、[Node.js十月安全公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)、[Node24.22.1修補版](https://nodejs.org/en/blog/release/v24.22.1)。

## 已確認的優先項目

| 優先 | 證據與風險 | 建議調整 |
| --- | --- | --- |
| P0：公開測試登入 | 執行中API為NODE_ENV=development，WEBNAVIOR_TEST_AUTH_ENABLED=true。獨立未登入Chrome從公開HTTPS讀取test-auth狀態回200／enabled:true。程式只查Email對應的未封鎖使用者，接著直接建立其session，未要求密碼或Email驗證 | 先確認正式管理員登入可用，再關閉公開測試登入、取消production測試身分捷徑。優先在公開代理阻擋測試登入路徑；保留必要的正常管理登入與已註冊設備流程。檢視既有session／登入紀錄後決定撤銷可疑session，不任意清除所有機台憑證 |
| P0：Node安全更新 | 以實際服務MainPID所用執行檔確認，API與Bridge均為Node24.13.0，內建Brotli1.1.0、Undici7.18.2、OpenSSL3.5.4。官方24.22.1包含本月Brotli、DNS、TLS與信任根等安全修補 | 在同一24.x支援線升級至至少24.22.1或更新已核對的安全版，驗證官方校驗／簽章、保留舊runtime可回復，分別確認API及Bridge程序真正換版。同步修正部署腳本固定的24.13.0，避免下次安裝又降回舊版 |
| P1：開發設備註冊 | 執行中KIOSK_DEVELOPMENT_REGISTRATION_ENABLED=true且NODE_ENV=development；程式因此掛載開發註冊。registrationCode只驗證六位數格式，service以其命名建立development設備，並非驗證一次性註冊邀請 | 公開環境改用經管理員核准、限時、一次性且綁Site的註冊。先核對現有development設備與Profile如何轉入正式流程，再停用入口，避免把現場機台鎖在註冊畫面 |
| P1：HTTP與認證依賴 | API／Bridge實裝Hono4.11.3及@hono/node-server1.19.14；Server實裝better-auth1.5.6。npm公告包含Hono bodyLimit未知長度／chunked請求繞過、Better Auth登入／OAuth多項問題 | 協調升級catalog、lockfile與相關插件；依本輪公告彙整，Hono修補門檻至少4.13.7、Node adapter至少1.19.15、Better Auth至少1.6.22，實作時再核對當時最新公告。這是公告門檻，不是已驗證相容組合。補chunked／未知Content-Length的限制測試，以及登入、登出、Email驗證、magic-link、OAuth／PKCE與跨Site權限測試 |
| P1：POS寫入邊界，接正式收款前必做 | 公開/menu-api代理到Bridge。Bridge的/v1主要只有CORS，付款、桌位與送單路由沒有呼叫者身分guard。環境明確指向本機5171模擬POS，付款預設authorized；目前不能把模擬授權當成真實扣款 | 保持公開菜單查詢可用，將寫入綁到已驗證的機台／店別／訂單短期授權；伺服器依真實菜單重算份數、選項、總額，不能只信任瀏覽器總額。正式付款以供應商查詢／簽章回呼確認，綁定同一訂單金額與幣別、限制付款重用；保留現有冪等與uncertain封鎖 |
| P2：開發工具 | 實際測試使用Vitest4.1.4，命中Browser Mode檔案存取等公告；目前未見Vitest測試伺服器對外常駐 | Vitest及其browser／coverage／mocker套件一起升到相容修補版，本輪公告最低彙整門檻4.1.11。測試API固定loopback，測試後關閉，不把測試server經Nginx／Tunnel公開 |
| P2：同主機與服務隔離 | Webnavior API、Bridge、Redis6379與Postgres5434均綁loopback；但同機其他專案Postgres5432／5433、pgAdmin5055等對所有介面監聽。沒有測試外網是否實際能連入 | 與各服務擁有者核對防火牆、Docker發布埠與VPN／來源限制；不能因0.0.0.0就斷言外網可達。Webnavior改用專屬服務帳號、最小檔案權限及受測的systemd限制，減少單一服務受侵後接觸同帳號開發資料的範圍 |

P0/P1/P2是本次處理順序，不是每項公告的CVSS評分。此輪沒有呼叫測試登入建立session、註冊設備、建立付款／訂單，或對線上送出漏洞利用payload。

相關程式位置：

- `apps/server/src/routes/auth/test-auth.ts`：測試登入開關及session建立。
- `apps/server/src/app.ts`：development註冊掛載、Hono bodyLimit與音訊gateway。
- `apps/server/src/services/domain/kiosk/index.ts`：development設備建立。
- `apps/server/src/libs/auth.ts`：已啟用magicLink與oauthProvider；部分上游漏洞另有前置條件，需逐項判斷。
- `apps/order-menu-server/src/app.ts`、`src/domain/bridge.ts`：CORS、付款與送單驗證邊界。
- `apps/order-menu-server/src/bin/run.ts`：模擬付款環境與loopback配置。
- `scripts/deployWebUbuntu.sh`：固定Node24.13.0版本。

Hono參考：[bodyLimit公告](https://github.com/honojs/hono/security/advisories/GHSA-9vqf-7f2p-gf9v)。上一輪有Content-Length的413探測通過，不等於未知長度或所有handler的body-limit安全性已驗收；本次沒有對線上重現繞過。

Better Auth參考：[magic-link／email-OTP帳號預先註冊問題](https://github.com/better-auth/better-auth/security/advisories/GHSA-qq9h-g4jm-xgf3)、[cookie state／PKCE條件](https://github.com/better-auth/better-auth/security/advisories/GHSA-wxw3-q3m9-c3jr)。不能把有安裝就當成每個OAuth漏洞都能觸發；此專案使用database state、Email驗證等既有保護仍需保留。

Vitest參考：[Browser Mode權限繞過](https://github.com/vitest-dev/vitest/security/advisories/GHSA-p63j-vcc4-9vmv)、[mocker檔案讀取](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9)。

## npm掃描證據與解讀

本輪直接使用npm官方registry執行`pnpm audit --prod --json`及`pnpm audit --json`，沒有audit --fix、安裝或變更lockfile。第一次受限網路查詢未完成，另一次不支援的fetch參數未產生報告；下列只採用成功取得advisories的live報告。

| 掃描範圍 | Critical | High | Moderate | Low | advisory記錄／不同URL |
| --- | ---: | ---: | ---: | ---: | ---: |
| 全workspace宣告的prod依賴 | 10 | 144 | 187 | 37 | 321／264 |
| 含開發與建置的全workspace | 19 | 206 | 237 | 51 | 425／318 |

上表保留pnpm metadata原始計數，包含不同版本與相依路徑，並不是現場點餐站的可利用漏洞數。prod圖甚至經Better Auth的peer路徑列到Vitest；手機Capacitor、其他服務與未啟動的工具也在整個monorepo中。尚未逐條判定全部公告的可達性。

另外查到Server的OpenTelemetry依賴鏈包含protobufjs7.5.4，命中動態schema相關高風險公告；目前沒有證據顯示顧客輸入可控制其protobuf定義。應隨擁有此依賴的上游套件升級，而非以audit數字直接宣稱可遠端執行程式。參考：[protobufjs公告](https://github.com/protobufjs/protobuf.js/security/advisories/GHSA-xq3m-2v4x-88gg)。

原始證據留在本機：

- `/tmp/webnavior-security-prod-live-20261027.json`
- `/tmp/webnavior-security-all-live-20261027.json`

## 實作與驗收順序

1. 備份設定，確認正式管理員認證與既有設備可用；封住公開測試登入／註冊。檢視是否曾有異常登入、設備或provider使用，再依證據撤銷session／輪替相關憑證。
2. 保留回復版本，更新Node24.x與部署安裝版本；依賴按Hono／Better Auth／測試工具分批更新，不一次無差別升級全部套件。
3. 本機先跑失敗重現與受影響套件測試。保留既有完整語句辨識、份數更正、Menu連線恢復、付款結果不明不重送等保護；新增未登入寫入拒絕、跨Site／跨訂單拒絕、逾期與重播、伺服器金額計算、chunked上傳限制測試。
4. 在正式付款接入前完成Bridge寫入驗證；對ASR／LLM／上傳加依device／Site的配額、併發及合理限流。限流需支援合法多片音訊，不用共用IP把整間店互相封鎖。CORS不能取代伺服器身分與權限檢查。
5. 選無進行中交易的時段配套上板，確認API／Bridge程序真的使用新runtime。驗收登入、既有機台、新設備註冊、長語音、購物車、付款與對帳；失敗依備份回復。
6. 補持續的依賴／secret／靜態分析檢查與修補時限，供應鏈使用固定lockfile、核對發布來源、限制安裝script；已有onlyBuiltDependencies白名單，應保持精簡。不要讓未解決的既有Lint錯誤掩蓋新增安全問題。

原始唯讀盤查未執行一般測試；後續修補的驗收如下。npm audit的非零退出碼代表掃描仍發現問題，不能當作修補驗收已通過。

## 第一批修補與上板結果（原始上板紀錄；登入／註冊已依下節撤回）

- 公開配置不再允許測試Email登入、測試Bearer身分或六位數開發註冊，即使開發旗標仍誤設true也會拒絕。現有device credential保留，關閉註冊後仍可bootstrap；沒有建立正式環境測試session或新設備。
- Node從24.13.0更新至24.22.1，官方HTTPS checksum manifest的SHA256核對通過，沒有宣稱GPG簽章驗證。兩個服務的實際Node程序均需核對，不能只看shell版本。Brotli變為1.2.0、Undici7.30.1、OpenSSL3.5.9。部署與Deb打包腳本、tool-versions及設定文件同步更新。
- Hono4.13.14、Node adapter1.19.17、Better Auth／Drizzle／OAuth1.6.33，Vitest／browser／coverage4.1.12。既有CLI僅更新到其已發布的1.4.22，未假造不存在的1.6 CLI版本。nanoid5.1.16、ws8.22.0、Zod4.6.7同步修補；Server遙測父依賴範圍內鎖定protobufjs7.6.5／8.8.1及gRPC1.14.6。
- Menu私有請求改走同源`/api/kiosk/pos`，沿用HttpOnly機台cookie，前端不持有服務密鑰。Bridge向主API驗證cookie，使用API回傳的Site／device建立所有權；未認證／失效／認證服務不可用分別拒絕，不相信瀏覽器宣稱的Site或device。公開菜單與既有continuation bearer流程保留。不同localhost開發埠支援明確的本機政策，公開部署僅允許其精確Origin。
- 付款與桌位歸屬綁定機台，送單驗證真實菜單的選項、單價、份數、份數合計及總額。拒絕同一key換內容、同一付款跨key送單，也覆蓋同時到達的請求。網路失聯保留uncertain及付款claim，不自動再送單。
- 1MiB音訊限制保留。未知Content-Length的串流ASR超限測試回413，不呼叫Provider；本輪未把限制調高。既有整句音訊切片、購物車與恢復流程保留。

驗收：Menu757、Kiosk249個單元測試；Chrome61個通過／2個略過；Bridge42加憑證gateway2個測試；Server認證／body-limit／origin39個與Kiosk路由61個測試通過。Server、Bridge、Menu、Kiosk、Web的package typecheck、受影響TS的ESLint及三個前端build通過。root typecheck未執行，沒有建立commit。測試略過項目保留原本env／硬體等條件，不宣稱全部測試均已執行。

獨立Chrome從公開HTTPS確認：test-auth狀態enabled:false；測試session及開發註冊404；未登入的proxy付款、直接Bridge付款與送單401；兩個入口均讀到7道菜單。只以空物件測試拒絕，沒有線上付款／送單。三個前端66個JS／CSS資源SHA256與本機build一致。API loopback readyz的DB／Redis均ok，Bridge health為ok。現有23個未撤銷機台憑證保留；真實機台／正式管理員的登入仍須現場驗證，沒有代用管理員身分進入。

回復點：`/tmp/webnavior-security-repair-20261027-f7gtcwga`，含受限權限的設定、可列出內容的pg_dump、三個站點舊資源、來源snapshot與patch、版本及公開驗收紀錄。舊Node目錄保留。系統restart曾逾時；在確認服務屬aimax、Restart=on-failure、KillMode=control-group且近15分鐘無顧客互動後，單次結束該服務launcher，讓systemd清理整個group並重新啟動。最終應以release.json與實際程序核對狀態。

## 尚未完成與接續範圍

- `/etc/webnavior/server.env`仍需具sudo權限者改為production並關閉兩個開發旗標；目前`sudo -n`要求密碼，沒有改權限繞過。公開入口已由程式配置政策封鎖。服務帳號隔離、防火牆及其他專案的公開DB埠也未擅自更動。
- 公開開發註冊已關閉，新機的正式、一次性、綁Site管理員核准流程尚未建置。這是新的受控註冊功能；既有機台不用重新註冊。沒有清除全部使用者session或輪替全部device credentials；仍需用登入／操作證據審查既有session與設備，不能只因入口已關閉就假設所有舊session安全。
- Bridge仍為測試模擬POS，所有權、付款claim與冪等紀錄在記憶體中。正式金流前必須持久化這些狀態、加入供應商實際查詢／簽章回呼與幣別綁定，驗證重啟及失聯對帳；目前不可宣稱已支援安全的真實扣款。
- 按device／Site的AI費用配額、併發限制，以及持續依賴／secret／靜態分析CI尚未新增；不能用IP共用限流破壞合法的多段音訊。
- 最後`pnpm audit --prod`全workspace仍有critical9／high124／moderate150／low33；原始報告`/tmp/webnavior-security-prod-completed-20261027.json`。Server路徑剩OTel SDK／Prometheus／Jaeger公告及Better Auth的測試peer鏈帶入的Undici／Vite／ws，後者不是Server直接使用的新ws。現場未配置Prometheus HTTP exporter或JaegerPropagator；仍應由遙測套件一起升級並驗證。其他未部署app／工具需另按所有者與可達性處理，不能把本輪說成全monorepo漏洞清零。

## 使用者指定的登入／註冊回復（2026-10-27）

使用者明確要求「測試登入、機台註冊撤回；套件更新如果是因為資安就更新」。因此只撤回新增的public-origin身分限制，不撤回Node或資安套件升級，也不撤回目前付款、機台所有權、訂單驗算及防重送。付款與訂單檢查已以操作例子說明，尚無撤回授權。

Email測試登入及六位數開發註冊恢復原本的明確旗標與非production條件，TEST_AUTH_TOKEN恢復原先比對規則。公開API_SERVER_URL不再額外關閉這些測試流程。這是使用者選擇保留的測試行為，不能再把首批上板的404記錄當成目前狀態，也不要自行關閉旗標、清除session或撤銷機台憑證。

先以回復預期新增測試，重現enabled:false與預期true不符；撤回後31個app／request-auth／origin測試、Server package typecheck通過。音訊未知長度413測試保留。以空物件驗證註冊／登入路由可達但驗證400，不建立正式環境session、device、payment或order。此回復不更動資料庫、環境檔、套件版本或前端資源，無須重建前端；既有頁面重新整理即可讀取回復後的測試登入狀態。

另補上必要的回復連動檢查：付款的身分驗證改用唯讀`/api/kiosk/identity`，不呼叫會自動替換舊development機台的bootstrap。PGlite測試建立舊Site的合法device credential，確認身分查詢維持原device／Site、不發新cookie、不新增device；避免重開開發註冊後，付款驗證意外觸發重新註冊。bootstrap原本的機台啟動行為保留。

回復已上板並由獨立Chrome驗收：test-auth enabled:true；空白測試登入／註冊資料400；未登入付款401；菜單7道正常。API與Bridge實際Node24.22.1保留。回復checkpoint見`/tmp/webnavior-current-development-restoration-path`，內有source patch與public-check.json。新增連動驗證3個Kiosk route cases及Bridge44個測試、兩個Server package typecheck與受影響lint通過；未執行root typecheck，未commit。

## 2026-10-28 分批提交

使用者確認已上板、尚未提交的變更應分批commit。依可獨立理解的範圍整理：

| Commit | 白話說明 |
| --- | --- |
| `1a046a8` | 更新Node安全版本、下載檔校驗與安裝設定文件 |
| `283a298` | 更新認證／網路等既有安全套件，保留登入註冊規則與串流音訊413回歸測試 |
| `6af4536` | 付款確認機台身分，核對餐點金額並防止重複送單，附測試與使用設定 |
| 文件批次 | 記錄實際上板、登入／註冊回復、驗收與尚未處理範圍 |

提交前依`.github/CONTRIBUTING.md`執行一次全專案typecheck，通過。Server相關31、Bridge44、Menu757個測試通過；受影響檔案的ESLint及shell語法檢查通過。全專案lint仍未通過：首次報2371個錯誤，其中本批唯一受影響檔案錯誤為pnpm-workspace.yaml的key排序，已修正並由scoped lint及正常pre-commit hook驗證。其他既有錯誤留待其所屬範圍處理，不能聲稱全專案lint已通過。

整理差異時移除app.test.ts等檔案無關的換行格式噪音、兩處重複解構別名警示，並保留當時Windows實測Node24.13.0的歷史紀錄，另註明目前專案要求24.22.1。沒有再更動登入／註冊政策、更新套件、重部署或重啟服務；本次僅記錄已上板變更，未push。
