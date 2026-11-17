# Kiosk 新增 Spatial Mask 收音方式與可選 AEC3

狀態：2026-11-17 已隨 ordering-microphone-20261117-r1 部署並核對；Windows 實體驗收待完成。

## 2026-11-17 合併更新準備

已與跨頁點餐、發票續填及付款結果重開一起建置為
`ordering-microphone-20261117-r1`。新前端／PB bridge／Windows ZIP在
`pb-test.local/ordering-microphone-20261117-r1/`，READY.md與只讀check通過的
activate.py已由使用者執行。API ready，6份API/shared與603靜態檔、7個LAN／公開HTTP入口及資產核對通過；**沒有替現場切換演算法**。
打包後Worker off/on smoke各22個512PCM packets，reference0／38400；合併版
麥克風Chromium12與synthetic120秒stress1通過。實機驗收仍維持下方待辦。

## 2026-11-17 ASR失敗另案調查

22:28–23:15的93次legacy ASR失敗皆為上游HTTP400：
`Missing speech detect model: ''`，Webnavior轉503再由前端顯示通用語音失敗。
直接上游的1秒synthetic silence也重現；`chunking_strategy=none`仍同錯。
這不是新Spatial Mask/AEC實體品質驗收，也不是已證明Tailscale斷線。
尚未修改服務設定或程式；需查上游speech_detect_model預設／契約，完整證據見handoff。

## 本次交付與驗證

- 已新增 legacy UMA-8 的 Spatial Mask 與獨立 AEC3 開關，明確套用後生效；
  現有 LCMV 為初始預設，Falcon／一般 mic 保持原路徑。新設定使用獨立 local keys。
- 歷史核心與 oracle 從 `f616ca4` 復原。AEC off 不建立實例／播放參考，不額外
  resample；AEC on 重用現有七路 AEC3。共用 capture 邊界強制 48 kHz。
- 新增 active algorithm／AEC、lag／reference／RMS／limiting 管理診斷；設定
  替換取消未完成 capture／ASR，既有已接受點餐工作不重播。嘴部政策未改。
- Vitest：核心／LCMV／嘴部 25 項通過，120 秒合成 Mask stress 1 項通過；
  Chromium 共 12 個不同案例通過（capture 4、Worker mapping 1、設定 4、
  裝置 fake-media 2、診斷 1）。stress 是加速合成音訊，不是實機連跑。
- changed-file ESLint 與 Vite production build 驗證；打包後 Worker 在獨立本機
  HTTP／Chromium smoke 中，AEC off/on 均輸出 22 個連續 512-sample packets；
  reference frames 分別為 0／38400。這不是實體回音消除驗收。
- Kiosk package typecheck 執行後僅報其他點餐工作中的
  `src/services/browserQuestionWindow.test.ts:161,163`：`checkoutVersion` 不屬於
  `QuestionSnapshot`；未修無關內容，未跑 root typecheck。
- 驗證紀錄：`/tmp/spatial-{unit,stress,browser,devices,capture-final,lint-final,build}.log`、
  `/tmp/spatial-typecheck-final.log`、`/tmp/spatial-built-smoke.json`。
  建置輸出在 `/tmp/kiosk-spatial-mask-build`，未發布或切換任何現場設備。
- 待辦：下方實體 UMA-8／Windows 三組比較、30 分鐘實際運行與真實回音／插話
  驗收。通過前不更改既有設備的預設演算法。

## 需求與依據

使用者回報 master 約 2026-11-06 的版本收音穩定，唯一明確缺點為收到機台
TTS 自身回音。本計畫以 `f616ca4`（2026-11-05 晚間）的 Spatial Mask 為來源，
新增可選收音方式，並可獨立設定是否啟用 AEC3；保留現有方式供比較及切回。
使用者的現場經驗是選擇比較基準的依據，不等於新版 AEC3 組合已通過驗收。

這次新增的是音訊前處理，不是新的 ASR provider，也不是整套回退舊程式。
現有 legacy 嘴部放行規則仍有效，因此「Spatial Mask＋AEC3 關閉」僅重現歷史
音訊前處理，不宣稱完整還原當時端到端行為。嘴部規則是否變更須另作比較決策。

## 設定與操作契約

沿用本機 Admin「本機麥克風與喇叭」設定，不新增 Server／DB 設定。

| 設定 | 規劃行為 |
| --- | --- |
| 裝置處理 | 保留自動／UMA-8／一般麥克風，仍負責硬體路徑選擇 |
| 舊 ASR 陣列演算法 | 新增現有 LCMV／Spatial Mask（11 月穩定版）二選一 |
| Spatial Mask AEC3 | 獨立開關，首次選擇預設開啟，關閉可作歷史基準比較 |
| Spatial Mask 增益 | 獨立保存，初始 +15 dB，可調 0–80 dB；不是已校準值 |
| 共用陣列幾何 | 沿用七路 channel mapping、半徑；預設 0..6、44 mm |
| 既有 LCMV 設定 | 保留原值與原 AEC3 行為，切回不被新方式改寫 |

原本地 JSON `kiosk/audio/microphone-processing` 不塞入新欄位或添加舊資料
fallback。新選擇以獨立 key 保存，例如 `kiosk/audio/legacy-array-algorithm`；
Spatial Mask 另以 `kiosk/audio/spatial-mask` 保存 `aec3Enabled`、`gainDb`。
首次沒有新 key 時選 LCMV，避免現有設備升級後自行切換。

AEC3 開關只控制新增方式；不改現有 LCMV。只有 legacy＋陣列路徑顯示新選項。
Falcon 與一般麥克風保留原管線；其狀態須清楚顯示新設定未套用，保存的 Spatial
Mask 選擇在切回 legacy 後再生效。辨識模式仍由既有 Server policy 決定。

AEC3 與演算法使用者變更需明確套用／重新連接，先提示會丟棄尚未完成的半句。
套用時建立新 capture generation，取消未完成 capture／ASR，不能重新提交已接受
的點餐需求。不以每次 VAD 起訖重開 Worklet、Worker 或 DSP。

## 管線

```text
UMA-8 48 kHz／8 個實際聲道，瀏覽器 AEC／NS／AGC 關閉
  → 七路實體 channel mapping
  → AEC3（開啟時；48 kHz、7 capture／2 render）
  → Spatial Mask 內建 48→16 kHz FIR
  → 正面方向競爭遮罩／平滑／overlap-add
  → 獨立增益與峰值限幅
  → 現有 Silero VAD、嘴部／在場放行、整句 WAV ASR
  → 現有 utterance queue、Jev／Main
```

AEC3 關閉時，七路原始樣本直接送 Spatial Mask，不建立 AEC3 instance、不載入
其 WASM、不訂閱播放參考 bus；不能只傳入零參考訊號假裝關閉。
AEC3 開啟時沿用 `playbackReference.ts`：顧客／Admin TTS、提示音與等待音樂
均經既有播放參考，收音晚於播放開始仍能接入。參考路徑不得再次播放出聲。

沿用當時 Spatial Mask 的數學與來源註解：正面 -10/-5/0/5/10 度與其他方向
比較相干性，頻率／時間平滑，沒有硬 Gate。直接從歷史來源復原核心與 oracle，
先查原始碼及 fixtures 的授權／出處；不得把目前 `packet.mask` 名稱誤當成
已經是 Spatial Mask，目前它其實是 LCMV 輸出。

本次重用既有 AEC3 依賴、Worker／Worklet、Eventa 契約與 InputGain，不新增
套件。若實作發現必須替換依賴，先研究候選並請使用者選擇，不在本計畫暗定新庫。

## 整合邊界與生命週期

- `useKioskMicrophone.ts` 擁有新偏好與驗證；硬體選擇與 DSP 演算法分開。
- `KioskMicrophoneSettings.vue` 顯示演算法、AEC3 開關及獨立增益；翻譯放在
  `packages/i18n`，不把演算法實作細節帶入顧客點餐畫面。
- `captureProtocol.ts` 在 owning module 定義明確的 LCMV／Spatial Mask
  discriminated configuration；LCMV 不強制攜帶新方式欄位，Spatial Mask 不需
  LCMV tuning。沿用 Eventa，不另建平行訊息協定。
- `capture.ts` 與 `capture.worker.ts` 依設定建立必要資源，沿用 source clock、
  有界排程及 generation 隔離。先檢查既有 FIR／增益實作是否能直接重用；歷史
  Mask 若需保留自己的 FIR 以符合 oracle，不得再串目前 decimator 造成二次降採樣。
- `KioskScene.vue` 僅選擇設定、接收處理後 PCM，沿用目前 legacy 的 recording
  與 detection 同路策略；Falcon 維持現有 aligned raw recording 與獨立增益。
- 類似 `PcmPacket.mask` 的跨邊界欄位若改為中性名稱，必須同步生產者、消費者與
  測試；不另造旁路來遮掩契約含義。只做本次新增演算法必要的最小修改。

48 kHz input offset、16 kHz output offset 與來源時間必須連續；AEC 480-sample
分塊、Mask lookahead／FIR 延遲不能用 Worker 完成時間代替。沿用真實樣本數與
有效區間，補零只能服務推論或 DSP flush，不得變成額外可辨識的語音。
新方式不套用 LCMV 專屬 1024-sample 延遲補償；Mask 時間對齊須獨立以 impulse
與分塊測試核對，避免直接複製舊延遲常數。

停止、切換裝置／演算法／AEC3、辨識模式切換、離頁或失敗，均釋放本 generation
的 Worker、Worklet port、播放參考訂閱與 AEC WASM；晚回 PCM 不得流入新句。
沿用約一秒 backlog 上限。初始化或運行失敗顯示管理診斷並停止該管線，不默默
關閉 AEC3、換演算法或換麥克風。由管理員明確切回既有 LCMV。

## 增益與診斷

歷史 +65 dB 是比較點，不直接視為 AEC3 後的合適值。先以 +15 dB 作可操作初值，
現場依正面小聲語音、殘留回音與限幅比例調整；比較 AEC3 開／關時保持相同增益，
並記錄所有設定。需要歷史參考時可明確調至 +65 dB，不變更既有 LCMV 增益上限。

Admin／黃色診斷顯示請求與實際生效的演算法、AEC3 開／關／啟動失敗、實際聲道、
source／output frames、處理延遲、播放參考非零 frames、增益前後 RMS／peak、
限幅比例、VAD starts／segments 與嘴部／在場阻擋原因。沿用既有診斷通道，
不連續寫入波形或相機資料。參考 frames 增加只能證明接線，不代表消回音成功。

## 實作階段與驗證

1. 固定來源：從 `f616ca4` 取回 Mask 核心／oracle／出處，先以 Vitest 驗證歷史
   fixture、不同輸入分塊的一致性、靜音、長時間串流與真實樣本數。
2. 新增新設定與 Worker 分支：先完成 AEC3 關閉，再完成開啟；以真 Chromium
   AudioNode→Worklet→Worker 驗證 8ch、16k PCM 連續、無二次 resample、無重播。
3. 接 Admin 與 Scene：驗證保存、套用、切回、取消、設定不互相覆寫；回歸 Falcon
   與一般 mic 沒有選到新分支，既有嘴部規則保持原行為。
4. 驗證資源生命週期：AEC3 關閉時不建立 WASM／reference；開啟時所有機台播放來源
   有 reference；切換中斷半句、晚回隔離、backlog 失敗與重啟均測試。
5. 跑受影響 Kiosk／Stage UI 的聚焦 tests、package scoped types 與 changed-file
   lint；不自動跑全倉 typecheck。更新 Kiosk README、audio README 與必要共享契約
   文件，之後才進行部署與實機驗收。

自動化驗證不使用合成 MediaStreamDestination 假稱 USB 真八聲道通過；既有測試
以 AudioNode 邊界驗證 DSP，實際裝置另測。比較測試不觸發顧客隊列、工具或商家訂單。

## 現場比較與採用門檻

固定 Windows、UMA-8、喇叭位置／音量、站位、ASR／VAD／嘴部設定，分別比較
現有 LCMV、新 Mask＋AEC3 關、新 Mask＋AEC3 開。先保存現有設定供切回；每種
組合記錄版本、幾何與增益。DSP 可用同一份經授權的多聲道錄音重播比較；AEC3
還需同步播放 reference，不能用只有麥克風的單聲道錄音判定效果。

| 情境 | 每組最少 | 記錄與通過方向 |
| --- | --- | --- |
| 正面一般句／小聲說話 | 各 10 句 | 首尾字完整率、漏句、ASR 文字錯誤 |
| 「好／不要／兩份」 | 各 10 次 | 短句辨識率與未放行原因，不只看 VAD 機率 |
| 純 TTS、顧客閉嘴 | 20 次播音 | TTS 誤成顧客 ASR 與 AI 回覆次數 |
| TTS 中顧客插話 | 20 句 | 真正收句／辨識成功率，不能以停止收音達成零回音 |
| 旁人側面說話 | 20 句 | 誤收數，並區分嘴部擋下與方向處理抑制 |
| 低頭、轉頭、短暫遮擋 | 各 10 句 | 音訊是否存在、嘴部 lease 是否丟整句 |
| 持續運行與反覆切換 | 30 分鐘／20 次 | lag、資源釋放、無累積延遲與舊句重播 |

採用新方式需同時滿足：Mask＋AEC3 開比關閉明顯減少 TTS 誤收、測試集純 TTS
不產生顧客操作，而且正常／小聲／短句及插話的成功數不低於固定基準。
若純 TTS 沒觸發只是被嘴部擋下，不算 AEC 改善證據，還要比較處理後回音能量與
插話結果。未達標保留既有預設，記錄失敗層級後再調整；不以提高嘴部門檻掩蓋回音。
有限測試通過不宣稱所有房間或所有音量都不會回音。

第一階段交付為可選方式與上述對照結果，不自動把所有設備預設改成 Spatial Mask。
