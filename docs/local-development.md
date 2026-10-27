# AIRI 本機開發與第一階段 PoC 驗證

本文件記錄「智慧餐飲 AI 虛擬店員」第一階段的 AIRI 基線與驗證結果。此階段只安裝、執行和評估官方 AIRI；不實作餐飲業務、Python Agent、WebMCP、TTS/ASR 管線或外部服務整合。

> Agent 安裝或啟動時，優先讀取 `docs/ai/context/local-setup.md`；本文件保留完整的驗證證據、可攜性分析與已知限制。

## 基線與來源

- 官方上游：`https://github.com/moeru-ai/airi.git`
- 版本：annotated tag `v0.11.3`
- commit：`dbf812488829a61cc2e95909e021b215704d066c`（`release: v0.11.3`）
- 本機工作分支：`local/chore/airi-poc-baseline`
- Git remote：`upstream` 指向官方 repository；沒有假設或設定使用者 fork。

## 已驗證的環境

| 項目 | 結果 |
| --- | --- |
| OS | Windows Home 25H2，build `26200.9168`（登錄產品標籤為 Windows 10 Home） |
| Node.js | `24.13.0`（當時 Windows 驗證版本；目前專案要求 `24.22.1`） |
| pnpm | `10.33.0`（符合 root `packageManager`） |
| Electron | `41.2.1`，原生相依已由 `electron-builder install-app-deps` 安裝 |
| GPU | NVIDIA GeForce RTX 3060 Ti，driver `591.86`，8 GiB VRAM |

安裝使用不可變 lockfile：

```powershell
corepack pnpm install --frozen-lockfile
```

首次 Web/Desktop build 會透過官方 AIRI Vite plugin 下載 Live2D Cubism Web SDK 和官方範例 Avatar 資產；此為上游建置的必要步驟，不是額外餐飲功能。

## 開發啟動

```powershell
# Web
corepack pnpm dev:web

# Electron Desktop / Tamagotchi
corepack pnpm dev:tamagotchi
```

若要檢查 Desktop renderer，啟用本機 CDP：

```powershell
$env:APP_REMOTE_DEBUG = 'true'
$env:APP_REMOTE_DEBUG_PORT = '9250'
corepack pnpm dev:tamagotchi
```

CDP 僅應在本機開發時使用，且不要暴露到網路。

## 驗證結果

| 項目 | 結果 | 證據／限制 |
| --- | --- | --- |
| 依賴安裝 | 通過 | `pnpm install --frozen-lockfile` 完成 67 個 workspace；postinstall 與 Electron native dependency 安裝完成。 |
| Typecheck | 通過 | `CI=true corepack pnpm typecheck`，52 個 workspace，exit 0。 |
| Web production build | 通過 | `corepack pnpm build:web`，18/18 tasks successful。 |
| Desktop production build | 通過 | `corepack pnpm -F @proj-airi/stage-tamagotchi build`，main、preload、renderer 都完成。 |
| Lint | 有既有警告 | 規則掃描 2,681 檔、0 errors、7 warnings；輸出結束後 pnpm 外層在 Windows 未退出，逾一分鐘後人工中止，因此不可記為 exit 0。 |
| Root tests | Windows 環境失敗 | 1,336 passed、10 skipped、10 failed。失敗是 POSIX path 斷言、建立 symlink 的 `EPERM`，以及 server mock DB hook 10 秒 timeout；未修改上游程式來掩蓋。 |
| Web UI / Avatar | 通過 | `http://localhost:5173` 顯示 AIRI、輸入區、Provider onboarding 和預設 Live2D；console 顯示 PixiJS WebGL 2、Cubism SDK 5.0.0 初始化。 |
| Desktop UI / Avatar | 通過 | Electron 啟動、主 renderer `/#/` 出現，預設 Live2D Avatar 實際渲染；console 也確認 Cubism SDK 5.0.0 與 PixiJS WebGL 2。 |
| Settings / Provider | 可觀察 | Web onboarding 列出 OpenAI、Azure OpenAI、Anthropic、Bedrock、Gemini、Groq、OpenRouter、Ollama、DeepSeek 與 OpenAI-compatible。Desktop 的 settings 為 lazy window；其控制列的 tooltip wrapper 使 CDP 自動化無法可靠地等同人類點擊，因此不將其列為 UI click 通過。 |
| 原生 Provider 文字對話 | 阻塞，已精準驗證 | 現在無登入帳戶、API key 或本機 Ollama/相容伺服器；onboarding 固定遮罩會攔住送出。未使用 mock、假回覆或把 key 寫入原始碼。 |
| TTS | 未驗證（可選） | 沒有完成可對話 Provider，不能對 TTS 輸出做有意義的端到端驗證。 |
| ASR | 未驗證（非本階段要求） | 未啟動麥克風或 ASR 管線。 |

開發 console 的已知非阻斷訊息包括 i18n 缺漏翻譯、Vue Router `next()` deprecation、開發期 Electron CSP warning，以及匿名狀態略過 chat-sync WebSocket。它們不妨礙 Avatar/圖形初始化；production CSP 仍應在正式安全審查中再確認。

## GPU 與可攜性

### AIRI 是否綁定 NVIDIA/CUDA

第一階段檢視的 AIRI app 層沒有 CUDA、cuDNN、TensorRT、ROCm 或 DirectML 專屬相依。Avatar 顯示採 Electron/Chromium 的 WebGL、Three.js、PixiJS、Live2D Cubism，並以通用 WebGPU 偵測作為可選能力。現在的 RTX 3060 Ti 是可用的測試硬體，不是 AIRI 的必要條件。

瀏覽器本機推論相關功能使用 Transformers.js、ONNX Runtime Web、Kokoro 與 MediaPipe 等 Web/WASM/WebGPU 路徑；它們不是第一階段餐飲服務的必要依賴，也不代表 NVIDIA 專用 runtime。

### Linux + AMD/ROCm 建議

基本 AIRI UI/Avatar 的主要相容性前提是 Chromium WebGL，而非 CUDA 或 ROCm。Linux 上 AIRI Electron main process 會為 WebGPU/Vulkan 加入 Chromium flags；故 AMD Linux 的實際風險在於 Chromium/Electron 版本、Mesa/AMD Vulkan driver、瀏覽器 WebGPU 啟用狀態與顯卡測試矩陣，而不是 AIRI 應用程式有 NVIDIA-only code。

若是 Ubuntu 24.04 LTS 的 x86_64 機器（包括 Ryzen AI Max+ 395），可用 `bash scripts/installUbuntuAmd.sh` 安裝官方最新 Linux `.deb`、Mesa/RADV 與 Electron 執行期依賴。也可傳入本機產生的 `.deb` 路徑，以相同流程驗證尚未發布的套件。此安裝程式不安裝 AMDGPU-PRO、DKMS 或 ROCm，以免取代 Ubuntu 內建 amdgpu driver；完成後會印出 Vulkan/RADV 診斷結果。

從 source 在 Ubuntu 建置自訂版 `.deb` 的完整命令，見 [`docs/ubuntu-desktop-deployment.md`](./ubuntu-desktop-deployment.md)。

若目前要部署瀏覽器版 Stage Web、Stage Kiosk 與點餐頁，而非桌面 `.deb`，見 [`docs/ubuntu-web-deployment.md`](./ubuntu-web-deployment.md)。

ROCm 只有在未來餐飲 Agent 自己承擔本機模型推論時才需評估。建議讓該 Agent 的模型 runtime 與 AIRI UI 分離，按 Linux/AMD 部署另行選擇 ROCm 相容的模型服務，而不要把 GPU runtime 綁進 AIRI renderer 或 Electron main process。

### Windows → Linux 遷移檢查表

1. 使用 Node `24.22.1` 與 pnpm `10.33.0`，重新執行 frozen-lockfile install；不要複製 Windows `node_modules`。
2. 安裝目標發行版的 Chromium/Electron 所需系統 library，並確認 WebGL 與 Vulkan driver 正常。
3. 以乾淨 profile 啟動 Web 及 Desktop，檢查 `navigator.gpu`、WebGL、Live2D/VRM Avatar 和 console。
4. 為 NVIDIA、AMD/Mesa、無 GPU/軟體 fallback 各跑一次最小 smoke test；WebGPU 是 optional enhancement，不應阻斷文字聊天或 Avatar 的 WebGL fallback。
5. 若啟用本機 LLM/TTS/ASR，再分別驗證其 runtime 與 GPU backend；這屬未來 Agent/語音服務的部署責任，而非 AIRI UI 基線。

## 未來架構相容性

建議保持下列責任邊界：

```text
Customer / Store UI
        |
        | conversation, avatar state, speech state
        v
Project AIRI (Web or Desktop interaction layer)
        |
        | versioned HTTP / WebSocket event contract
        v
Restaurant Agent Service (independent Python service)
        |
        | WebMCP-first browser/order operations
        v
Ordering UI / POS / restaurant APIs
```

- AIRI 適合保留為 Conversation、Avatar、TTS/ASR orchestration 與使用者互動層。
- 餐飲 Python Agent 應擁有 session、訂單流程、業務狀態、外部工具權限與 audit log；不要耦合 AIRI 的 Pinia store、Vue 元件或 Electron IPC。
- AIRI 現有 Eventa、server channel、plugin/MCP 結構可作為設計參考，但第一階段不把餐飲能力接進 AIRI MCP/plugin。
- 未來整合採明確版本化事件合約（例如 `conversation.turn`, `order.draft`, `order.confirmed`, `speech.state`）。主通道預設是 Agent 直接以 WebMCP 驅動點餐 UI；AIRI 只呈現結果與接收對話，不成為下單控制平面。
- API key、登入 token 與模型憑證留在使用者設定或安全部署環境；絕不提交到 repository。

## 下一步（需要使用者提供的外部條件）

若要完成「真實原生 Provider 文字對話」驗證，請提供下列任一項的安全設定途徑，而不要把秘密貼到聊天或原始碼：AIRI 登入帳戶、可用的 OpenAI-compatible provider 設定、或可存取的本機 Ollama 模型服務。取得後只需在 AIRI 設定 UI 配置並回跑一則無敏感測試訊息；之後才進入餐飲 Agent 的獨立設計階段。
