# Windows 遠端 Kiosk 建置與啟動

目前可攜包版本為 **0.7.8-rc.3**：修正菜單轉購物車後的正常桌號轉址誤判、
首次加餐空草稿讀回錯誤，並包含 RC2 共用資料驗證。需完整更新 EXE 資料夾並搭配
本次 Kiosk 前端。此候選版已通過 Linux Electron 實測；Windows 實機驗收仍待完成。

0.7.8 十一月 master 收音回復版，可攜包啟動時提供現場區網
`http://172.17.69.17:5169/kiosk/`、Tailscale
`http://100.92.1.80:5169/kiosk/` 與既有公開 HTTPS 三入口。
EXE 旁的 `kiosk.settings.json` 以 `connections` 設定選單名稱／網址；
`kioskUrl` 必須對應其中一項，決定預選入口。地址改動只需更新設定並完整重開，
不必重包。新版設定需要 `connections`，請勿直接覆蓋舊版 JSON。

伺服器以 `KIOSK_TRUSTED_ORIGINS` 獨立設定精確 origin，預設為上述兩個 HTTP 入口。
若換 IP，需同時調整 `/etc/webnavior/server.env` 並由服務管理員重啟 API。
5169 是前端與 API 的統一入口，5168 保持 loopback；公開網域保留。
EXE 的 HTTP 影音特例僅適用設定的 Kiosk 入口，普通瀏覽器仍須 HTTPS。
完整網頁管理後台捷徑保留公開 HTTPS；現場 PIN 技術設定走所選入口。

## 想直接執行 EXE：使用可攜版 ZIP

一般機台請使用本次提供的 `Webnavior-Kiosk-v<版本號>-Windows-x64-<日期時間>.zip`，將整包解壓縮，雙擊
`Webnavior Kiosk.exe`。不需要安裝 Node、pnpm，也不必執行下方 Setup／Build。
設定與簡單操作見包內「先看我.txt」及本目錄 [portableQuickStart.txt](portableQuickStart.txt)。
這是 Intel x64、未簽章的可攜版；保留同一 Windows 使用者的
`%LOCALAPPDATA%\Webnavior\Kiosk-Pilot`，更新程式資料夾不會清除設備與商家登入。

維護者採用 [Electron 官方可攜封裝方式](https://www.electronjs.org/docs/latest/tutorial/application-distribution#with-prebuilt-binaries)，
沿用現有 electron-vite，未引入新的封裝框架。先 Build，再提供已核對的官方 Windows Runtime ZIP：

```bash
pnpm -F @proj-airi/stage-kiosk-desktop build
python3 scripts/windows/packagePortable.py --runtime-zip /path/to/electron-v46.0.0-alpha.2-win32-x64.zip --output-dir /tmp
```

腳本核對既有固定 SHA256、PE x64 標頭、必要檔案與成品 ZIP 內雜湊；產出 EXE 包及相鄰 `.zip.sha256`。
0.7.8 已移除 Hush、Python 收音與獨立音訊程序實驗，更新需替換完整資料夾並搭配回復版前端。只打包官方 Runtime、已編譯程式、預設設定與說明，不包含金鑰、登入、profile 或伺服器環境檔。
Windows 實體硬體與完整點餐仍須在目標機器驗收。

### 十一月 master 收音回復（0.7.8）

依 master `b1a7f5b`／11月9日麥克風修正 `326ff95` 恢復 Electron Chromium
收音：實際八聲道走 Spatial Mask，其餘恢復一般瀏覽器語音處理。動態方向處理
依助手 TTS 播放切換；原有映射／半徑與增益保留。該基準的 LCMV 是比較路徑。
Hush、Python／PortAudio 收音、原生模型與對應250ms傳輸鏈全部移除。
包內不含 Python／Hush 模型或執行庫。需配套前端；原生點餐、統編代填保留。
回復基準不等於完成 Windows 實體現場驗收。

## 原始碼部署（維護者適用）

這套腳本供乾淨的 Windows 10/11 x64／ARM64 電腦，從本專案原始碼建置及執行 **Kiosk Electron**。API、後台、資料庫、Jev／Main 模型、ASR／TTS 設定和金鑰仍放在 Ubuntu；不需要在 Windows 再建一份資料庫或複製伺服器 `.env.local`。

這是目前共同研發用的啟動工具，包含本機 Electron 合成流程測試；Windows 實體麥克風、觸控、DPI、付款及整套點餐仍要在目標電腦驗收。下方原始碼流程不產生安裝程式；上方另提供可攜 EXE ZIP，目前沒有簽章或自動更新服務。

## 1. 準備原始碼

用 Git clone 或解壓本次提交的完整原始碼到短路徑，例如 `C:\src\webnavior`。包含 `pnpm-lock.yaml`、`pnpm-workspace.yaml`、`patches/`、`scripts/`、`packages/` 與 `apps/`；不要只複製 Electron 資料夾。**不要複製 Ubuntu 的 `node_modules`、`out`、`pb-test.local`、登入資料或金鑰。** ZIP 不需要 Git；腳本略過 monorepo 的全套 postinstall／原生 SDK 建置。

開啟一般使用者的 **64 位元 PowerShell 5.1 或更新版本**，切到原始碼根目錄：

```powershell
cd C:\src\webnavior
.\scripts\windows\kiosk.cmd -Action Setup
.\scripts\windows\kiosk.cmd -Action Build
```

`Setup` 不需要預先安裝 Node 或 pnpm，會在忽略版控的 `.windows-kiosk.local/` 下載：

- Node **24.22.1** 可攜版；依官方 SHA256 核對後才解壓。
- 根目錄 `package.json` 指定的 pnpm **10.33.0**，不全域安裝。
- 鎖檔內的建置依賴；只安裝 root／Desktop／原生網頁服務所屬 Stage UI 的依賴範圍、略過整個專案的 install scripts，並單獨重建 esbuild。
- 已驗證的 Electron **46.0.0-alpha.2** Windows 對應架構，依官方 SHA256 核對；啟動前再核對 Electron 版本及內嵌 Node **24.22.1**。

沿用現有 pilot 的指定執行版本，沒有改掉程式的版本檢查。工作區原先的 Electron 套件不是這個版本，**請使用這個啟動腳本，不要用 `pnpm start` 或任意下載的 Electron**。

Setup 的網路請求最多重試3次，每次180秒；npm／pnpm套件下載使用120秒與3次重試。
已下載且SHA256正確的Runtime、符合版本的pnpm與既有pnpm套件快取會沿用；中斷後直接重跑Setup，
不要清除node_modules。Hash錯誤會停止，不把不可信檔案當網路逾時重試。
`arrow2csv` 等bin警告若未造成pnpm非零退出碼，並不判為安裝失敗；本Kiosk沒有呼叫該CLI，
也不建立假的EXE。Build會檢查electron-vite依賴與main／preload／原生pb三個非空產出。

公司網路可在**當前PowerShell工作階段**設定資訊人員提供的Proxy：

```powershell
$env:HTTPS_PROXY = 'http://公司Proxy位址:8080'
$env:HTTP_PROXY = $env:HTTPS_PROXY
$env:NO_PROXY = 'localhost,127.0.0.1'
```

Runtime下載與Doctor會套用這些設定，npm／pnpm沿用自己的Proxy支援；未指定時保留Windows系統設定。
不需將密碼寫進JSON或提交版控。公司攔截TLS需由資訊人員配置可信憑證，不停用驗證。

執行原則限制時，優先使用包內`kiosk.cmd`，只對該子程序使用Bypass；不永久修改系統原則。
若直接呼叫ps1，可在當前工作階段執行`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`。
公司群組原則禁止時請依公司規範處理，不修改登錄或機器層級政策。
所有README指令以專案根目錄為起點；腳本使用PSScriptRoot定位，指定相對Config也以根目錄解析。
請勿把修正模組再複製到目前目錄，直接更新實際的scripts/windows/kioskTools.psm1。

版本探測以 `Start-Process -Wait` 執行 Electron 的 Node 模式，將版本寫入暫存 JSON 再讀取，避免 Windows GUI 執行檔的 stdout 擷取問題。腳本會檢查程序退出碼、JSON 與兩個版本欄位；無論成功或失敗，都還原 `ELECTRON_RUN_AS_NODE`／`ELECTRON_NO_ATTACH_CONSOLE` 並清除暫存資料。

架構預設自動辨識；必要時每個指令均可加 `-Architecture x64` 或 `-Architecture arm64`。請在相同架構完成 Setup、Build、Start。

下載需要能連到 Node.js、GitHub Releases 及 npm registry。若 SHA256 不符會停止，不解壓；不要繞過檢查。Windows 防毒、代理或網路中斷造成的下載失敗，可保留錯誤後重跑 Setup。原始碼使用短路徑，避免 Windows 長路徑限制；腳本不修改系統登錄或停用防毒。

## 2. 填寫遠端連線設定

**這次確認的目標是 Intel x64 Kiosk，與 Ubuntu 位於不同網路。原網站已於2026-11-16更新，
公開入口為 `https://webnavior.aikcitri.qzz.io/kiosk/`，後台為
`https://webnavior.aikcitri.qzz.io/admin/system/models`。** 使用公開入口時，將下方設定的
`kioskUrl` 改成該 HTTPS URL，執行 Doctor／Start 即可，略過 Tunnel；SSH 區塊保留但不使用。
不要把 Ubuntu 的區網 IP 當成跨網路網址。既有本機設定不會被 Setup 自動覆寫，需手動修改。
公開健康端點與後台登入頁已驗證；Windows 實機及完整點餐仍待驗收。
原始碼 ZIP 是打包當下的快照，不會自動更新。2026-11-16 15:51 的舊包不含稍後修正的
HTTPS 文字浮動視窗、角色區新訂單按鈕與發票分步引導；請使用本次重新提供的 ZIP 及
相鄰 `.sha256` 檔。新包的 `WINDOWS-SOURCE-MANIFEST.json` 記錄打包時間與關鍵檔案雜湊。
解壓新版後重新執行 Build，再 Start，才會載入新的 Electron Main；只重新整理網頁不足以更新 Main。
保留原本 `kiosk.windows.local.json` 與 Windows 設備／商家登入資料，不從 Ubuntu 搬移登入狀態。

第一次 Setup 會產生根目錄 **`kiosk.windows.local.json`**，不會加入 git，預設已填共用 HTTPS 網址。
也可先複製 `kiosk.windows.example.json`；已有的本機設定不會自動改寫。SSH 欄位只留給選用通道模式。

```json
{
  "kioskUrl": "https://webnavior.aikcitri.qzz.io/kiosk/",
  "windowed": true,
  "diagnosticPort": 0,
  "ssh": {
    "host": "REPLACE_WITH_UBUNTU_IP_OR_HOST",
    "user": "aimax",
    "port": 22,
    "identityFile": "",
    "forwardTestSite": true
  }
}
```

| 設定 | 填寫方式 |
| --- | --- |
| `kioskUrl` | 一般跨機器測試保留共用 HTTPS 網址。只有選用 SSH 通道時改成 `http://127.0.0.1:15169/kiosk/`，那會連舊本機隔離後台。 |
| `windowed` | `true` 使用可調整大小視窗，方便研發；`false` 使用 Kiosk 模式。 |
| `diagnosticPort` | 預設 `0` 關閉。需要遠端協助檢查時可設 `9222`，只監聽 Windows 的 `127.0.0.1`；檢查後改回 `0` 並重開。不要把此埠開到區網或 Internet。 |
| `ssh.host`、`ssh.user`、`ssh.port` | Ubuntu 的可達位址、登入帳號與 SSH 埠。**不是 vLLM 的位址。** |
| `ssh.identityFile` | 可留空，用現有 SSH agent 或登入密碼；若用金鑰，填 Windows 本機私鑰路徑，例如 `C:\Users\you\.ssh\id_ed25519`。不把私鑰內容或密碼寫入檔案。 |
| `ssh.forwardTestSite` | `true` 會轉接自建測試站 5188 和既有 Menu 15170；只用商家網站時可設 `false`。 |

模型名稱、OpenAI API key、vLLM endpoint、SSE、Jev 開關等，仍在**同一個遠端後台**設定。Windows **不需要填 OpenAI／ASR／TTS 金鑰**。SSH 登入密碼由 SSH 本身詢問，腳本不儲存。

## 3. 開啟共用 Electron

一般跨機器測試直接執行，不需要啟動 Tunnel：

```powershell
.\scripts\windows\kiosk.cmd -Action Doctor
.\scripts\windows\kiosk.cmd -Action Start
```

第一次完成設備建立／配對，必要時登入商家。模型與互動體驗設定已接到共用後台，
和 Ubuntu 的「開啟共用 Electron」使用同一套；設備的硬體設定與登入各自保留。
Doctor 會確認健康檢查回傳資料庫及 Redis 就緒的 JSON，不能只收到 HTTP 200 網頁便算成功。

### 每台機器自己的測試網站

要選「PB 自有測試站」時，在另一個 PowerShell 視窗執行並保持開啟：

```powershell
.\scripts\windows\kiosk.cmd -Action TestSite
```

它使用 Setup 已安裝的 Node／pnpm／Vite，在本機 `127.0.0.1:5188` 啟動既有自建網站；
不需要再安裝 Bash、資料庫或模型，不開放到區網。再於 Kiosk 管理頁選用該網站。
結束時 Ctrl+C，測試站只保留當次記憶體資料。每台機器各自啟動、各自有購物車；
共用的是模型與點餐設定，並不是把所有機器的購物車混在一起。Windows 上此入口仍待實機驗收。

### 選用：SSH 通道與本機隔離後台

先確認 Ubuntu 的「PB 測試管理」已啟動；要用自建測試站時，也要在 Ubuntu 開啟 `test-sites/pb-order-lab/start.sh`。腳本不遠端重啟服務、清空資料或送出商家訂單。

在第一個 Windows PowerShell 視窗執行，並保持開啟：

```powershell
.\scripts\windows\kiosk.cmd -Action Tunnel
```

第一次連線需由你核對 Ubuntu 的 SSH 主機指紋並登入。腳本保留 SSH 的主機金鑰驗證，不自動接受未知指紋。通道只綁定 Windows loopback，轉接 15169（網站及 API）；選用轉接 5188、15170，不開放 Ubuntu 的資料庫或模型埠。

若 `ssh.exe` 不存在，在 Windows「設定 → 系統 → 選用功能」新增 **OpenSSH Client**。也可由管理員執行以下 Microsoft 內建功能安裝指令；不需要安裝 Windows SSH Server：

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

再開第二個 Windows PowerShell 視窗：

```powershell
cd C:\src\webnavior
.\scripts\windows\kiosk.cmd -Action Doctor
.\scripts\windows\kiosk.cmd -Action Start
```

Doctor 核對正確的 Electron／Node、遠端 `/readyz` 及 Kiosk HTML。瀏覽器可開 `http://127.0.0.1:15169/admin/kiosk/devices` 進行遠端後台管理；模型設定在 `/admin/system/models`。原本選用的模型和提示詞留在 Ubuntu。

Windows 是新設備：第一次要在 Electron 完成設備建立／配對，若使用需要登入的商家網站，也要在這台電腦登入。**Ubuntu 的設備憑證、PB cookie 不會複製過來。** Electron 裡選用真實 PB 或自建測試站，使用既有 Kiosk 管理頁的點餐網站設定；自建站 URL 雖為 127.0.0.1:5188，會透過上述通道連到 Ubuntu。

本機設定、登入及網站資料存在 `%LOCALAPPDATA%\Webnavior\Kiosk-Pilot`；關閉視窗或重建不會清除。正常 Start 保留 Chromium sandbox、context isolation 與既有權限政策，不添加 `--no-sandbox`。

### 如果要用公開 HTTPS

若改用其他公開部署，將 `kioskUrl` 填為該站實際的 `https://你的網域/kiosk/`。遠端必須已正確發布相同版本的 Kiosk、API、WebSocket、資源路徑、cookie 與可信來源；不能只把 URL 改成另一個 IP，就當成後台也一起搬好了。除了上述指定 LAN Kiosk 外，非 loopback 的 HTTP 會被拒絕。自建測試網站使用前面的 TestSite，在每台 Windows 本機啟動；選用 SSH 模式才轉接 Ubuntu 的自建站。

## 4. 測試與故障資料

先跑不接商家的腳本邊界與 Electron 合成流程：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\kioskTools.test.ps1
.\scripts\windows\kiosk.cmd -Action Smoke
```

Smoke 使用獨立暫存 profile 和 loopback 合成頁面，結束後清理，不使用正常 profile 或操作商家。Playwright 自動化會使用測試啟動參數；Smoke 通過不代表正常 sandbox、Windows 實體裝置或真實點餐全部驗收。正常 Start 的權限模式另外保留。

依序驗收：

1. Doctor 成功；正常 Start 可建立設備、載入角色及選桌頁；關閉再開仍保留設備／商家登入。
2. 語音／觸控選桌與開始點餐、餐點 modal 上手指可見、份數及加購數量用＋／－逐次更新。
3. 搜尋、推薦、份數補答、購物車增減、發票欄位；核對實際品項與金額。
4. 中間及右上角重新開始、正常關閉再開、閒置倒數後返回選桌，下一位不承接上一位的內容。
5. 文字模式確認後，再檢查實體麥克風、Windows 收音權限、VAD、TTS、回音、嘴型與插話。語音是先前暫緩的獨立驗收項目。
6. 商家送單與付款另經授權測試，不以自建站成功當成商家支付驗收。

啟動日誌位於 `%LOCALAPPDATA%\Webnavior\Kiosk-Pilot\launcher-logs`，包含 stdout、stderr、Chromium log。提供當次日誌、時間、顧客原句、所選網站和截圖即可接續排查；日誌可能含點餐或登入相關資訊，先檢查再分享，不要加入 git。

- **Doctor 連不到**：一般模式先確認共用 HTTPS 網址可開啟且後端正常。只有選用 SSH 模式時，才檢查通道視窗、Ubuntu 隔離服務與 Windows 15169 連接埠；轉接失敗會停止，不默默接到另一個服務。
- **黑畫面／立刻關閉**：先看 stderr 和 Chromium log，核對是否用錯執行版本。不要先停用 sandbox 或加任意 GPU 旗標。
- **正在執行無法 Build**：關閉此專案 Electron 再重建；不結束其他 Electron 應用程式，不刪除 profile。
- **重建後沒更新**：Build 會同時重建 `out/service/pb.js`、main 和 preload，完成後重開 Electron。共用網域的 Kiosk 與 API 依部署文件更新；PB 管理器的本機更新只處理隔離環境。只重建 Windows Electron 不會替換遠端網頁。

## 驗證範圍與來源

目前在 Linux 的官方 PowerShell 可攜版執行語法、URL／SSH參數驗證與 SHA256 邊界測試；未聲稱已在乾淨 Windows 實機跑過 Setup／Build／Start。實機結果待上述步驟補登。

固定版本與校驗來源：[Electron 發布資料](https://releases.electronjs.org/release/v46.0.0-alpha.2)、[Electron 官方校驗清單](https://github.com/electron/electron/releases/download/v46.0.0-alpha.2/SHASUMS256.txt)、[Node 官方下載與簽章](https://nodejs.org/en/download/archive/v24.22.1)、[pnpm install](https://pnpm.io/cli/install)、[Windows OpenSSH](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse)。
