# Kiosk 管理平面與訪客互動資料保存計畫

> 狀態：POC 方向已確認；第一至三階段已完成。第四、五階段持續實作：已具備瀏覽器模擬 kiosk、Server Gateway 文字對話、裝置驗證的 ASR/TTS、以即時 camera frame 交由 Site VLM 決定的主動招呼／提醒、iframe 生命週期與點餐結果保存，以及含原始 WAV、觸發短片、連續攝影機分段、日期／時段分組與刪除功能的訪客使用歷程；保存期檔案清理、完整管理 UI、實體 kiosk 與韌性測試尚未實作。
>
> 範圍：先以「互動點餐員與互動資料保存 POC」驗證 AIRI 能否有效協助點餐，再演進目前以瀏覽器 `localStorage` 為主的單機 AIRI Kiosk 為由後台控管的多設備 Web Kiosk。此文件不改變 AIRI Interaction Host、獨立互動服務與 WebMCP 的既有邊界。

## 目標

- 現場 kiosk 僅開啟固定 `/kiosk/` 網址，不讓現場人員設定模型、API Key、角色卡、互動服務網址或問卷。
- POC 先以單一測試 Site、瀏覽器模擬 kiosk 與單一已發布 Profile 驗證互動；後續後台可依店別與設備發布一套可回滾的 Profile，且每台設備只指派一個 Profile。
- 保留 AIRI 的通用互動 Host 與 WebMCP；點餐、掛號、導覽等領域服務仍為獨立 iframe 網頁。
- 讓 Server 安全持有 Provider 金鑰，並在 POC 保存完整逐字稿、互動事件、工具呼叫與點餐結果，供評估互動品質。
- 第一版以可運作的單一 Server instance POC 為目標；內部測試明確保存原始 WAV、互動觸發短片與連續攝影機分段影片至私有 Server volume，並以訪客會話保存期清除。備份、媒體加密、網路韌性與隱私權請求處理保留至後續正式化階段。

## 現況與採用方向

現有 `apps/server` 已有 Better Auth、Postgres、Redis、WebSocket、Provider Gateway 與加密保存 Provider Key 的基礎。不要重寫整個後端；新增獨立的 Kiosk 管理領域模組。

Postgres 是正式資料真相來源：帳號、店別、設備、Profile 發布版本、命令回執、媒體中繼資料與稽核紀錄皆保存於此。Redis 保留作快取與跨 Server instance 的即時 Pub/Sub／WebSocket 協調，不保存唯一的正式資料。第一版只部署一個 Server instance；原始媒體先保存在此 Server 的私有磁碟。

## 名詞

| 名詞 | 定義 |
|---|---|
| 店別（Site） | 人員、設備、媒體政策與資料存取的管理範圍。程式內採通用 `site`，UI 可顯示店別。 |
| 設備 | 一台實際 kiosk 瀏覽器安裝環境，例如 `STORE01-KIOSK-01`。 |
| 人工機器識別碼 | 人能辨識的設備名稱；不可作為安全憑證。 |
| 設備憑證 | Server 在註冊後寫入 HTTPS `Secure`、`HttpOnly` Cookie 的可撤銷身分憑證。除非管理員撤銷或換發，否則不自動過期。 |
| 註冊 QR Code | 綁定店別與設備的一次性註冊碼；沒有時間效期，但首次成功註冊後立即失效，管理員也可撤銷。 |
| 開發數字註冊碼 | 僅供 POC 開發環境使用的前端產生數字，用來直接建立並綁定測試設備；不是正式安全憑證，production 必須拒絕此流程。 |
| Profile | 一套可執行場景設定：角色、互動服務、問卷、語言、版面、顧客流程與功能策略。 |
| 發布版本 | 不可變的 Profile 快照，可指派設備並回滾。 |
| 訪客模式 | POC 由開始測試會話、正式 kiosk 由偵測到訪客後開始的一次互動模式；第一版不以「匿名」描述保存的影像、音訊或文字資料。 |
| 訪客會話 | 訪客模式從主動招呼開始，到完成、取消、現場人員選擇重新開始或閒置結束的互動區間。 |

## 人員、帳號與設備權限

沿用既有 Better Auth 的帳號、登入與 Session；新增店別成員關係，不能只使用既有全域 `admin` 角色。

| 角色 | 權限 |
|---|---|
| 系統管理員 | 管理所有店別、帳號、設備、Profile、全域上限、媒體、備份位置、刪除與稽核。具有所有店別管理員的權限。 |
| 店別管理員 | 管理獲授權店別的設備、產生與撤銷註冊 QR Code、建立互動服務 URL、Profile 指派、媒體檢視與刪除申請；可查看自己店別的稽核紀錄。 |
| 檢視者 | 檢視獲授權範圍的設備狀態與非敏感營運資料；不可讀取原始影像、影片或音訊。 |

- 後台第一版採帳號密碼登入。系統管理員以一次性啟用連結建立店別管理員帳號；連結預設有效 24 小時，首次登入強制修改密碼。
- 系統管理員與店別管理員均可綁定 Email，忘記密碼時可寄送重設信。
- MFA 與智慧餐廚 OMP SSO 暫不實作，但帳號邊界需預留未來 SSO 介接。
- POC 的 kiosk 前端可產生開發數字註冊碼，呼叫獨立的開發註冊端點直接建立並綁定 `DEV-` 測試設備。端點僅在 `KIOSK_DEVELOPMENT_REGISTRATION_ENABLED=true` 且非 production 環境可用，並在設備與稽核紀錄中標記 `registrationMethod: development`；不得與正式 QR 兌換 route 共用。
- 正式流程中，店別管理員可建立其店別的 kiosk。kiosk 由相機或 QR 掃描器掃描註冊 QR Code，Server 建立設備憑證；Cookie 遺失、設備遺失、設備轉讓與疑似外洩皆由管理員手動撤銷或重新註冊處理。

## 設定分層

正式 kiosk 不再以瀏覽器 `localStorage` 為設定來源。Server 下發 Site policy、Profile 發布版本與必要資產版本；設備只保留最後成功設定的快取與硬體選擇。

### Site policy

同一 Site 的 kiosk 使用相同偵測與媒體政策：

- 主動偵測是否啟用、偵測模式（看向 kiosk／進入偵測區／混合）、偵測區域、停留時間、區域清空重設時間與最小觸發人數。
- 系統管理員可為每個 Site 設定保存天數與影像保存模式：關閉、只保存活動觸發短片，或活動短片加上會話期間的 30 秒連續攝影機 WebM 分段。影片維持靜音，麥克風 WAV 另外保存；影像編碼只在訪客會話存在時開始，結束時立即 flush 最後不足 30 秒的片段。
- POC 直接保存可播放的 WebM 分段至 Server 私有 volume，尚未實作 FFmpeg 轉檔、MP4 成品或 Site 層級媒體開關。
- 保存期、每日上傳上限與容量滿載行為。
- 無操作協助提醒的啟用狀態、等待時間與單一訪客會話最大提醒次數。

每台設備可以覆寫其相機與麥克風的實體裝置選擇；這是硬體設定，不屬於 Site policy 或 Profile。

### Profile 發布版本

Profile 包含下列 kiosk 行為設定：

- 已核准互動服務清單：`id`、名稱、用途描述、iframe URL 與啟用狀態；並指定預設服務。店別管理員可新增 URL，但 AIRI Agent 只能在目前 Profile 清單中的服務之間切換，不能開啟任意網頁。
- Agent 的營運指示，以及主動招呼與無操作提醒的場域提示文字。提示是 VLM 的決策脈絡，不可作為可直接輸出的固定台詞。
- 問卷邀請：啟用狀態、固定問卷 URL、顯示秒數、標題、說明與略過按鈕文字。第一版不在問卷 URL 夾帶訂單、對話或會員資料。
- 語言、互動服務面板版面與顧客流程：閒置等待秒數、閒置確認倒數秒數、完成後畫面與「繼續目前會話／重新開始」流程。
- 角色發布版本、角色模型與背景等呈現資產版本。

角色採「角色發布版引用」：角色可以獨立管理並重用；Profile 發布時保存已解析的角色不可變快照，以確保執行與回滾時都使用當時的角色名稱、描述、人格、system prompt 與招呼語。Profile 不保存 Provider 金鑰、Provider Base URL 或 kiosk 可自行選擇的模型設定；它最多引用 Server 管理的推論策略。

POC 只需一個 Profile 草稿與其目前已發布版本；管理者儲存後即驗證並建立新發布版本，模擬 kiosk 在重新整理時拉取最新版。POC 不實作設備群組、Profile 指派 UI、遠端即時推送或回滾 UI，但資料模型仍需保存發布版本與設備綁定，使後續能擴充而不遷移設定語意。

### 固定的 Host 邊界

- iframe 只透過既有 WebMCP 與 kiosk Host 溝通；kiosk Host 保有相機、麥克風、訪客會話、設備憑證與 Provider Gateway 的權限。
- Host 只接受目前 iframe 視窗、目前服務 URL origin 所送出的 `activity` 與 `completed` 生命週期事件；WebMCP 工具也只由目前啟用 iframe 提供。
- 菜單、價格、訂單與支付內容由 iframe 內的領域服務取得與管理，不納入 AIRI Profile。
- 開發者選項、WebSocket 安全開關、analytics、桌面視窗控制與非 kiosk Agent 模組不進入 Site policy 或 Profile。

## Kiosk 行為

```text
開啟 /kiosk/
  -> 以設備憑證驗證
  -> 下載 Site policy 與指派的已發布 Profile
  -> 一次套用角色、互動服務、畫面與功能設定
  -> 進入顧客待機畫面
```

- 正式 kiosk 隱藏模型、角色、Token、Provider、互動服務與問卷設定頁。
- POC 未註冊設備顯示開發數字註冊頁；開發旗標關閉後只顯示首次註冊／QR Code 掃描頁。
- 已註冊設備保留 PIN 保護的維護入口，限於設備狀態、版本、網路／麥克風／相機診斷、重新註冊與重新取得設定。
- 維護 PIN 由現場安裝人員設定；連續輸入失敗五次只鎖定維護入口。店別管理員可在後台填寫原因後解鎖，系統必須寫入稽核紀錄。
- kiosk 快取最後成功的設定。斷線時凍結菜單與對話、停止錄製並顯示連線中或維護提示的策略，連同不保留本機待上傳影音片段，延至有實體 kiosk 後的韌性驗證階段。
- LLM、TTS、ASR 改經由 Server Gateway；Provider Key 不下發至 kiosk。
- 已發布體驗可啟用 `voiceConversationOnly`。啟用後 Kiosk 隱藏文字 composer；若設備已獲准麥克風權限，載入時會啟動 VAD，並以可見狀態呈現實際收音是否成功。
- VAD 在 kiosk 本機使用 Silero 模型，對每個音訊區塊產生人聲機率；Site 可由後台設定 `0.50`–`0.95` 的閾值，POC 預設採較嚴格的 `0.72`。數值越高越能排除環境聲，但也越可能漏掉較小聲的人聲。現有「最短有效語音」規則錯把等待靜音的時間納入語音長度，短雜音可能仍被送至 ASR；正式實體 kiosk 驗證前，必須改為只累積模型判為人聲的時間，再放行 ASR。
- Kiosk 的 ASR 與 TTS 使用設備驗證的 `/api/kiosk/audio/*` 路由。Server 依 Site policy 選擇模型並保留上游 endpoint、voice 與憑證；TTS 回應以音訊 binary 原樣轉送給 Kiosk。
- Kiosk 主動招呼／閒置提醒在本機滿足 Presence 與頻率政策後，僅擷取一張縮小 JPEG camera frame，送至設備驗證的 assistant-action 路由。Server 以 Site 的 VLM 模型策略呼叫既有 OpenAI-compatible Router；未設定 VLM 時拒絕動作，不回退為 Profile 範例台詞。該 inference frame 不保存為訪客媒體。

## Profile 發布與遠端控制

設定流程：

```text
草稿 -> 驗證 -> 發布不可變版本 -> 指派設備或設備群組
  -> kiosk 下載並原子套用 -> 回報成功或失敗
```

POC 不建立 Kiosk WebSocket Channel；kiosk 只在啟動、手動重新取得設定及頁面重新整理時拉取目前已發布 Profile。WebSocket 的即時狀態、設定更新通知與命令回執屬於後續多設備控制平面。屆時店別管理員可對自己店別發送命令；每個命令必須填寫理由，並可選擇有效期限。

多設備控制平面的第一版僅允許受限命令：

- 重新取得設定。
- 正常／暫停／維護模式切換。
- 顯示公告。
- 重新載入 kiosk。
- 切換至目前 Profile 已核准的互動服務。

第一版不提供遠端立即強制清除顧客會話，也不允許任意 JavaScript、Shell 指令或未核准 URL。

前端更新採統一於非熱門時段或晚間執行。若更新失敗，kiosk 進入維護模式，並在系統內通知店別管理員；第一版不依賴 Email 通知。正在互動時不自動重載，待完成、取消或閒置後才重新載入。Nginx 部署採 `index.html` 不快取、帶 hash 的靜態資產長期快取。

## Ubuntu 共存更新與環境設定

Ubuntu 主機若同時承載其他服務，更新 AIRI 時只操作 AIRI 專用 checkout、服務單元或 Docker Compose project；禁止使用 `docker compose down`、`docker system prune`、全域套件更新，或未確認就占用既有 port。更新前先以唯讀方式記錄 `systemctl --type=service --state=running`、`docker ps` 與 `ss -ltnp`，確認 AIRI 的使用者、目錄、服務名稱與對外 port，並保留可回復的前一個 Git revision。

`apps/server/.env.local` 與 `apps/stage-kiosk/.env.local` 含憑證與 kiosk 維護 PIN，絕不加入 Git、日誌或部署文件。首次移轉時可透過受保護 SSH 通道複製；後續更新應先上傳為 `.env.local.incoming`、以 `diff -u` 比對鍵值後人工合併，不能直接用開發機的檔案覆寫 Ubuntu 的 production 設定。Server 的 `BETTER_AUTH_SECRET`、`LLM_ROUTER_MASTER_KEY`、OAuth／Stripe 金鑰必須跨部署維持不變；改動會使既有登入或已保存的加密 Provider 設定失效。

Docker Compose 部署需特別區分開發與 production 網路：container 內的 `DATABASE_URL`／`REDIS_URL` 必須指向同一 Compose network 的 `db:5432`／`redis:6379`，不能保留開發環境的 `localhost`；Compose 的 API health check 使用 container port `3000`，因此該部署的 `PORT` 必須為 `3000`。現有 `apps/server/docker-compose.yml` 同時定義 db、Redis 與 `6112` 對外映射，只有在三者均屬於 AIRI 且已確認沒有 port 衝突時才可使用。若 db／Redis 已在運行，更新 API 時使用 `docker compose -f apps/server/docker-compose.yml up -d --build --no-deps api`，只重建並替換 API，不停止其他 container。

Server 啟動時會自動套用內嵌 migration；更新前先備份 Postgres，啟動後檢查 `/livez`、`/readyz`、Server log 的 `Applied schema`，再讓 kiosk 重新載入設定。`apps/stage-kiosk/.env.local` 的 `VITE_KIOSK_ADMIN_PIN` 與任何 `VITE_*` 值屬於前端 build-time 設定，變更後必須重建 kiosk 前端資產，不能只重啟 API。

## POC 訪客會話與逐字稿保存

POC 的目標是驗證互動點餐員並收集可改善產品的完整互動資料。內部測試會同時保存原始語音與攝影機證據；瀏覽器模擬 kiosk 由「開始測試會話」進入訪客會話。正式 kiosk 的待機告知 Modal、背景本機人員偵測與自動招呼，在實體設備驗證階段導入。

```text
待機或開始測試會話
  -> 建立訪客會話並記錄 Profile 發布版本、設備與服務
  -> AIRI 主動招呼並開放互動
  -> 保存完整文字對話、ASR 全文逐字稿、原始 WAV、工具呼叫與 iframe 生命週期事件
  -> 活動事件保存 10 秒觸發短片；攝影機持續保存 30 秒 WebM 分段
  -> 完成、取消、重新開始或閒置
  -> 結束會話並保存點餐結果／問卷狀態
```

- POC 必須保存每個訪客會話的完整文字對話與 ASR 全文逐字稿，包含 AIRI 主動招呼、使用者輸入、工具呼叫的輸入／輸出摘要、可讀的顧客活動／完成事件、服務切換、結束原因、Profile 發布版本與可用的非個資點餐結果。MediaPipe landmark 與人體骨架結果僅在記憶體中使用，不保存。
- 顧客語音的 WAV 會連結到語音輸入活動；觸發短片會連結到觸發它的活動事件，並保存片段起訖時間。連續影片僅以訪客會話與起訖時間關聯，不假裝具有精準事件因果關係。
- 管理端已提供第一版「使用歷程」：授權管理者可先依 Site 查看依日期與時段分組的訪客會話摘要，再選擇一筆會話讀取對話、行為摘要與媒體。ASR 轉錄項目可播放對應 WAV；活動項目可播放對應觸發短片；連續影片在獨立區塊按需載入。清單支援單筆或批次永久刪除會話及其資料庫媒體紀錄／volume 檔案。
- POC 預設保存 180 天；系統管理員可設定任意最長保存天數，亦可將保存期設為不保存。設定縮短或延長只影響新產生資料。
- 訪客會話在閒置時顯示「繼續目前會話／重新開始」選擇，由下一位操作者決定是否合併會話。
- 模型訓練資料不自動匯出；僅標記為候選資料。未來會員制度可保留可連結的假名識別欄位，並支援系統管理員選擇輸出可對照或去連結化版本。
- POC 暫不處理顧客停止錄製、查詢或刪除資料的流程，以及訓練資料的額外審核控管。正式啟用前，告知 Modal 必須清楚說明會保存完整逐字稿。

## POC 與後續實體 kiosk 的媒體儲存、備份與稽核

內部 POC 已導入原始 WAV、觸發短片與連續影片分段。原始媒體保存於 Server 私有目錄，不可置於 Nginx 直接公開的靜態網站目錄；Postgres 保存媒體類型、訪客會話、可選活動事件關聯、大小、MIME type 與起訖時間。媒體播放必須經過 Server 權限判斷，不使用固定公開 URL。背景人員偵測的視覺結果不保存。

- 容量預算為 100 GB。磁碟空間不足時，先刪除已到期資料；仍不足則停止新錄製、通知店別管理員，但 kiosk 繼續提供點餐與互動服務。
- POC 在已開啟的 kiosk 相機 stream 期間連續錄製 30 秒 WebM 分段，並在顧客活動時另存 10 秒短片；影片不混入麥克風音軌。正式化時再決定是否改為訪客會話式錄製、加入轉檔與設定容量政策。
- 系統管理員可設定 NAS 或一般遠端伺服器作為備份位置。預設每 7 天備份一次，備份保留 180 天；系統管理員可調整頻率、保存期與失敗告警。
- 備份必須包含原始媒體、Postgres 資料庫與稽核紀錄。POC 暫不要求媒體或遠端備份加密，也暫不定義資料刪除如何同步到既有備份。
- 所有檢視、播放、下載、標記刪除、核准刪除與實際刪除都需寫入不可竄改稽核紀錄。稽核預設保存 180 天，系統管理員可設定任意期間；店別管理員可看自己 Site 的紀錄，系統管理員可看全部紀錄。

## Gateway 與使用量紀錄

第一版不設 Site 或設備的 AI 用量、Token 或費用上限，以 POC 可運作為優先。Server 仍須為每次 Provider 呼叫記錄 Site、設備、Profile 版本、Provider、模型、請求時間、成功或失敗、Token／音訊秒數與估算成本，為後續用量限制與成本管理建立資料基礎。

Gateway 必須將文字內容與 ASR 全文逐字稿關聯到訪客會話，不能只保留 request metadata。文字內容、ASR 全文逐字稿與錯誤日誌預設保存 180 天。系統管理員可檢視所有 Site；店別管理員只能檢視自己的 Site。遠端備份位置由系統管理員設定。

## 實作順序

1. **互動點餐員資料 POC：資料與權限。** 定義 Site、測試設備、Profile 發布版本、訪客會話、逐字稿／事件、點餐結果與稽核的資料模型及遷移。先完成跨 Site 權限與會話資料存取的測試。
2. **瀏覽器模擬 kiosk。** 實作 `/kiosk/`、設備憑證與開發數字註冊；用不同瀏覽器 Profile 模擬多台 kiosk。此階段不需要 QR 掃描器、相機、麥克風或網路中斷測試。
3. **最小遠端設定。** 實作單一 Profile 草稿、發布、kiosk 啟動／重整拉取與原子套用。後台先只提供點餐 iframe URL、角色／營運指示、主動招呼文字、問卷 URL 與目前發布版本。
4. **互動與資料收集。** 將 Provider 呼叫遷移至 Server Gateway，移除 kiosk 端金鑰與模型選擇；保存完整文字對話、ASR 全文逐字稿、工具呼叫、WebMCP 生命週期事件、點餐結果與問卷狀態，並提供依 Site／Profile／會話檢視資料的管理頁。已完成設備憑證保護的訪客會話 API、文字對話／主動招呼／提醒、裝置驗證的 ASR/TTS、iframe `activity`／`completed`、非個資點餐結果、問卷顯示／關閉狀態、媒體保存與依 Site 選取會話的使用歷程。保存期同步清除 volume 檔案、完整管理 UI 與營運檢視仍未完成。
5. **體驗驗證。** 以可注入的匿名觀測結果測試主動招呼、無操作提醒、閒置確認、完成與重新開始；驗證 iframe origin、服務白名單與 WebMCP 工具只屬於目前啟用服務。已完成匿名觀測、提醒、閒置與完成流程的自動化測試，並新增目前 iframe 視窗與核准 origin 的事件隔離測試。
6. **實體 kiosk 與媒體。** 有設備後驗證 QR 註冊、相機／麥克風選擇、待機告知、現場人員偵測、WebM 分段上傳、FFmpeg 轉檔、私有媒體存取、保存期、容量告警、稽核與備份。
7. **韌性與正式控制平面。** 最後驗證網路中斷、睡眠恢復、更新失敗與現場校準；再導入 WebSocket Channel、設備心跳、Profile 指派／回執、受限遠端命令、維護 PIN、設備群組與多設備管理 UI。

## POC 後續決策

- 多 Server instance、共享或物件儲存與媒體跨節點存取。
- 媒體與遠端備份加密、備份還原演練，以及刪除資料同步清除備份的策略。
- 顧客停止錄製、查詢及刪除資料的營運流程。
- 訓練候選資料的去識別化、人工審核、可連結會員假名識別與實際 fine-tune 管線。
- MFA、智慧餐廚 OMP SSO 與更完整帳號生命週期。
- AI 用量、費用、Provider／模型與工具白名單或上限。
