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
`/home/<deploy-user>/.local/bin` 的 Node/Corepack；它不會建立或啟動原生 AIRI。

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
WorkingDirectory=/srv/webnavior
Environment=PATH=/home/<deploy-user>/.local/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=/etc/webnavior/server.env
ExecStart=/home/<deploy-user>/.local/bin/corepack pnpm -F @proj-airi/server start
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
4. 重新建置三個前端；確認 build 成功後才發布靜態檔。
5. `sudo systemctl restart webnavior-api`；Server 會自動 migration。
6. 驗證 `/livez`、`/readyz`、Nginx `/api/`，以及 kiosk 實際登入與媒體上傳。

失敗時，切回先前記錄的 Git revision、重新安裝該 revision 的 lockfile 依賴，重啟
`webnavior-api`。資料庫 migration 不是自動可逆操作，因此更新前的 PostgreSQL 備份是
回復資料狀態的唯一可靠方式。

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
