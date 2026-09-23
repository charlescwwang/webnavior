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
VITE_KIOSK_ADMIN_PIN=<kiosk-admin-pin>
VITE_SERVER_URL=https://kiosk.example.com
VITE_API_SERVER_URL=https://kiosk.example.com
VITE_ORDERING_SCENARIO_URL=https://kiosk.example.com/menu/
```

`VITE_SERVER_URL` 是 Stage Web 與 Kiosk 共用服務的來源；缺少它可能會讓瀏覽器嘗試連線到
預設 AIRI API。`VITE_API_SERVER_URL` 是 Kiosk 的設備 API；
`VITE_ORDERING_SCENARIO_URL` 是 Kiosk 內嵌點餐頁的網址。

目前的 `scripts/updateKioskUbuntu.sh` 會讀取上述兩個檔案，建置 Web 根目錄 `/`、Kiosk
`/kiosk/` 與菜單 `/menu/` 後發布到 Nginx。若更新內容包含腳本本身，先拉取新版，再執行它：

```bash
cd /srv/webnavior
git pull --ff-only
bash scripts/updateKioskUbuntu.sh
```

此腳本會在發布前重啟 `webnavior-api` 並以 `/readyz` 確認 PostgreSQL 與 Redis 均可用。Kiosk
embedding 等動態 Provider 設定保存在 PostgreSQL，並由 Server 編譯至第 2 節的 Redis 執行期
快取；它們不在前端 `.env.production.local` 或更新腳本中。後台套用後，下一次語意判斷就會讀到
新值，不需要為了更換服務網址再重啟 API。

### Kiosk AI 服務設定

登入系統管理後，從「Kiosk AI 能力」分別設定對話、視覺、ASR、TTS 與 embedding。每項能力可
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

若要啟用新對話的 embedding Speech Guard，在套用 Embedding Provider 後按「建立語意防護基準」。
Server 會批次建立並保存系統語料向量；這項作業只在建立或重新建立時呼叫 Provider，不會將模型或
語料下載到 Kiosk。更換已套用的 Embedding Provider 或模型後，需重新建立基準；尚未建立時系統仍以
ASR 品質、presence 與保守的點餐意圖規則過濾背景人聲。

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
