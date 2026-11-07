# Firefox 陣列麥克風最小整合計畫

日期：2026-11-05。狀態：已分批提交、完成切換與來源站驗證；實體 UMA-8／真人方向效果尚待驗收。


## 2026-11-05 發布

發布包：`/home/aimax/.local/share/webnavior/releases/spatial-mask-20261105-002420`。更新Kiosk、自動Mask選路、後端設備WARN與獨立比較頁；Menu／Admin／DB維持原版。舊Admin比較錄音與migration0047不在本次範圍。使用者已執行管理員切換；已獨立核對3198個發布檔案、50個來源站入口／資源、API執行目錄與livez／readyz（DB／Redis正常）。公開瀏覽器互動與實體麥克風／真人效果仍未驗收；現有頁面需重新整理。

乾淨版本35個Kiosk單元、2個VAD、7個共享WAV與1個Server診斷案例通過。瀏覽器92通過／1失敗／6略過；結帳焦點案例在未修改元件與原版翻譯下同樣失敗，證據保留。全庫lint零錯誤；全庫型別檢查遇既有Electron／SDK問題；受影響檔lint及Server／Kiosk型別與建置通過。未驗證真人音訊與實體UMA-8，未呼叫模型。

以下保留各階段設計與候選驗證紀錄；提交／發布狀態以本節為準。

## 2026-11-04 方向更新：Spatial Mask，保留既有 VAD／STT

使用者選定先採用附件中的 Spatial Mask 思路，不含 Spatial Gate；只參考演算法與多聲道處理，不整包移植。本節是後續整合的主方向，下方 LCMV 章節保留既有未部署實作與驗證基準，不能解讀成此次仍以 LCMV 為主。已完成下述候選整合與合成驗證；尚未提交或部署 Mask，真人／實機效果仍待錄音。

目的是降低側向旁人語音對點餐辨識的干擾，不承諾僅靠聲學處理便能排除所有背景話語。Jev 背景談話判斷、既有點餐確認與觸控備援繼續保留。僅Firefox網頁端，不增加Electron或Python服務。

### 最小接線

```text
一般麥克風 → 既有串流入口 ───────────────────┐
                                             ↓
UMA-8 → 8CH/48k擷取 → Worker Spatial Mask → 既有VAD → 既有WAV/HTTP ASR → Jev/Main
                              16k mono PCM ──┘
```

- 沿用現有音訊裝置設定及唯一一份 getUserMedia 串流；陣列分支借用track，不自行停止原始track。
- 沿用Kiosk音訊composable的generation、停止／切換生命週期；每次啟動或更換裝置自動偵測聲道並選路，不讀取舊手動模式。UMA-8且實際八聲道才啟用Mask；一般麥克風走原流程。LCMV只留在獨立驗證頁作比較，不串接在Mask前後，也不先建立通用外掛架構。
- 陣列分支以AudioWorklet擷取、Worker處理。只取參考程式的多聲道、FIR降採樣、相位比較、Mask平滑及合成邏輯，不帶入Uma8MaskClient、demo、STT WebSocket、60秒上限或其獨立收音管理。
- `packages/stage-ui/src/stores/ai/models/vad.ts` 只增加明確的16k PCM輸入模式／入口，保留一般MediaStream入口及目前事件。底層`BaseVAD.processAudio`已存在，不換VAD模型或重寫語句狀態機。
- PCM入口整理成目前使用的512-sample區塊，外層依序await處理；不能把參考程式一次2048樣本直接視為等價VAD呼叫。VAD推論鏈與語句狀態順序都須維持。Mask輸入模式不另開原串流VAD收音圖，避免雙路送入。
- `KioskScene.vue`只切換輸入來源／接線，原`onSpeechStart/onSpeechReady`、語句排序、取消、ASR上傳與點餐流程保持原有責任。
- 不把16k PCM重新升採樣到48k再降回16k；不修改`kiosk-audio.ts`及Server ASR協定，不另開STT WebSocket。

### 自動選路（取代早期手動模式）

- Kiosk建立時便提供`ideal:8`、48kHz及關閉AEC／NS／AGC的擷取偏好，避免getUserMedia先行降混；不以`exact:8`擋住普通麥克風。啟動時再對現有track套用偏好，故已開啟或上次已回退的串流也重新嘗試。
- 沿用原裝置管理的唯一串流與裝置ID；用現有擷取Worklet作無錄音、靜音的實際聲道探測。只看`getSettings()`或支援能力上限不算確認八聲道。探測不啟動Mask Worker、不送VAD／ASR。
- track標籤辨認為UMA-8且實際8CH才套用已知幾何Mask。普通1／2CH，以及其他未知幾何設備，對同一track恢復原先AEC／NS／AGC偏好後走原串流VAD。普通設備不是故障，不顯示方向抑制失敗。
- UMA-8聲道不足、探測或Mask失敗：退回一般處理，原因只放管理員設定的技術診斷，不向顧客跳窗或播報；同一輪不重試Mask。若連原收音設定也無法恢復則明確顯示錯誤，不宣稱回退成功。
- 更換串流、停止／重啟或變更幾何會增加generation並取消舊探測／圖形；track設定操作依序執行，拒絕過期結果／錯誤。停止只釋放本層資源，不停止裝置管理擁有的track。下次開始重新偵測，不讀寫`array-mode`舊值。
- 點餐端只顯示自動結果與聲道數，移除模式選單與LCMV上傳按鈕；幾何欄位保留於進階區，無需額外操作。獨立驗證頁仍可手動比較LCMV／Mask與下載本機音檔。

自動選路本批驗證：26個離線測試與15個瀏覽器測試通過；130秒opt-in案例未重跑。真實Worklet合成測試觀察1／2／8CH並確認不升混；選路／錯誤時序測試只控制硬體與DSP的IO邊界。Kiosk套件型別檢查、修改檔lint與建置通過，未跑全庫typecheck、未呼叫模型、未部署。Linux Firefox157另完成1／2／8CH探測、取消與借用context保留，既有15秒Mask比較也重新通過。合成來源必須先填入AudioBuffer再交給來源節點，早期測試準備順序造成的逾時保留為失敗紀錄；不當作真人音訊／實體麥克風驗收。裝置名稱與聲道、實際Firefox硬體擷取／恢復偏好及真人方向效果仍待實機核對。

### 設備警告：不干擾顧客

回退只更新內部診斷。Kiosk將每輪失敗的stage／channels／generation與standard或unavailable結果，透過既有device cookie通報`POST /api/kiosk/audio/warnings`。Server採嚴格共享schema、從憑證取得device/site並寫入結構化WARN；不要求Session、不建立互動紀錄、不送模型。正常一般麥克風不產生警告；通報失敗僅console診斷，5秒截止、不阻塞收音或無限重試。管理員設定保留技術詳情；無新增顧客提示、Admin警報列表或外部通知服務。

### DSP必需修正，範圍限定在Mask模組

1. 移除hard decision、Gate segment、Gate output及其等待。保留Mask自身所需的頻率平滑／時間平滑；原版Mask需4個未來STFT frame，不能以零前瞻宣稱結果相同。
2. 改用有限STFT歷史與overlap-add緩衝，已輸出部分可回收；保留必要FIR、Mask前瞻及合成狀態。不可只刪60秒限制而保留整段歷史，也不以每句stop/start避免記憶體問題。
3. 收音及Worker批次與演算法數值分開：先測2048/4096等較小輸入批次的分批一致性及目標機器負載，再決定預設值；不沿用16384批次及2048輸出門檻造成的啟動等待。保留原數學核心作離線對照，任何FFT更動需另核對數值，不新增依賴或外部服務。
4. 限制在途批次／累積音訊時間，記錄樣本offset、處理延遲與錯誤。落後超出上限時顯示故障、停止該generation並走明確回退，不可無聲丟段後繼續拼成訂購語句。
5. Worker回傳攜帶generation與樣本位置；裝置切換、停止、重新初始化或過期回傳不得混進新語句。比較錄音正常完成先drain；取消／換設備則清除該輪未完成音訊，維持既有取消語意。
6. 聲道不足、處理器錯誤或積壓異常時可回原收音路徑，並明顯標示「方向抑制已停用」。重新啟動VAD、清理待處理片段、串流權責要一致，不能只catch錯誤後宣稱已回退。陣列幾何設定在收音停止時變更；處理模式由每輪聲道偵測自動決定。
7. 不加新的語音開關、不依方向信心把整段PCM設為零；原VAD仍負責判斷語音與停頓。增益初值0dB，不用放大或音量正規化冒充方向抑制效果。

### 比較紀錄與驗收邊界

- 第一步沿用獨立驗證頁的本機播放器／下載，保留同次raw/reference/mask及演算法參數、取樣率、樣本時間基準；不先為Mask更動資料庫或Admin。
- 現有待部署Admin比較契約固定48kHz、lcmv-v1、1024 delay，不能把16k Mask冒填成該格式。若Mask驗證通過後要納入Admin，再小幅擴充該既有契約；本次不先寫泛用媒體架構。
- 對照套件參考核心：相同RAW、不同分批、長度及尾段一致性，零輸入／NaN、前後邊界；拆除Gate及有界化後重驗，保留誤差容差與原始失敗，不沿用舊4/4作新程式通過證據。
- VAD/STT接線：驗證512樣本輸入、串行處理、完整句子、第一字／尾字、取消、切換、錯誤回退與一般麥克風；輸出仍由原WAV/HTTP協定處理。ASR實測屬獨立資源測試，不以離線測試冒充。
- Firefox＋UMA-8：前方短回答、前方長句、前方停頓但左右繼續說、前側重疊、同方向後方人聲、TTS播放時回音；同一份資料比較原音／Mask／LCMV，分開報告前方漏字與背景誤辨識。
- 穩定度：至少30分鐘無60秒停機、無歷史線性成長、無持續積壓、無缺樣／重樣；量測額外延遲與掉音。先以額外延遲p95不高於250ms作待確認目標，這是驗收目標而非目前實測或保證；若不符先回報，不默默改門檻。
- 整合分支通過上述必要測試後才另行安排正式發布；一般收音可隨時恢復。這不是重跑整個點餐決策模型的理由，除非改動實際跨到該責任邊界。


### 2026-11-04 實作與合成驗證結果

- 已加入有界`SpatialMask`、真正八聲道擷取Worklet、Mask Worker及`spatialInput`接線；只借用原串流／AudioNode，未移植整包Client。Gate判斷、Gate輸出與相關等待皆移除，保留Mask本身4-frame平滑前瞻。一般麥克風沿用原流程；後續自動選路規則如下，LCMV只作獨立比較。
- Kiosk沿用`useArrayMicrophone`生命週期，語音模式暫停即釋放陣列圖形；Mask輸出經`useVAD`的小型PCM入口依序送入。STT的WAV/HTTP、Jev/Main及訂購流程未修改。最後不足512樣本只補模型張量，不把補樣寫成原始語音。
- 獨立頁可選Mask或LCMV；15秒同源比較保存48k八聲道原音、16k參考及Mask，明列時鐘與演算法且不正規化音量；支援已運作後的非零起點裁切。未修改Admin48k/lcmv-only上傳契約或套用migration。
- 參考JS與SHA256永久保留於`audio/fixtures/spatialMask`，只排除該原始oracle的格式化；執行核心正常lint。合成正面／左右／重疊／靜音、不同分批、極短片段與首尾脈衝相對原版Mask最大允許誤差1e-7，樣本長度一致。
- 相關離線25項（含15項Mask／oracle、既有LCMV及ASR WAV）、VAD6項、本機WAV6項、瀏覽器基準10項通過；另補跑非零起點比較通過。外部VAD推論在單元測試以fake替換，未宣稱測過真人語音。
- 1800秒合成音訊加速測試通過，輸出28,800,000個16k樣本，頻譜歷史不超過32frame，合成環形緩衝4096sample；測試約38.61秒，不等於實機連續30分鐘。
- Linux系統Firefox157以真AudioNode/Worklet/Worker跑130.04秒合成音訊通過：輸入6,243,328個48k frame，輸出/消費2,081,110個16k樣本；第一批約120ms、觀察最大積壓128ms、最大批次DSP11ms，收尾積壓0，借用圖形未被關閉。這是本機合成來源的觀察值，不是硬體擷取、真VAD推論或端到端STT延遲承諾。
- 最新相關檔案lint、Kiosk套件型別與Kiosk／獨立頁建置通過；未跑全專案型別。既有fft.js依賴連結損壞已依lockfile SHA512恢復於此工作樹node_modules，未更改依賴版本或其他實驗工作樹。
- 原始觀察／失敗原因、成功logs、Firefox JSON與來源雜湊保存於`~/.local/share/webnavior/acceptance/spatial-mask-20261104/acceptance.json`；永久回歸測試留在程式庫。opt-in Vitest130秒案例已保留，此次以等價Firefox WebDriver案例驗證，不能冒稱該Vitest opt-in已執行。

尚待：實體UMA-8通道/方向確認、真人前方完整性、旁人停頓/重疊造成的STT誤辨識、TTS回音及Firefox長時間實機CPU/記憶體/掉音。沒有先前真人RAW，沒有呼叫ASR/Jev/Main，沒有正式訂單、DB變更、commit或部署。現有公開mic-check仍是前次發布版本；新Mask選項尚未發布。

## 1. 範圍與已確認基準

- 僅 Windows Firefox 網頁端；以 Web Audio／AudioWorklet 執行收音與 LCMV，不需要 Python 後端服務。
- 一般 USB 麥克風沿用既有路徑；UMA-8 另設可選模式，預設不啟用。Jev／Main、點餐決策與 ASR 服務協定不變。
- 使用者已確認 Firefox 獨立測試能取得八聲道，Python 成品能抑制左右聲音；Webnavior 整合後的聲道／效能仍須驗證。
- 以裝置 mic5、mic6 中間為正前方。Python 假設 CH1..7 對應中心 MIC0 加六顆環形 MIC1..6、CH8 不參與計算；這是待核對的映射，不直接當成 Firefox 實測結果。
- Python 基準：48kHz、FFT1024、hop256、sqrt-Hann、半徑44mm、loading0.03；正前方保留、左右±90°抑制。先重現這組設定，安裝姿態與半徑仍需核對。
- 首版為固定幾何、預先計算權重的正則化 LCMV；不宣稱已具備環境自適應、可靠說話者分離或任意場域的前後辨識。設備配置一次確認，非每個場地人工量測聲場。
- 原 Python 留作測試基準，不加入正式執行依賴。後續 GSC 可使用相同輸入與比較紀錄另做實作，不先建立通用演算法外掛系統。

## 2. 接入位置與最少必要修改

```text
一般 USB → 原有 MediaStream ───────────────────→ 原有 VAD → 原有 ASR
UMA-8 → 多聲道擷取 → LCMV AudioWorklet → 單聲道 Stream ─┘
              └──── 同一時鐘的原音／參考單聲道／LCMV 比較錄音
```

| 現有位置 | 可沿用／必要修改 |
| --- | --- |
| `packages/stage-ui/src/stores/settings/audio-device.ts` 及 `composables/audio` | 沿用裝置選擇、權限與單一串流生命週期；先追到擷取 composable，僅為 Kiosk 陣列模式提供擷取條件，普通麥克風與其他應用維持預設。 |
| `apps/stage-kiosk/src/components/KioskScene.vue` | 現在直接把 `stream` 交給 VAD；改由 Kiosk 音訊處理 composable 提供有效輸入，Scene 僅接線。 |
| `packages/stage-ui/src/libs/audio/vad.ts`、`workers/vad/process.worklet.ts` | 沿用16kHz VAD 與分段；現有 Worklet 只讀 `inputs[0][0]`，所以多聲道必須在此之前處理。 |
| `apps/stage-kiosk/src/services/kiosk-audio.ts` | 現有 ASR／保存音訊是 VAD 單聲道 PCM16 WAV；既有編碼與分塊協定不改，不再將此檔誤稱為硬體原始多聲道。 |
| `useKioskMediaCapture.ts`、`kiosk-device.ts` | 沿用 Session 上傳、保存及錯誤處理入口；增加比較錄音的明確識別與有界上傳，不阻塞辨識。 |
| Server `schemas/kiosk.ts`、`services/domain/kiosk-media.ts` 與 Kiosk／Admin 路由 | 沿用私有檔案、雜湊、Session／店別權限與清理；補比較音訊種類及受驗證的錄音資訊。需要小型資料庫 migration。 |
| Admin `kioskVisitorSessionTranscript.vue`、`kioskVisitorSessionMedia.vue` 與 `useKioskManagement.ts` | 沿用登入後讀檔與播放；新增獨立比較區與下載，不能讓既有「第一份語音檔」配對邏輯拿錯版本。 |

### 前端處理契約

- 裝置設定只新增必要的「一般／UMA-8 LCMV」選項及陣列配置。裝置 ID 留在既有本機選擇機制；不根據裝置名稱自動猜演算法。
- 陣列模式請求八聲道、48kHz，關閉瀏覽器 AGC／降噪／回音消除，實際讀取 track settings 與 Worklet 收到的聲道數；普通模式不改這些設定。
- 維持離散聲道，避免預先混成單聲道。用實際取樣率計算權重；首版正式驗收以48kHz為準，不符合支援條件時停用陣列模式並清楚顯示原因，讓操作者切回一般模式。
- 初始化時計算幾何權重；Worklet 僅執行 FFT、加權與 overlap-add。以預配置緩衝承接瀏覽器實際區塊長度，不假設每次正好256樣本，也不在音訊執行緒上做上傳或矩陣求解。
- 處理後單聲道交給既有16kHz VAD；驗證瀏覽器跨串流重採樣後的時間與資料正確性。VAD 設定、ASR分塊、語句順序與取消機制沿用。
- 切換模式／裝置在收音停止時進行；先停止舊 VAD 與錄音、丟棄未完成片段，再釋放節點／串流並重啟。拒絕舊 generation 的回傳，避免雙重收音或把兩種設定拼進同一句。
- Worklet 故障／聲道不足需顯示實際狀態；不偷偷宣稱 LCMV 仍生效。預設音訊不接喇叭，避免迴授。

## 3. Admin 比較錄音

首版採操作者明確啟動的15秒比較錄音，不常駐保存所有原始多聲道。
必須有有效 VisitorSession；沒有時先開始測試接待，不自動建立訂單或付款。
錄音可在沒有辨識文字時保存，不能只由處理後 VAD 觸發，否則被抑制的側邊聲音會消失於證據中。

| 同一組資料 | 保存／使用方式 |
| --- | --- |
| 原始多聲道 | 保存實際八聲道 float32 WAV；可下載，聲道映射與未使用聲道明列，不要求瀏覽器直接播放八聲道。 |
| 參考原音 | 取已確認的實體 mic5，單聲道 PCM16 WAV；可播放、下載，沿用 Python 的比較基準。 |
| LCMV 結果 | 同次擷取的單聲道 PCM16 WAV；可播放、下載。 |

- 同組使用一個 `comparisonId`／Session／測試事件，包含檔案角色、實際取樣率／聲道數／起始樣本／樣本數、演算法版本、幾何與通道映射、增益及延遲對齊資訊。共用契約優先擴充現有 `packages/stage-shared/src/kioskAudio.ts`，不經前端 runtime 匯入 Server 型別。
- 新增明確的比較音訊種類及有界、具欄位驗證的 metadata；不靠檔名、建立時間或列表順序猜配對。既有錄音保持現有用途與顯示。
- 原音與處理音按樣本時間對齊，記錄啟動補零／尾端 flush 與濾波延遲；不各自觸發錄音或自動正規化音量，避免失真的 A/B 比較。
- Admin 同一組顯示兩個單聲道播放版本、各自下載及原始多聲道下載；使用既有登入／店別權限抓取，不產生公開音訊 URL。
- 48kHz、8聲道 float32、15秒約23.04MB，單檔低於現有32MiB上限；限制最長秒數、緩衝與待上傳數量。保存失敗顯示不完整／失敗，不影響 VAD、也不冒充比較成功。
- 沿用 Session 媒體保存／刪除政策。未來 GSC 以另一個版本角色加入同組比較，首版不實作 GSC。

## 4. 實作與驗收順序

1. **收音與演算法**：裝置配置、AudioWorklet、Python 對照 fixtures、模式切換；既有普通麥克風仍可用。
2. **比較保存與 Admin**：比較契約／migration、上傳驗證、同組呈現、播放下載及清理。
3. **整合驗收後才安排部署**：離線與真實 Firefox 硬體結果分開記錄，不以模擬測試宣稱硬體已通過。

| 驗收 | 通過條件 |
| --- | --- |
| 離線數學／音訊 | 與 Python 同輸入的結果在明訂數值容差內；前／左／右合成訊號、零輸入、幅度／NaN、overlap-add及樣本長度測試通過。Python 僅測試時產生 fixtures。 |
| 既有流程 | 一般模式維持原串流；處理後資料正確進入 VAD／ASR；停止、切換、取消不重複辨識、不混入舊片段。 |
| 比較紀錄 | 各版本同時段、角色配對正確；下載保持聲道／取樣率；上傳失敗、跨店／跨Session存取、清理與舊語音顯示測試通過。 |
| Windows Firefox＋UMA-8 | 核對每聲道映射、安裝方向與增益；測正面單人、左右干擾、同時說話、不同距離／反射及Kiosk播放TTS。保留A/B音檔與辨識結果，不把波束成形當成回音消除。 |
| 即時效能 | 目標機器連續至少10分鐘；量測音訊回呼p95/p99、掉音、記憶體及額外延遲。48kHz下128樣本約2.67ms；以實際區塊期限為準，不能只看平均耗時。FFT1024的21.3ms只是視窗長度，不是全流程延遲承諾。 |

正式發布預設仍為一般模式，陣列模式由設備操作者明確啟用；有問題可以切回原流程。
精準抑制量／音質及延遲門檻，待同距離、可重現的Python與Firefox對照量測後定案，不預先保證數字。

## 5. FFT 依賴選擇

已查現有音訊模組，未找到可直接沿用的 FFT 實作或直接宣告的 FFT 依賴。使用者在本方案建議優先使用 fft.js 後同意開始實作；本次採 fft.js 4.0.4，不另寫 FFT。Context7 工具在本次環境未提供，依官方原始碼／型別與專案實際建置核對。

| 候選 | 適合本案的理由／成本 |
| --- | --- |
| [fft.js](https://github.com/indutny/fft.js) | 純 JavaScript，提供 real FFT／inverse，移植現有STFT較直接；需在目標Firefox實測7通道負載。本次已選用；目標Firefox負載仍待實測。 |
| [kissfft-js](https://github.com/j-funk/kissfft-js) | KissFFT 的 Emscripten 移植；需額外核對產物格式、初始化及Worklet載入相容性，不能先假定比純JS更快。 |

參考：[AudioWorklet區塊與生命週期](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process)、[Web Audio Worklet](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet)、[聲道擷取條件](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/channelCount)、[UMA-8 v2官方規格](https://www.minidsp.com/images/documents/Product%20Brief-UMA-8%20v2.pdf)。聲道請求不等於實際取得，仍以Firefox實測為準。

## 6. 本次實作及驗證界線

- `apps/stage-kiosk/src/audio`：固定 LCMV 權重與串流 STFT、AudioWorklet，以及原 Python 產生的 fixtures／來源雜湊。`useArrayMicrophone` 負責本機模式、圖形生命週期與最多一組15秒錄音。普通模式直接沿用原串流，陣列失效會停用而不混成假八聲道。
- Kiosk 操作員裝置設定中可選模式、映射與半徑；先停收音再改設定。映射欄位採零起算：預設 `0,1,2,3,4,5,6` 表示 CH1..7→MIC0..6。mic5參考音使用映射第六項。硬體映射未驗證前，不宣稱畫面MIC標籤已與實體一致。
- 手動錄音不依賴VAD：以延遲環形緩衝把原八聲道、mic5參考與LCMV輸出按1024樣本補償對齊；同組起始位置／樣本數／幾何／映射寫入 metadata。頁面不播回即時麥克風音訊。
- Server 使用現有Session授權、私有保存及清理；新增 `audio_comparison` 與 `audio_details`，需要部署前執行 migration `0047_kiosk_audio_comparison.sql`。現有ASR錄音／訓練匯出不改用比較錄音。Admin在訪客紀錄媒體區顯示三角色，缺檔或設定不一致會標示不完整；多聲道只提供下載。
- 已完成 Python 全權重／音訊容差、非固定區塊、零輸入／NaN／映射拒絕、1500Hz前／側方向測試；瀏覽器實際Worklet完成15秒合成八聲道錄音，變動波形核對1024樣本對齊。一般模式切換與聲道不足、Admin元件的讀檔／播放／下載／不完整呈現、隔離PGlite媒體保存／格式拒絕／清理均有保留測試。瀏覽器自動測試使用Chrome，不能替代Firefox硬體結果。
- Kiosk／Admin建置及Kiosk、Admin、Server套件型別檢查通過。未執行全專案型別檢查，未呼叫Jev/Main或ASR服務，未操作正式Session、資料庫、POS或付款。
- 待實機：Windows Firefox映射與方向、側音同時說話、TTS迴音、不同距離／場域，並連續至少10分鐘量測回呼p95/p99、掉音、記憶體與延遲。固定幾何LCMV仍不是環境自適應或回音消除；未完成這些測試前不標示正式硬體驗收通過。

範圍驗證共131個測試通過：DSP3、共享WAV契約5、媒體保存與Admin路由10、VAD設定2、Kiosk路由／接待權限100、既有ASR音訊7、實際瀏覽器Worklet／切換／Admin元件4。Kiosk及Admin建置通過，Kiosk／Admin／Server套件型別與本次TS／Vue檔案lint通過。瀏覽器命令為 `VITEST_BROWSER_CHANNEL=chrome pnpm -F @proj-airi/stage-kiosk exec vitest run --config vitest.browser.config.ts src/audio/<name>.browser.test.ts`；離線測試使用各套件Vitest入口。未以這些合成結果取代實機驗收。

### 本機已安裝 Firefox 補驗（2026-11-02）

已透過現有 geckodriver0.37.1，以獨立暫存設定檔啟動系統 Snap Firefox157.0（Linux、headless），未使用使用者平常的瀏覽器設定檔。隔離本機頁載入同一份正式LCMV／Worklet／模式composable／Admin元件；不連接正式Session、模型或付款。

- 真實AudioWorklet完成15秒合成八聲道、720000個輸出樣本，與原始捕獲重建的核心結果最大誤差0；核對mic5參考與1024樣本對齊。
- 一般串流保留、單聲道拒絕陣列模式、切換及清理通過。
- Admin載入真實編碼PCM16 WAV，Firefox解碼、靜音播放及raw下載控制通過。HTTP檔案來源與下載副作用在測試頁隔離；未聲稱實際向正式Admin下載了顧客檔案。永久Admin元件測試亦補上有效WAV與解碼驗證，Chrome兩案通過。
- 目前這台Linux的USB／ALSA與Firefox都沒有辨識到UMA-8；Firefox只列出兩個系統聲音monitor來源，預設為兩聲道。使用者表示已插入麥克風，仍需確認是否接在另一台Windows。此結果不能當成UMA-8硬體或Windows驗收。

本機證據：`/tmp/firefox-native-audio-result.json`、`/tmp/firefox-audio-hardware.json`、`/tmp/firefox-native-check.log`；隔離驗證頁與執行器為`/tmp/firefoxAudioCheck.html`、`/tmp/firefoxAudioCheck.ts`、`/tmp/runFirefoxAudioCheck.py`。首次開發依賴預處理重新載入頁面的一次未完成嘗試未計入通過；依賴就緒後完整重跑通過。無正式程式／部署變更。

### UMA-8 Linux 實機收音補驗（2026-11-03）

使用者確認裝置接在同一台Linux。最初USB／ALSA／PipeWire都無裝置；使用者重新插拔後，USB辨識到`2752:001d miniDSP micArray RAW SPK`，ALSA card2、PipeWire八聲道7.1輸入出現。未改動系統音訊設定。

系統Firefox157.0獨立設定檔，依裝置標籤選取實際UMA-8，使用正式`useArrayMicrophone`、LCMV核心與AudioWorklet執行：

- Firefox實際`channelCount=8`，AGC／回音消除／降噪均false。Firefox未回報track sampleRate；同時讀取ALSA開啟參數為8ch、S32_LE、48000Hz，處理AudioContext為48000Hz，不能把缺少的track值寫成已回報48000。
- 一組15秒實際音訊：raw8ch float32 WAV23040044bytes，reference及processed各為monoPCM16 WAV1440044bytes，均720000樣本。同時鐘metadata與1024樣本補償；從raw重建核心輸出，PCM16量化後最大差異0。
- 七個通道有底噪，第八通道為0，符合八通道中一通道未使用的觀察；這不能獨立證明實體MIC0..6映射。參考原音仍依目前配置第六項取樣，不宣稱已實體核對mic5。Linux7.1通道標籤有可能重排，需後續實際方位／逐麥確認。
- 另外以既有`createVADStates`及原本VAD Worklet接收真實LCMV stream：16kHz入口收到97個512樣本片段，共49664樣本、有限且非零；清理保留借用的原始麥克風track。此測試替換模型推論邊界，只驗音訊入口，未執行VAD語音判斷、ASR、Jev/Main或POS。
- 比較上傳僅在隔離頁攔截本機FormData，不送到正式Server或Session。保存於`/tmp/webnavior-uma8-firefox-20261103/{raw,reference,processed}.wav`，`result.json`保留metadata及各檔SHA256。實機腳本`/tmp/firefoxHardwareCheck.ts`／`/tmp/runFirefoxHardwareCheck.py`，VAD入口腳本`/tmp/firefoxHardwareProbe.ts`／`/tmp/runFirefoxHardwareProbe.py`；結果另存`/tmp/firefox-uma8-hardware-result.json`及`/tmp/firefox-uma8-vad-ingress-result.json`。

使用者目前不方便說話，因此不繼續錄音。這批為環境底噪，不能計為正前／左／右語音的抑制、品質或實體映射驗收。10分鐘p95/p99／掉音、TTS迴音、Windows及不同場域仍未驗收。本次只測試與更新記錄，沒有新增正式程式修改、commit、部署或正式資料庫migration。

### 獨立跨電腦驗證頁（2026-11-03）

使用者同意可帶UMA-8到其他電腦，用Firefox開獨立網頁錄音。新增`apps/stage-kiosk/src/audioCheck`：頁面負責選裝置與位置，`useRecorder`負責此頁自有麥克風／圖形生命週期及最多一組本機音檔，`recordingResult`提供兩個單聲道播放器、三WAV及metadata JSON下載。共用既有LCMV核心、AudioWorklet與WAV契約，不依賴Kiosk的Session／媒體上傳composable。Worklet跨執行緒訊息型別集中到`audio/capture.ts`；演算法與Worklet執行行為未改。

- 獨立建置命令`pnpm -F @proj-airi/stage-kiosk build:audio-check`，輸出`apps/stage-kiosk/dist-audio-check`，四個靜態檔案／相對資源路徑，不含正式Kiosk路由、模型或API。普通收音與Server未部署變更，無需migration0047。
- 網址：<https://webnavior.aikcitri.qzz.io/ui/mic-check/>；僅新增`/var/www/airi/web/ui/mic-check`。既有Admin service worker已排除`/ui/`導覽，因此不需修改快取規則或Nginx。
- 明確點擊才要求麥克風權限／開啟收音／錄音。15秒、同時鐘三份WAV；不播回即時麥克風。取消、停止、裝置中斷、離開頁面皆釋放本頁自有資源。離開／重整清除瀏覽器記憶體檔案；每次錄音前先下載上一組。
- CSP `connect-src 'none'`；沒有上傳、Jev/Main、ASR、Session、POS或付款。metadata只下載到操作電腦，記錄位置、幾何、映射與音訊時間，實體映射預設標示未核對。
- 永久瀏覽器回歸在`src/audioCheck/recorder.browser.test.ts`：權限拒絕、無效／空白映射與非八聲道拒絕、取消、真正AudioWorklet合成8ch錄音、WAV格式／時長、JSON及停止清理。系統Firefox另對建置後CSP頁及公開HTTPS做15秒合成音訊、解碼／實際四檔下載與窄螢幕版面驗收，沒有再開啟實體麥克風。發布雜湊與瀏覽器證據見`/tmp/webnavior-mic-check-publication.json`、`/tmp/audio-check-firefox-static-acceptance.json`及`/tmp/audio-check-firefox-public-acceptance.json`。

仍待使用者在方便說話的場地做正前／左右語音、實體映射及長時間穩定度驗收；提供網頁不表示這些已通過。這次只發布獨立驗證頁；正式點餐與API仍為ordering-copy版本，整合修改仍未commit／部署。
