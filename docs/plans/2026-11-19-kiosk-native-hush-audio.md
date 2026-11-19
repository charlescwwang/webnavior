# UMA-8 原生收音＋Hush CPU 整合計畫

狀態：來源實作與自動化驗證完成，Windows 0.7.1 試用包已建立；配套 Kiosk／管理網頁已發布，Windows 實體聲學驗收未完成。

## 配套啟用與真實串接驗證（2026-11-20）

使用者要求交付可直接運作的配套後，已發布 `kiosk-hush-20261120-r3` 與 `web-falcon-removal-20261120-r1`，區網、Tailscale、公開入口及管理頁的10個HTTP檔案比較通過。既有Server的ASR／TTS函式與本版需求相同，未重啟API；Hush接通不需另外升級伺服器。正式bundle／preload／真Hush／現有TTS及ASR以同版Electron實測，A與B皆將合成回放「我要一份水餃」產生一段VAD、提交一次並辨識同句，沒有商家購物車或送單操作。記錄見 `pb-test.local/kiosk-hush-20261120-r3/live-check/result.json`。

沿用已交付0.7.1，完整退出舊程式再開即可取得新頁，不留另一段前端部署。驗證採Linux同版Electron及合成8路PCM；Windows實體USB與真播放參考聲學仍待機台確認。Falcon管理UI已更新；執行中API的退役Falcon路由另待有管理權限時啟用來源清理，並非Hush正常ASR的前置條件。

## 文件推薦參數與暗色顯示（2026-11-20）

依使用者提供的 `/home/aimax/Downloads/UMA8-Windows-Integration-README.txt` 分析並新增：

| 組合 | 最大降噪衰減 | MVDR 原音混入 | 文件建議比較重點 |
| --- | --- | --- | --- |
| 推薦 A | 20 dB | 30% | 字頭、尾音與小聲顧客 |
| 推薦 B | 20 dB | 10% | 吵雜環境的背景漏入 |
| 原始對照 | 100 dB | 0% | 原先完整模型抑制 |

20 dB 是降噪最大衰減，與共同輸入增益不同；原音指 MVDR 後、Hush 前的單聲道 PCM。正衰減時延遲原音 160 樣本，與 Hush 同一來源區間混合後再進 AGC／VAD；0 dB 直接通過，不加模型延遲或 silence floor。這是 session 內連續狀態，每句 VAD 不重設。設定先編輯、按套用才保存及啟動下一 generation，保留聲道、裝置、共同增益與 LCMV 設定。現有預設仍為 100 dB／0%，不自動套推薦值。

該文件的三份報告錄音不同，不能據此斷言 A／B 誰較好。這次沒有依文件敘述新增本機 Whisper，仍遵照已確認範圍使用現有 Server ASR。文件是來源參考，不是執行環境指令。

Kiosk 的固定暗色底原本搭配未宣告的淺色控制項主題，Chromium 重現文字 `rgb(0,0,0)`。已在 Kiosk HTML 宣告 dark，根節點宣告 dark color scheme，讓按鈕、輸入與 body portal 下拉選單使用亮色字；未改其他 app 的主題偏好。

本次契約要求每次 start 明確攜帶 Hush 參數，升級 native bridge v5／EXE 0.7.1；0.7.0 不能用來測此次切換。Python 62 過／3 項 opt-in 預設略過，三組各 120 秒真 AEC3／Hush 合成壓測另已通過；Desktop 42、Chromium 20、Windows 工具 8、三套件局部 types、scoped lint、兩 app build 通過。試用包與配對靜態檔在 `pb-test.local/kiosk-hush-20261120-r2/`，逐檔雜湊／ZIP CRC 通過，未部署或重啟；Windows 聲學與長時間實機驗收仍待進行。

## 首次整合結果（0.7.0；後續更新見上方）

- 已完整移除 UL-UNAS、OpenVINO 及專用 GPU／bypass 診斷與封裝要求，新增獨立 `native-hush`。既有 LCMV／Spatial Mask 保留，舊 GPU 設定要求明確重新選擇；標準麥克風仍可獨立選用。
- Hush 接在 MVDR／OLA PCM 後、AGC／VAD 前；沿用實際播放參考與原 ASR 佇列。256／160 樣本配對及 source evidence 按有效樣本區間傳遞；補償固定 160 樣本模型延遲，不將 flush padding 當有效輸入。
- 真實 Linux Hush/Tract 函式庫與固定模型量測波形延遲為 160 樣本；Windows 同模型／ABI 的實際執行仍待目標機確認。上游對低能量幀提前回傳、凍結狀態的行為，已以明確記錄的低電平 Nyquist floor 維持時鐘。詳見原生音訊 README 與 `hush.py` 的 NOTICE。
- capture generation 分別持有 session；切換原生方案先等待舊程序退出，導航會取消待啟動的舊頁請求。列舉裝置使用獨立 capture-only 程序；native bridge 已升 v4，EXE 為 0.7.0。
- Python 49 項通過、1 項 opt-in 壓測預設略過；另以真 AEC3／Hush 跑過 120 秒合成音訊連續處理。Desktop 42、Chromium 18、Windows 診斷／封裝工具 8 項通過；Kiosk／Desktop／Shared scoped typecheck、變更檔 lint、兩個 app build 通過，未跑 root typecheck。
- 交付位於 `pb-test.local/kiosk-hush-20261120-r1/`：Windows ZIP、配對 Kiosk 靜態檔與逐檔雜湊、驗證紀錄。未寫入線上服務、未重啟、未建立 commit。
- 未完成的驗收為真 Windows DLL／UMA-8 聲道與增益、TTS 消回音／雙向說話、背景干擾／辨識品質、USB 恢復與至少 30 分鐘完整 kiosk 運行。這些不以 Linux 合成測試替代；目前交付為試用包。

以下保留已確認的設計與驗收契約。

## 目標與範圍

新增可由管理員明確選擇的「UMA-8 原生收音＋Hush CPU」方案。依使用者確認，這個方案不載入或執行 UL-UNAS，先沿用現有伺服器 ASR，不導入本機 Whisper。

後續範圍確認：移除整個 UL-UNAS GPU 收音方案，包含 UI 選項、模型初始化、專用資產、啟動器、診斷、測試與封裝要求。保留既有 LCMV／Spatial Mask，新增 Hush CPU；RTF／MVDR 與原生收音是共用能力，不隨 UL-UNAS 一起移除。角色渲染或其他功能的 GPU 使用不在此次移除範圍。

不改點餐語意、商家操作、ASR Provider、TTS 或主動迎賓政策。Falcon 已移除，不恢復其介面或影像擷取。既有可選嘴部幾何輔助仍依裝置設定運作。

## 依據與已知限制

- `/home/aimax/UMA8-Standalone/README.md:23` 列出原生收音、參考配對、重採樣、AEC3、共同增益、RTF／MVDR、降噪、AGC、VAD 的順序。
- 同檔第 9 行明確說明 Hush 在 MVDR 後處理 16 kHz 單聲道，與 UL-UNAS 二選一。Whisper 是停止收音後才執行的測試功能。
- `stage_probe.py:140` 起先選七路並同步重採樣麥克風與參考；第 163 行起依序執行 AEC3、增益、MVDR、Hush、AGC、VAD。
- `hush_stream.py` 以 ctypes 載入 `weya_nc.dll` 與 `advanced_dfnet16k_model_best_onnx.tar.gz`，要求 16 kHz、160 樣本／10 ms 幀。
- 後端核對：上游 [README](https://github.com/pulp-vision/Hush#readme) 明示 CPU、不要求 GPU；[原生 Cargo.toml](https://github.com/pulp-vision/Hush/blob/main/native/weya_nc_build/weya_nc/Cargo.toml) 啟用 `tract`，而 [FFI 實作](https://github.com/pulp-vision/Hush/blob/main/native/weya_nc_build/weya_nc/src/lib.rs) 使用 `DfModelShared`／`DfTract`。本機 DLL 的字串亦包含 tract-core／tract-linalg／tract-onnx，PE imports 僅見系統 DLL，未見 CUDA／DirectML／OpenVINO 的靜態相依。據此判定這份整合為原生 CPU 推論；這不是 Windows 現場硬體 profiling。不可只以 Python 自填的 `active_providers=["CPU"]` 當成驗證。
- 已檢視 DLL SHA256：`633958ef839c94af6f8f5f9f8fb33c4daedaeec0373cb39a03934fdd7efa6a32`。模型由使用者電腦上的 Python／DLL 載入，瀏覽器測試頁只經本機 API 控制與顯示，不在頁面載入模型。正式整合改由 Electron 管理子程序，不搬入測試 HTTP 服務。
- `reports/stage-test-20261119-230909-081705.json` 有約 17.78 秒音訊、約 5.01 秒累計 DSP 耗時、Hush 呼叫 P95 約 3.02 ms 的短測結果。累計 DSP 比值約 0.28，不是端到端延遲或辨識正確率。
- 分階段工具使用全零播放參考；短測結果不能證明 kiosk 真實 TTS 消回音、雙向同時說話或長時間穩定性。獨立工具也未涵蓋完整 Electron／Worklet／IPC 開銷。
- 自動 RTF 學習主導語音，不提供固定服務區邊界或說話者身分保證。

已依上述來源核對版本與雜湊。獨立資料夾是參考來源，不是正式執行位置；不直接覆蓋其 `worker-src` 到專案。

## 目標音訊與對話流程

```text
PortAudio：UMA-8 八路 RAW／48 kHz
  ＋ Chromium 實際應用播放 PCM
  → 有界參考配對與時鐘調整
  → 依設定選七路；麥克風／參考同步重採樣至 16 kHz
  → 七路 AEC3
  → 共同輸入增益
  → 獨立語音活動證據＋STFT
  → 線上 RTF／MVDR
  → 逆 STFT／重疊相加，還原單聲道 PCM
  → Hush CPU
  → 對齊空間證據的 AGC
  → WebRTC VAD＋空間證據切段
  → 現有完整發話事件／ASR 佇列
  → 伺服器 ASR → 現有點餐對話與 TTS
```

不再套第二次 Silero 切段。保留 RTF 在播放及回音尾段期間暫停學習的機制。TTS、提示音與等待音樂繼續由原本的獨立喇叭設定播放，AEC 取實際應用 PCM；不新增測試工具的播放串流或本機 HTTP 服務。外部網站／系統音訊不是這個應用參考的涵蓋範圍。

## 方案設定與生命週期

- 產品只保留 `existing` 與新增的 `native-hush` 選項；刪除 `native-gpu`。Hush 不改成全機預設。讀到舊 GPU 選擇時要求管理員重新選擇並套用，不把它當 Hush 別名、不自動啟動另一模型；既有方案的獨立調參值不被覆蓋。
- Hush 的原生輸入裝置、七路映射與共同增益獨立保存。初始草案沿用已測的 0–6 映射、30 dB 共同增益與現有驗證範圍，仍須實機校驗；不據此宣稱自動校正。
- VAD 靜音／最短語音參數沿用現有管理政策。AGC 與 RTF 初期沿用既有 Config，不增加與本次無關的調參介面。
- 同一時間只允許一個方案持有麥克風。切換時退休舊 generation、取消未提交 ASR、丟棄未完成發話至下一個靜音邊界，再啟動新方案。已接受的點餐工作維持原有所有權。
- Hush 的模型可由程序持有；每個 capture generation 擁有自己的 session／緩衝，停止或替換時釋放，不在每句話之間重設連續 DSP。若 DLL 無安全 reset API，重新建立 session。
- 重新載入、關閉、USB 中斷、PCM 不連續、推論錯誤或積壓超限時停止該 owner，拒絕 pending requests；舊回應不能寫入新方案。不得靠丟樣本、延長現有積壓上限或自動換模型維持運行。
- Hush 無法載入時回報具體原因，管理員仍可選回既有處理。Hush 啟動、status 與列舉裝置都不得觸發 UL-UNAS／OpenVINO 初始化。

## 實作分期

### 1. 音訊核心：先隔離 UL-UNAS，再接 Hush

修改既有 `apps/stage-kiosk-desktop/audio/src/uma8_frontend`，保持收音、重採樣、AEC3、RTF／MVDR、增益與切段的既有模組邊界。

先移除 UL-UNAS 的建構、推論與設定相依，以測試對照確認保留的原生 DSP 不需要該模型，再移入 Hush 包裝，處理資產定位、DLL/session 載入與釋放、有限數值檢查與錯誤。不另增長期無降噪產品選項；退休的 UL-UNAS bypass 啟動器亦移除。

目前 `Frontend` 的降噪位置是頻譜域，不能將 Hush 直接注入既有 `denoiser.process(spectrum)`。刪除 UL-UNAS 頻譜降噪分支，將 Hush 明確接在 OLA 還原 PCM 後。不為退休模型留下雙降噪介面，不複製整套 StagePipeline，也不建立只轉傳參數的服務。

### 2. 來源樣本與空間證據對齊

- MVDR／OLA 輸出以 256 樣本 hop 為主，Hush 接收 160 樣本幀；建立有界 PCM 與證據區間配對，不能把單個 hop 的布林證據直接套到跨 hop 的 Hush 輸出。
- 先確認 Hush DLL 的實際 lookahead／輸出延遲與尾端處理能力。延遲應可量測、記錄與補償；不能僅由 10 ms 幀長推定。
- 保留來源樣本時鐘、重採樣與 AEC 延遲補償。AGC、VAD、RTF telemetry、語句起點及 PCM 必須指向相同來源區間。
- 現有 Worker 以 256 樣本拆輸出並索引 telemetry，需改成依實際對齊輸出區間產生 descriptors；檢查 renderer 不再依賴固定 hop 長度。
- 正常離線 finalize 可補齊處理幀以排出有效尾音，但不得把補零算成實際收音。切換／取消則捨棄未完成語句，不將尾端 flush 成新訂單。

### 3. Electron、共享契約與 kiosk 設定

沿用 `nativeAudio.ts` 的子程序監督、二進位 stdin/stdout 與 Eventa。原生通訊集中在 `packages/stage-shared/src/kioskNativeAudio.ts`，新增有限的方案選擇／能力資訊；renderer 不傳 DLL 路徑、任意模型網址或 shell 參數。

契約變更需有明確能力／版本辨識並同步更新 main、preload、renderer；舊 EXE 顯示更新需求，不猜測或靜默降級。原生 worker 只保留 capture-only 與 Hush 處理用途，刪除 GPU provider 選擇及其模型生命週期。

`nativeCapture.ts` 沿用播放參考與完整發話事件；`KioskScene.vue` 將 Hush 納入原生路徑，不新增 ASR／對話佇列。`useKioskMicrophone.ts` 與設定元件增加明確方案選項及獨立保存。移除這些共用路徑中把所有 native 音訊寫成 GPU 的名稱／錯誤／診斷假設。

診斷至少顯示：選定方案、Hush runtime／CPU、輸入裝置、收音回呼狀態、來源及處理樣本數、處理耗時、積壓、輸出電平與 VAD 狀態。Hush 不呈現成 GPU 驗證成功或等待 GPU。一般運行不新增逐階段顧客錄音；測試錄音維持明確啟用。

### 4. Windows 資產與封裝

- 核對 Hush DLL 架構、相依 DLL、實際 ABI、模型版本、來源雜湊與可散布授權；缺少資訊時不能標示可正式散布。
- 正式資產納入 repo 既有模型／runtime manifest 與封裝輸入，不依賴 `/home/aimax/UMA8-Standalone` 絕對路徑，不在現場執行 pip 或下載模型。
- 調整 `prepareAudio.py`、`packagePortable.py`：移除強制 OpenVINO／GPU.0、GPU qualification reference、UL-UNAS model hash 與專用測試啟動器要求，改驗 Hush runtime、模型及 CPU 收音所需資產。移除封裝名稱與 manifest 將整包標為 GPU 版的假設。
- 盤點 runtime wheels 與檔案依賴，移除僅供 UL-UNAS 使用的 OpenVINO／telemetry／模型及資格測試資產。先核對 Hush DLL 的實際相依，保留 NumPy、重採樣、PortAudio、AEC3、WebRTC VAD 等仍使用的元件；不因套件名稱含推論或 GPU 就移除其他功能的依賴。
- 檢查來源快照、每檔雜湊、ZIP CRC、乾淨解壓後啟動與授權清單。更新必要的 EXE／前端版本與操作指南。
- 發布需配對的新 EXE 與 Kiosk 網頁；只換網頁無法取得 Hush runtime。這項音訊改動不要求變更 Server ASR API，但前一輪 Falcon 移除另有 Server／管理介面的同步發布需求。

## 驗證與完成條件

| 層級 | 必驗行為 |
| --- | --- |
| Python／DSP | 明確 Hush 選擇不建立 UL-UNAS；不同輸入 chunk 邊界得到等價連續輸出；160／256 樣本配對、證據、延遲、有效尾音、重啟隔離、非有限輸出與 session 釋放 |
| 原生／IPC | 真實子程序的選擇與 status、Float32 傳輸、generation 隔離、錯誤及 EOF／timeout／關閉清理；無 Hush 的平台明確 skip 真 DLL 測試，不能假裝為 DLL 成功 |
| Chromium | 只顯示既有處理與 Hush，設定互不覆蓋；舊 GPU 選擇要求重新套用；Hush 不呼叫 getUserMedia、仍可獨立選喇叭、失敗可手動選回、切換取消未提交收音、完整片段只進 ASR 一次 |
| Windows 實機 | 真 Hush DLL 與 UMA-8、實際聲道映射、TTS 回音、雙向同時說話、旁人干擾、短答／長句、USB 中斷及恢復操作、反覆切換與重開 |
| 持續效能 | 本專案初期建議觀察約 30 分鐘（非 Hush 強制要求或啟動門檻），同時運行 avatar、原有相機政策、ASR／TTS；記錄處理比值、P95／max、佇列與記憶體，確認無持續增長或積壓中止 |
| 辨識品質 | 固定有正確逐字稿的點餐語句，與既有方案／無神經降噪對照；檢查首尾音、數量、否定、更正與背景誤觸發，不只看是否回傳文字 |

即時處理的必要條件是完整 DSP 平均處理比值低於 1，且持續測試不超出既有佇列界限；另記錄效能餘裕，不把短測數字當延遲 SLA。單步 P95 應按該次實際音訊量解讀，不直接把不同 chunk 長度混比。聲學品質與點餐誤觸發須有實機結果才能宣布通過。

先執行最小相關 pytest／Vitest，再做 Kiosk、Desktop、Shared 套件型別檢查、變更檔 lint 與相關 build；不自動跑 root typecheck。既有 LCMV／Spatial Mask 必須有選測回歸。驗證完成後更新受影響 README、原生音訊文件與交接。

## 交付與驗收界線

1. 先交付來源變更、針對性測試結果與可檢查的 Windows 試用包，標示尚未通過的實體驗收項目。
2. 通過 Windows 完整 kiosk 驗收後，才標示可現場使用；保留明確選回既有方案的操作。
3. 計畫本身不授權部署或重啟正在使用的 kiosk；實作、試用包與正式發布分開交付。不建立 commit。

### AEC 開關（2026-11-20）

Hush 設定加入獨立 AEC 開關，預設開啟；按套用後保存並更換收音 generation，
切換 A／B preset 不改 AEC 選擇。`aecEnabled` 經 bridge v6 傳入 Python
`Config.aec_enabled`，關閉時不建 AEC3 bank、亦不補償 AEC 128 樣本延遲；
其餘 RTF／MVDR、Hush、AGC、VAD 順序不變。配對 EXE 為 0.7.2。
關閉 AEC 仍需傳送播放參考及遵守同步上限，不能用它視為 250 ms 傳輸問題的修復。

### 即時參考傳輸修正（2026-11-20）

Hush 的播放參考與 native completion ack 改由 AudioWorklet ↔ 專用
`nativeCapture.worker.ts` ↔ Electron MessagePortMain ↔ Python 直接交換。
UI 僅接收結果與遙測，350 ms UI 阻塞不再阻擋同步確認；真正原生停頓
仍受原有 250 ms 上限約束，不提前 ack、不丟 reference、不擴大緩衝。
沿用 ArrayInput generation／導航／裝置替換清理，Hush `connect` 控制操作
先 start 模型再 open 硬體與交付 port；raw LCMV bridge v1 不變。
Electron 邊界 PCM 必須 structured clone；ArrayBuffer transfer 在實測
Electron46 alpha.2 讓整包變 null（electron/electron#34905）。Worklet與
Web Worker 間仍 transfer。配套橋接 v7／EXE0.7.3。
另修正原生收音診斷不再要求 browser MediaStream、忽略瀏覽器分支的過期
錯誤並更新 Hush CPU 標示；真正啟動錯誤仍透過 audioStartupError 顯示。

### 啟動／套用設定時的握手（2026-11-20，bridgev8／0.7.4）

使用者最新0.7.3在啟動／套用後立刻報playback delivery250ms。另以真
Electron/Python與模擬PortAudio定時回呼，重現connect返回後UI卡350ms，
尚無第一包處理即native capture250ms backlog；這是已確認啟動缺陷，
其錯誤文字與現場playback不同，不宣稱完全證實同一原因。

connect只初始化模型並交付port；Worklet接好reference port、回ready但
尚不跑時鐘，Worker才發native open；open成功由Worker直接發run給
Worklet，UI等native-ready才標為已啟動。啟動／裝置延遲不計入連續
音訊250ms期限；running仍保留原保護。playback超時附sent／ack樣本數、
pending、最舊封包年齡與最後RTT／DSP時間，若現場再發生可區分卡點。

### 使用者決定移除 Hush AEC（2026-11-20，0.7.5／bridgev9）

使用者在0.7.4回報sent21504／ack9216／pending32／oldest260ms／RTT233ms／
DSP3ms，之後明確決定移除此流程AEC，測試是否改善疑似配對問題。這次
完整解除Hush播放配對，並非只把之前aecEnabled開關設false。

Hush native Capture以paired=False直接排出8路麥克風，無播放參考等待或
100ms人工延遲；選7路→16k→共同增益→RTF/MVDR→Hush→AGC→VAD→ServerASR。
原生Worker強制AEC停用、不讀入reference，UI移除Hush AEC開關；既存
AEC儲存偏好不再傳入此契約。其餘LCMV／Spatial Mask的AEC不改。

Hush專用瀏覽器Worker以單一in-flight native read完成後16ms再讀，讀取
實際已錄樣本，不建立AudioContext／AudioWorklet、不收送TTS PCM或ack。
計時抖動只改批次長度，不改來源樣本時鐘。native queue/read仍250ms受限，
處理塞車仍明確報錯；沒有播放參考也不保留RTF playback hold。
移除AEC後喇叭回錄可能被辨識，需現場確認；不宣稱已證明Windows根因。
