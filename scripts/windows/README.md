# Windows 遠端 Kiosk 建置與啟動

這套腳本供乾淨的 Windows 10/11 x64／ARM64 電腦，從本專案原始碼建置及執行 **Kiosk Electron**。API、後台、資料庫、Jev／Main 模型、ASR／TTS 設定和金鑰仍放在 Ubuntu；不需要在 Windows 再建一份資料庫或複製伺服器 `.env.local`。

這是目前共同研發用的啟動工具，包含本機 Electron 合成流程測試；Windows 實體麥克風、觸控、DPI、付款及整套點餐仍要在目標電腦驗收。沒有產生安裝包、簽章或自動更新服務。

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

架構預設自動辨識；必要時每個指令均可加 `-Architecture x64` 或 `-Architecture arm64`。請在相同架構完成 Setup、Build、Start。

下載需要能連到 Node.js、GitHub Releases 及 npm registry。若 SHA256 不符會停止，不解壓；不要繞過檢查。Windows 防毒、代理或網路中斷造成的下載失敗，可保留錯誤後重跑 Setup。原始碼使用短路徑，避免 Windows 長路徑限制；腳本不修改系統登錄或停用防毒。

## 2. 填寫遠端連線設定

第一次 Setup 會產生根目錄 **`kiosk.windows.local.json`**，不會加入 git。也可先複製 `kiosk.windows.example.json`。目前這台 Ubuntu 的區網位址核對為 **192.168.8.52**、帳號 **aimax**、SSH port **22**；更換主機或網段時必須改成可連線的位址。

```json
{
  "kioskUrl": "http://127.0.0.1:15169/kiosk/",
  "windowed": true,
  "diagnosticPort": 0,
  "ssh": {
    "host": "192.168.8.52",
    "user": "aimax",
    "port": 22,
    "identityFile": "",
    "forwardTestSite": true
  }
}
```

| 設定 | 填寫方式 |
| --- | --- |
| `kioskUrl` | 使用 SSH 時保留 `http://127.0.0.1:15169/kiosk/`。它是 Windows 本機通道入口，會通到 Ubuntu；不是在 Windows 啟動另一個 API。 |
| `windowed` | `true` 使用可調整大小視窗，方便研發；`false` 使用 Kiosk 模式。 |
| `diagnosticPort` | 預設 `0` 關閉。需要遠端協助檢查時可設 `9222`，只監聽 Windows 的 `127.0.0.1`；檢查後改回 `0` 並重開。不要把此埠開到區網或 Internet。 |
| `ssh.host`、`ssh.user`、`ssh.port` | Ubuntu 的可達位址、登入帳號與 SSH 埠。**不是 vLLM 的位址。** |
| `ssh.identityFile` | 可留空，用現有 SSH agent 或登入密碼；若用金鑰，填 Windows 本機私鑰路徑，例如 `C:\Users\you\.ssh\id_ed25519`。不把私鑰內容或密碼寫入檔案。 |
| `ssh.forwardTestSite` | `true` 會轉接自建測試站 5188 和既有 Menu 15170；只用商家網站時可設 `false`。 |

模型名稱、OpenAI API key、vLLM endpoint、SSE、Jev 開關等，仍在**同一個遠端後台**設定。Windows **不需要填 OpenAI／ASR／TTS 金鑰**。SSH 登入密碼由 SSH 本身詢問，腳本不儲存。

## 3. 開啟通道與 Electron

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

將 `kioskUrl` 改為遠端實際的 `https://你的網域/kiosk/`，可略過 Tunnel。遠端必須已正確發布相同版本的 Kiosk、API、WebSocket、資源路徑、cookie 與可信來源；不能只把 URL 改成另一個 IP，就當成後台也一起搬好了。非 loopback 的 HTTP 會被拒絕。公開部署若仍要用 Ubuntu 的自建站，必須另行安排可達網址；本文件的預設 SSH 方案已處理這個問題。

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

- **Doctor 連不到**：確認通道視窗仍開著、Ubuntu 服務啟動、SSH 可達，以及 Windows 15169 沒有被其他程式使用。SSH 轉接失敗會停止，不默默接到另一個服務。
- **黑畫面／立刻關閉**：先看 stderr 和 Chromium log，核對是否用錯執行版本。不要先停用 sandbox 或加任意 GPU 旗標。
- **正在執行無法 Build**：關閉此專案 Electron 再重建；不結束其他 Electron 應用程式，不刪除 profile。
- **重建後沒更新**：Build 會同時重建 `out/service/pb.js`、main 和 preload，完成後重開 Electron。Ubuntu 的遠端 Kiosk 前端則仍需用 PB 管理器更新；只重建 Windows Electron 不會替換遠端網頁。

## 驗證範圍與來源

目前在 Linux 的官方 PowerShell 可攜版執行語法、URL／SSH參數驗證與 SHA256 邊界測試；未聲稱已在乾淨 Windows 實機跑過 Setup／Build／Start。實機結果待上述步驟補登。

固定版本與校驗來源：[Electron 發布資料](https://releases.electronjs.org/release/v46.0.0-alpha.2)、[Electron 官方校驗清單](https://github.com/electron/electron/releases/download/v46.0.0-alpha.2/SHASUMS256.txt)、[Node 官方下載與簽章](https://nodejs.org/en/download/archive/v24.22.1)、[pnpm install](https://pnpm.io/cli/install)、[Windows OpenSSH](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse)。
