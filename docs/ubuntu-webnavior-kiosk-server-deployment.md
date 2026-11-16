# Ubuntu WebNavior Kiosk Server 部署

這份文件部署的是目前的 **WebNavior Web、Kiosk 與 `apps/server` API**，不是
原生 AIRI Electron、Godot 或桌面程式。目標是讓同一台 Ubuntu 上已有的服務維持
原狀：沿用既有 PostgreSQL、用 Docker 只建立 AIRI 專用 Redis，並由 systemd 管理
API。

> 不要直接啟動 `apps/server/docker-compose.yml`。它會額外建立 PostgreSQL，且預設
> 對外發布 5435、6379、6112；這不符合「主機已經有 PostgreSQL 與其他服務」的部署
> 情境。

## 目標架構

```text
Browser / kiosk
       |
Nginx :5169  -- static Web / Kiosk / Menu
       |
       +---- /api、/ws/chat ----> WebNavior API (systemd, 127.0.0.1:5168)
                                         |                 |
                                  existing PostgreSQL   Docker Redis
```

Redis 只綁在 `127.0.0.1`，不會被區網或網際網路連入。PostgreSQL 是資料真相來源；
Redis 是必要的 cache、設定 KV 與 Pub/Sub 相依，但不保存唯一正式資料。

## 0. 更新前的安全盤點

在 Ubuntu 上先執行唯讀檢查，記下結果。這一步是為了避免碰到同機其他服務。

```bash
systemctl --type=service --state=running
docker ps
sudo ss -ltnp
git -C /srv/webnavior rev-parse --short HEAD
```

以下範例假設：

- checkout 在 `/srv/webnavior`；請依實際位置替換。
- 部署帳號是 `<deploy-user>`。
- 對外網址是 `https://kiosk.example.com`。
- PostgreSQL 僅供本機連線，且尚未有 `webnavior` 資料庫與角色。

切勿使用 `docker system prune`、`docker compose down`（沒有明確指定 AIRI Redis
專案時）或全域套件升級作為更新步驟。

## 1. 一次性準備 Web 前端與 Nginx

現有 [Ubuntu Web 部署文件](ubuntu-web-deployment.md) 與
`scripts/deployWebUbuntu.sh` 只處理靜態前端與 Nginx proxy；它不會安裝 API、Redis
或 PostgreSQL。首次使用時可依該文件執行：

```bash
cd /srv/webnavior
bash scripts/deployWebUbuntu.sh --setup --origin https://kiosk.example.com
```

這個步驟會安裝 Nginx 與前端建置需求，並寫入 `/etc/nginx/sites-available/airi-web`。
如果此檔案已由其他人維護，先備份並人工合併；不要直接覆寫。之後 Nginx 必須保留
`/api/` 及 `/ws/chat` 到 `127.0.0.1:5168` 的 proxy。

### 已有純前端站的升級方式

若這台 Ubuntu 已依前述 Web 文件運行純前端版本，**不要再次執行**
`deployWebUbuntu.sh --setup`。前端與 Nginx 已是可用基礎；先備份目前設定，確認 proxy
區塊已存在，再從第 2 節開始新增 Redis 與 API。

```bash
sudo cp -a /etc/nginx/sites-available/airi-web \
  /etc/nginx/sites-available/airi-web.before-webnavior-api
sudo nginx -T | less
sudo nginx -t
```

如果現有 Nginx site 沒有下列 location，才人工加入到同一個 `server` 區塊，接著執行
`sudo nginx -t && sudo systemctl reload nginx`：

```nginx
location ^~ /api/ {
    proxy_pass http://127.0.0.1:5168;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

location = /ws/chat {
    proxy_pass http://127.0.0.1:5168;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

`$http_x_forwarded_proto` 適用於 Cloudflare Tunnel 或另一層已傳遞原始 HTTPS scheme 的
reverse proxy。若 TLS 直接在這台 Nginx 終結，請改為 `$scheme`，否則登入 callback 可能
被判成 HTTP。

### 正式網域與 HTTPS

本文件的 `https://kiosk.example.com` 是正式網域範例，不是 `localhost` 或開發網址。
在繼續前必須選擇並完成其中一種 TLS 方式：

1. Cloudflare Tunnel／既有 reverse proxy 將該 HTTPS 網域轉送到 Nginx 的 `5169`；或
2. Nginx 自己監聽 `443`，並已有可續期的 TLS 憑證與 HTTP-to-HTTPS redirect。

網域 DNS、TLS 與轉送完成後，從 kiosk 實機確認 `https://<domain>/kiosk/` 可開啟；
攝影機與麥克風在跨裝置瀏覽器上需要 HTTPS。所有 `VITE_*` 前端 API URL 與第 4 節的
`API_SERVER_URL`、`WEB_APP_URL`、`AUTH_UI_URL`、`ADMIN_UI_URL` 必須使用同一個正式
HTTPS origin，不能沿用開發用 IP、port 或 `localhost`。

## 2. 建立 AIRI 專用 Redis（Docker）

先確認 Docker 已由既有主機管理方式安裝，且 6379 尚未被使用：

```bash
docker version
docker compose version
sudo ss -ltnp | rg ':6379'
```

建立 `/etc/webnavior/redis.env`，權限必須只讓 root 讀取：

```dotenv
REDIS_PASSWORD=請填入一組長且隨機的密碼
```

```bash
sudo install -d -m 0750 /etc/webnavior
sudoedit /etc/webnavior/redis.env
sudo chmod 0600 /etc/webnavior/redis.env
```

建立 `/etc/webnavior/redis.compose.yml`：

```yaml
services:
  redis:
    image: redis:7-alpine
    command: ['redis-server', '--appendonly', 'yes', '--requirepass', '${REDIS_PASSWORD}']
    env_file: redis.env
    ports:
      - '127.0.0.1:6379:6379'
    volumes:
      - webnavior_redis_data:/data
    restart: unless-stopped
    healthcheck:
      test: ['CMD-SHELL', 'redis-cli -a "$$REDIS_PASSWORD" ping | grep -q PONG']
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  webnavior_redis_data:
```

`webnavior_redis_data` 保存 Server 的快取、設定 KV 與 Pub/Sub。Webnavior 的 AI 能力專屬
Provider Profile、模型目錄與啟用選擇則保存在 PostgreSQL；Server 將它們編譯成短暫的執行期設定寫入 Redis。
更新程式不會重建或清除此 volume，但 PostgreSQL 才是需納入備份的正式資料來源；同樣不要以
`docker compose down -v` 清除它。

啟動與驗證（此 Compose project 只會操作 `webnavior_redis`）：

```bash
sudo docker compose --project-name webnavior-redis \
  --env-file /etc/webnavior/redis.env \
  -f /etc/webnavior/redis.compose.yml up -d
sudo docker compose --project-name webnavior-redis \
  --env-file /etc/webnavior/redis.env \
  -f /etc/webnavior/redis.compose.yml ps
```

密碼若含 `@`、`:`、`/`、`#` 等 URL 特殊字元，填入 `REDIS_URL` 前必須 percent-encode。

## 3. 使用既有 PostgreSQL

請先確認現有 PostgreSQL 的版本、備份方式與監管者；不要在不清楚情況下執行
`apps/server/sql/init.sql`。該檔案只供開發 Compose 的 vchord PostgreSQL 初始化，
目前 WebNavior 的 migration 不應把它套用到既有 production 資料庫。

若主機管理者確認可建立獨立資料庫與最小權限角色，可執行一次：

```bash
sudo -u postgres createuser --pwprompt webnavior
sudo -u postgres createdb --owner=webnavior webnavior
```

部署帳號不需要 PostgreSQL 系統管理員權限。API 啟動時會自動套用本專案的 migration，
所以此角色必須能在 `webnavior` 資料庫內建立及修改 schema。

## 4. 建立 Server 環境檔

從目前已驗證的開發機透過受保護 SSH 複製 `apps/server/.env.local`，但**不能直接覆寫**
Ubuntu 的檔案。先以 `.env.local.incoming` 上傳、`diff -u` 比較鍵名後人工合併。

Ubuntu checkout 內若已有舊的 `apps/server/.env.local`，保留它作為回溯參考即可，不能把它
當 production 設定。下面的 systemd unit 會直接執行 Server entrypoint，刻意避開
`pnpm ... start`：該 npm script 會讀取並覆寫 `.env.local`，可能讓舊的 localhost、資料庫
或開發開關蓋掉正式設定。

```bash
sudo install -d -m 0750 /etc/webnavior
sudoedit /etc/webnavior/server.env
sudo chown root:<deploy-user> /etc/webnavior/server.env
sudo chmod 0640 /etc/webnavior/server.env
```

至少調整下列 production 值；其餘 OAuth、Stripe、Provider 與 LLM 金鑰應從既有安全
環境檔保留。`BETTER_AUTH_SECRET` 與 `LLM_ROUTER_MASTER_KEY` 必須跨更新維持不變，否則
登入 session 或已加密的 Provider 設定會失效。

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=5168
API_SERVER_URL=https://kiosk.example.com
WEB_APP_URL=https://kiosk.example.com
AUTH_UI_URL=https://kiosk.example.com
ADMIN_UI_URL=https://kiosk.example.com
DATABASE_URL=postgresql://webnavior:<URL-encoded-password>@127.0.0.1:5432/webnavior
REDIS_URL=redis://:<URL-encoded-redis-password>@127.0.0.1:6379/0
WEBNAVIOR_KIOSK_ASSET_DIR=/var/lib/webnavior/kiosk-assets
KIOSK_DEVELOPMENT_REGISTRATION_ENABLED=false
WEBNAVIOR_TEST_AUTH_ENABLED=false
```

`apps/server/src/libs/env.ts` 仍要求 Better Auth、Google/GitHub OAuth client、LLM router
master key 等值；不能只留下上述最小片段。不要把任何 `.env.local`、`server.env` 或 PIN
加入 Git、終端輸出或文件。

建立 kiosk 上傳的角色素材目錄：

```bash
sudo install -d -o <deploy-user> -g <deploy-user> -m 0750 /var/lib/webnavior/kiosk-assets
```

## 5. 用 systemd 管理 API

此方式直接在 checkout 中執行 Server，並使用前端部署腳本已安裝在
`/home/<deploy-user>/.local/bin` 的 Node/Corepack；它不會建立或啟動原生 AIRI。不要把
`ExecStart` 改成 package 的 `start` 或 `server` script，因為它們會讀取 checkout 裡的
`.env.local`。

建立 `/etc/systemd/system/webnavior-api.service`：

```ini
[Unit]
Description=WebNavior kiosk API
After=network-online.target docker.service postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=<deploy-user>
Group=<deploy-user>
WorkingDirectory=/home/<deploy-user>/webnavior/apps/server
Environment=PATH=/home/<deploy-user>/.local/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=/etc/webnavior/server.env
ExecStart=/home/<deploy-user>/.local/bin/corepack pnpm exec tsx --import ./instrumentation.ts src/bin/run.ts api
Restart=on-failure
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

啟用後先看 log，再確認兩個 health endpoint 都成功：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now webnavior-api
sudo systemctl status webnavior-api --no-pager
sudo journalctl -u webnavior-api -n 100 --no-pager
curl -fsS http://127.0.0.1:5168/livez
curl -fsS http://127.0.0.1:5168/readyz
```

log 應出現 `Applied schema` 與 `Server started`。若 `/readyz` 失敗，先修正 PostgreSQL
或 Redis，切勿繼續發布前端。

## 6. 安全更新流程

先以 `systemctl show webnavior-api --property=WorkingDirectory --value` 核對實際執行目錄。
若 systemd drop-in 指向 `releases/.../runtime/apps/server`，更新 checkout 再重啟並不會換成
新版。這種環境應先準備完整發布副本、備份現行 drop-in 與靜態檔，驗證後才切換
WorkingDirectory；保留舊發布目錄供回復。`scripts/updateKioskUbuntu.sh` 目前會拒絕
在此情況執行，避免顯示更新成功但仍執行舊 API。

保留資料的更新必須先備份 PostgreSQL、`/etc/webnavior/server.env`、訪客媒體與目前發布檔。
備份需能還原到獨立資料庫；在副本執行本版的正式 migration，依原欄位投影比較每張舊表的
筆數及內容摘要，再用獨立 Redis 啟動 API，驗證既有登入、模型、設備、場域設定與訪客紀錄。
正式切換時先暫停 API 寫入並補做最後一份資料庫備份，再套用已演練的 migration。
不要使用 `db:push` 代替版本化 migration；它會繞過遷移歷史，可能提出非預期的結構變更。

2026-11-16 原網域的更新演練顯示，既有 migration 0000–0048 與目前版本的歷史一致。
待套用的 0049 增加 `response_mode`（預設 `auto`），0050 增加訂單證據資料表；兩者不刪除
既有欄位或資料。還原副本的 58 張原表、83,879 筆資料在遷移前後依原欄位比較完全一致，
8 項隔離 API／後台讀取檢查及 20 項相關測試通過。這是資料相容性演練，不能代替正式
切換結果或完整點餐驗收；切換狀態與備份在忽略版控的
`pb-test.local/domain-update-20261116-092536/manifest.json`。PB 測試資料庫不覆蓋原網站資料庫，
模型金鑰與既有服務設定也不因程式更新而改成測試站的值。

該發布於 2026-11-16 09:51:43（台北）完成：1143 個發布檔一致，正式遷移前後的舊資料
一致；API 啟動只刷新三筆 OAuth client 的更新時間，沒有修改其設定或刪除紀錄。
6106 個既有媒體檔與備份一致，原環境檔雜湊不變。公開後台登入頁及 HTTPS `/readyz`
已由瀏覽器確認，公開 Kiosk 也顯示建立測試設備入口，未新增設備；這不代表 Windows 實機
或完整點餐流程驗收通過。其他網站設定未改寫；POS Bridge、Directus、其他資料庫、模型服務、
Cloudflare 與 PB 容器均未重啟，共用 Nginx 僅重新載入設定。

2026-11-16 15:47:51 再發布 Main 自動備援，現行 runtime 與回復資料在
`pb-test.local/main-fallback-20261116-153654/`。0051 遷移新增可空的對話備援來源，
不刪除原資料；63 張原表、83,929 筆資料依原欄位比較一致。主用仍為 Qwen36／SSE，
備援為既有已驗證的 OpenAI／gpt-6-sol 原生 Responses；System One 來源與原模型金鑰未改寫。
此輪沒有修改或重新載入 Nginx，也沒有重啟其他容器。備援設定在
**系統模型 → Main 自動備援來源**，儲存後按「套用到 Kiosk」，可選擇停用。

來源逾時是上限。Kiosk 每輪把剩餘時間提供給後端，後端在這個期限內為備援保留時間，
後續工具回合不延長整輪期限。JSON 尚未回傳時可切換備援；SSE 已回傳後不重播，
以免重複執行已經派送的工具。模型連線／合成工具回合通過不等於商家送單或 Windows 實機驗收。

每次更新都依下列順序操作，而不是使用會同時安裝、覆寫 Nginx、啟動多個服務的「一鍵」
命令：

1. 記錄目前 revision，並先確認 PostgreSQL 備份可用。
2. `git fetch`，檢視將更新的 commit 與環境檔鍵名；不覆寫 `/etc/webnavior/server.env`。
3. 以 `git pull --ff-only` 更新 checkout，執行 `corepack pnpm install --frozen-lockfile`。
4. 重新建置三個前端，但先不要發布靜態檔。
5. 執行 `corepack pnpm -F @proj-airi/server-schema build`，再建置 Server，確保新 migration 已內嵌於 Server bundle。
6. `sudo systemctl restart webnavior-api`；Server 會自動 migration，先確認 log 出現 `Applied schema`。
7. 確認 Server 健康後才發布靜態前端，接著驗證 `/livez`、`/readyz`、Nginx `/api/`，以及 kiosk 實際登入與媒體上傳。

Server 的新程式碼不能先於資料庫 migration 使用：若更新後 API log 出現 PostgreSQL
`42703` 或 `missing column`，代表該環境沒有套用所屬版本的 migration。確認部署的
checkout 包含 `apps/server/drizzle/` 的新 SQL 與 `_journal.json` 項目、
`@proj-airi/server-schema` 已重新建置，然後重啟 `webnavior-api`；不要把此錯誤誤判為
登入、WebSocket 或前端問題。

失敗時，切回先前記錄的 Git revision、重新安裝該 revision 的 lockfile 依賴，重啟
`webnavior-api`。資料庫 migration 不是自動可逆操作，因此更新前的 PostgreSQL 備份是
回復資料狀態的唯一可靠方式。

### 前端建置網址

前端的 `VITE_*` 值是在建置時寫入靜態檔，不能放在
`/etc/webnavior/server.env`。在每台部署機建立下列未提交的檔案；將
`https://kiosk.example.com` 替換為實際對外 HTTPS 網域。

`apps/stage-web/.env.production.local`：

```env
VITE_SERVER_URL=https://kiosk.example.com
```

`apps/stage-kiosk/.env.production.local`：

```env
VITE_SERVER_URL=https://kiosk.example.com
VITE_API_SERVER_URL=https://kiosk.example.com
VITE_ORDERING_SCENARIO_URL=https://kiosk.example.com/menu/
```

`VITE_SERVER_URL` 是 Stage Web 與 Kiosk 共用服務的來源；缺少它可能會讓瀏覽器嘗試連線到
預設 AIRI API。`VITE_API_SERVER_URL` 是 Kiosk 的設備 API；
`VITE_ORDERING_SCENARIO_URL` 是 Kiosk 內嵌點餐頁的網址。

現場管理 PIN 由 Server 驗證，不再使用 `VITE_KIOSK_ADMIN_PIN`。在 API 的
`KIOSK_ADMIN_PIN_FILE` 指定私密 PIN 檔，或使用預設的 `./data/kiosk-admin.pin`；
相對路徑以 `systemctl show webnavior-api --property=WorkingDirectory --value`
顯示的實際發布目錄為準。PIN 檔僅允許服務帳號讀寫（0600），內容不可提交。
若同時設定 `KIOSK_ADMIN_PIN`，環境變數優先。變更後重啟 `webnavior-api` 才會生效；
單純重建前端不會改變 PIN。

目前的 `scripts/updateKioskUbuntu.sh` 會讀取上述兩個檔案，建置 Web 根目錄 `/`、Kiosk
`/kiosk/` 與菜單 `/menu/` 後發布到 Nginx。若更新內容包含腳本本身，先拉取新版，再執行它：

```bash
cd /srv/webnavior
git pull --ff-only
bash scripts/updateKioskUbuntu.sh
```

此腳本會在發布前重啟 `webnavior-api` 並以 `/readyz` 確認 PostgreSQL 與 Redis 均可用。Kiosk
AI Provider 與 System One 等動態設定保存在 PostgreSQL；Provider 會編譯至第 2 節的 Redis 執行期
快取，而 System One profile 與政策會在下一次 Fast Path 決策讀取。它們不在前端 `.env.production.local`
或更新腳本中，不需要為了更換服務網址再重啟 API。

Nginx 對外的 `/livez`、`/readyz` 必須代理到 API，不能落到 SPA 的 `index.html`。
檢查時除了 HTTP 200，還要確認回傳 JSON 的實際健康狀態；靜態網頁回傳 200 不代表
資料庫與 Redis 已就緒。Windows 跨網路連線應使用實際可達的 HTTPS 網域；Ubuntu 的
`192.168.*` 位址與 localhost 僅適用於各自的區網或已建立的通道。

### Kiosk AI 服務設定

登入系統管理後，從「Kiosk AI 能力」分別設定對話、視覺、ASR 與 TTS。每項能力可
保存多個 Ollama 或 OpenAI-compatible Provider Profile；同一 URL 也必須在各能力獨立保存，不能跨能力
共用。完成能力專屬驗證後，才能切換為啟用 Provider，最後按「套用到 Kiosk」。
這是 Kiosk 唯一的模型設定來源；店別頁面只保留效能、VAD 與主動視覺等現場技術設定。

新增 Provider 時，先填入名稱、URL、選填 Key 與 timeout，按「測試連線與讀取模型」。若服務提供
`/models`，可從暫存清單選擇模型；若未提供，連線仍視為可用，系統會改讓管理者手動輸入 Model ID。
兩種情況都必須按「驗證並儲存 Provider」：Server 會以該能力的實際請求驗證模型，成功後才寫入
PostgreSQL。編輯既有 Provider 也遵循相同規則；驗證失敗不會覆寫已保存的設定。

網址、Key、模型與 TTS voice 儲存在 PostgreSQL，Key 以 `LLM_ROUTER_MASTER_KEY` 加密。修改 URL、
服務類型、模型、Key 或 voice 後，該 Provider 必須重新驗證；這不會改變目前已啟用的另一筆 Provider。
按套用後的下一個 Kiosk 請求即使用新設定，不需要重啟 API。

System One Fast Path profile 可選 Dasein open-jev 或 lookski/openjev，並各自儲存 URL、模型、timeout 與加密
Key。管理頁可讀取各 implementation 的 `/health` 以得知實際載入模型：Dasein 回傳 `model`，lookski 回傳 `model_id`。
兩者皆是在服務啟動時載入單一模型，不能將該欄位當作每次請求的切換器；儲存後先執行 readiness，以實際最小決策確認所選服務與模型
可用後才能啟用。可同時保留多筆不同 implementation 的 profile，但 Kiosk 同一時間只使用一筆已啟用 profile；
不會在兩種服務間自動 fallback。可編輯既有 profile；變更 implementation、URL、模型、timeout 或 API Key 都會
要求重新 readiness。待驗證、失敗或未啟用的 profile 均可移除；啟用中的 profile 必須先切換至另一個已就緒 profile
或先停用 Fast Path，才可移除。變更啟用中的連線設定也會自動停用 Fast Path，避免未驗證的新上游服務處理下一句語音。
Fast Path 無法使用或決策逾時時，Kiosk 會保留該句 ASR 結果並自動交給 Main Agent；
未完成語句、釐清回覆與背景語音不會自動轉交。

Server 提供預設的繁體中文對比式語意邊界；System Manager 可在後台查看、覆寫或還原固定 System One prompt，
另可填寫全店共用、最多 2,000 字的「店家補充規則」。兩者都不能放寬應用程式產生的有限候選、revision、
付款、POS 與掃碼安全邊界。需要比較、解釋或複合操作的語句會自動交給 Main Agent，不靠擴充 System One prompt
讓小模型自行規劃工具鏈。

若 Kiosk 使用文字模式，主對話區會提供「模擬 ASR 辨識結果」輸入。該操作略過麥克風與 ASR，但仍走實際的
System One、當前互動服務工具候選集和瀏覽器操作，因此可在同一個舞台確認人物動作、語音回覆、菜單與購物車變化，
也可能變更目前購物車。它在互動活動中標示為 `asr_simulation`，且不會保存假音檔；語音模式不顯示此控制。

### 點餐體驗測試版的部署設定

這一版仍使用測試付款與 POS 模擬器：付款 QR 畫面會在五秒後模擬完成，沒有實際收款。
手機登記用於本次交易記錄，不代表登入第三方會員；掃碼綁桌與改自取目前只修改測試訂單。

既有部署腳本會建置與複製三個前端，但**不會啟動 Order Menu Bridge**。
測試站還需要依 `apps/order-menu-server/README.md` 啟動並管理這個服務，並設定：

- Bridge 的 `ORDER_MENU_ALLOWED_ORIGIN` 使用顧客實際開啟的 HTTPS origin。
- 建置菜單時，`VITE_ORDER_MENU_SERVER_URL` 指向顧客可連到的 Bridge HTTPS URL。
- `VITE_ORDER_MENU_PUBLIC_URL` 使用顧客手機可開啟的完整菜單網址，例如 `https://kiosk.example.com/menu/`。
- Kiosk 的互動服務網址與允許的 iframe origin 使用測試站網址，不沿用開發機的 `localhost`。

若 Bridge 由同一台 Nginx 代理，可另設 `/order-api/` 轉送至 `127.0.0.1:5170/`，
並讓 `VITE_ORDER_MENU_SERVER_URL` 使用 `https://kiosk.example.com/order-api`。
不要只更新靜態檔案：需先確認 Bridge 常駐服務、proxy 與 HTTPS 網址均可用。
現有腳本會重寫 Nginx site，新增的 proxy 必須納入部署設定後再發布。

接續連結目前保存於 Bridge 記憶體，期限三十分鐘；重啟 Bridge 會讓既有連結失效。
更新後先完成一筆測試訂單，檢查付款倒數、獎勵頁、訂單接續連結與入座後掃桌碼。
歡迎詞及開場方式修改後需儲存／發布，並重新載入 Kiosk。

### 更新、媒體匯出與重置

`scripts/updateKioskUbuntu.sh` 是**就地更新**：它會套用 schema、重啟 API 與替換三個前端
發布目錄，但不會重建 PostgreSQL、Redis volume 或
`WEBNAVIOR_KIOSK_ASSET_DIR`。因此一般更新前不需要匯出，既有訪客歷程、照片與錄音會保留。

目前訪客媒體保存在
`$WEBNAVIOR_KIOSK_ASSET_DIR/visitor-media/<media-id>.bin`。內容是原始媒體 bytes，**沒有加密**；
副檔名 `.bin` 只是儲存實作，正確 MIME type、拍攝時間與會話關聯保存在 PostgreSQL。
後台的媒體下載 API 會依 MIME type 回傳，因此下載後可以直接開啟。

若未來需要刻意重新初始化 Ubuntu 環境，這不是更新腳本的一部分。必須先執行專用匯出流程，
產生可攜 archive：每個媒體檔依 MIME type 改為可直接開啟的副檔名，並附上 JSONL manifest
（session、時間、媒體 kind、MIME type 與原始 ID）。匯出指令必須在驗證 archive 可讀、manifest
筆數與資料庫媒體筆數一致後才允許進入重置步驟；未來導入該指令前，不可用手動刪除資料目錄
取代這個流程。

Web 根目錄必須以 `--base=/` 建置；若使用 `/web/`，Nginx 會把找不到的 JavaScript 請求回應為
SPA HTML，瀏覽器便會顯示 `Unexpected token '<'`。部署完成後，對管理頁做一次硬重新整理以清除
舊的 chunk 快取。

## 維運指令

```bash
# 僅重啟 API，不影響 Nginx、PostgreSQL、其他 Docker container
sudo systemctl restart webnavior-api

# 僅查看 AIRI 的 Redis；不要用無 project name 的 compose down
sudo docker compose --project-name webnavior-redis \
  --env-file /etc/webnavior/redis.env \
  -f /etc/webnavior/redis.compose.yml ps

# 查看 API 最近 log
sudo journalctl -u webnavior-api -n 100 --no-pager
```

### Windows 機台可攜版

一般 Intel x64 Windows 10/11 機台可直接解壓縮本次提供的可攜 ZIP，雙擊
`Webnavior Kiosk.exe`，沿用網域後台。包內「先看我.txt」說明配對、設定與更新。
不需在機台安裝 Node/pnpm；完整資料夾必須一起保留。維護者的來源建置與公司 Proxy
設定請見 [Windows 部署說明](../scripts/windows/README.md)。機台資料仍在同一
Windows 帳號的 `%LOCALAPPDATA%\Webnavior\Kiosk-Pilot`，更新程式資料夾不刪除此處。
網域部署與 Runtime 封裝通過檢查不等於 Windows 實體影音、觸控或商家點餐已驗收。
