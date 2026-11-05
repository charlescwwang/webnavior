# Kiosk System One：以非思考 SLM 替代 Jev 的規劃評估

日期：2026-10-28（Asia/Taipei），更新2026-10-29。狀態：使用者已同意先改善候選結構，再將 SLM 加為 Fast Path 選項。分層路由、正式 SLM adapter 及 admin 已實作，完整實測已完成；仍有語意不符，維持實測選項。已依使用者要求部署到場域實測網址，沒有切換現場引擎。原先 1,380 次完整來源研究仍保留，不能當成新架構的驗收結果。

## 評估結論

### 本次實作：共用分層與可選 SLM（2026-10-29）

程式驗證：119 項 Menu 問題／設定／釐清／意圖測試、31 項路由／checkpoint、
72 項 Kiosk 服務測試及 3 項 Chrome 測試通過；profile／SLM 協定／admin
測試亦已通過。Server、Stage Web、Kiosk、Menu 的 scoped typecheck、修改檔案
ESLint 與 diff check 通過，未跑 root 全專案 typecheck。真實語意測試因不符原 gold
而刻意保留非零退出狀態，並未偽稱全綠。

已完成的程式檢查與真實模型結果分開看。**SLM 已加入後台可選、標示實測；
這不代表已通過替代驗收。** 2026-10-29 已依使用者要求更新場域網址，API 於
17:57:33（台北）重新啟動，管理後台／Kiosk／Menu 已發布，75 個公開 HTML 與
關聯資源雜湊一致，後台可讀取本機 DMR 模型清單。現場仍啟用 RTXPROjev；
原自訂提示詞保留，需還原並儲存預設才會採用精簡提示詞。沒有變更資料庫結構
或自動啟用 SLM。後續依使用者要求分批提交程式、歷史測試及文件；提交檢查
修正一個瀏覽器測試型別與文件格式，全專案型別檢查、修改檔案 ESLint、正常
commit hooks 通過。全專案 lint 尚有先前已記錄的 2,370 個錯誤，本次不擴大修正。
提交前回歸測試：Server 213、Kiosk 123、Menu 26、Chrome 3，另有 7 項 Python
來源／連續性檢查；沒有重跑模型推論。備份與部署證據位於
`/tmp/webnavior-slm-field-release-20261029-05dh4hst`。此為可用性驗證，並非新增語意驗收。

| 實測 | 完整數量與觀察 | 限制 |
| --- | --- | --- |
| 正式 SLM adapter 首層 | 1,114 筆全部取得合法選項，1,115 次 HTTP 含 readiness，29.0 分鐘，0 連線／格式錯誤 | 原異質 gold 無法直接當四類 gold，semanticAccuracy=null；不是 1,114 題語意全對 |
| 初版分層完整 route | 44 筆，24/43 標籤符合、1 候選缺口 | 發現 p32 多餐點、p35 資訊詢問被選為新增；保留初版結果 |
| 加上共用寫入檢查後 SLM | 44 筆，22/43 標籤符合、1 缺口，129 次 HTTP | p32／p35 改交 Main；更多保守交接不算完成，首層忽略／未說完誤判仍存在 |
| 同版 SLM resolver | 40 筆，12/39 符合、1 缺口 | 未執行 Main，不把交接當完成 |
| 同版既有設定 Jev | 44 筆，18/43 符合、1 缺口，104 次 HTTP；正常收齊 | Jev 有真實信心門檻，弱判斷可能再走 Main recovery；本測試不執行該流程，不能用此表排名引擎 |
| 初版真實 SLM＋隔離 Menu | 26 筆，7/26 原路由標籤符合 | query-portion 從購物車 2 份誤變 3 份；是需要補強的實際誤加，不掩蓋 |
| 寫入檢查後 Menu | 26 筆，6/26 標籤符合；原資訊誤加已擋住 | 2 筆正確新增因 16 秒超過舊 15 秒候選期限被拒絕；保留失敗 |
| 對齊決策期限後 Menu | 26 筆全部重播，6/26 標籤符合；0 執行例外，查詢／背景預期案例未觀察到購物車誤增 | 2 筆較慢新增實際 15.9／16.0 秒，購物車均由 2 份成 3 份；仍有 20 筆路由不符，含交接 Main、IGNORE、INCOMPLETE 等 |

全部案例均保留原 gold，沒有只重跑錯題。初版、寫入檢查版及期限修正版的結果分檔，
不能合併取最好答案。首層提示在寫入檢查修正前後未變，所以 1,114 筆首層證據仍
只適用該固定首層；不延伸成全流程準確率。26 筆包含真實 Menu 工具／購物車，
但沒有真實 Main、ASR、實體多機或 POS 驗收。這次沒有再次調整模型、gold 或逐句
例外來追求全綠；下一階段需處理服務入場／省略回答等語意契約，不能把已連上當成已替代。

安全結果集中在 `test_prompt/turnClassifierPoc/results/` 的
`slm-staged-first-gate-20261029-summary.json`、`slm-staged-routes-initial-20261029-summary.json`、
`slm-staged-routes-guarded-20261029-summary.json`、`slm-staged-resolver-guarded-20261029-summary.json`、
`jev-staged-routes-guarded-20261029-summary.json`、`slm-staged-menu-initial-20261029-summary.json`、
`slm-staged-menu-guarded-20261029-summary.json`、`slm-staged-menu-budget-20261029-summary.json`。
原始逐題 request／response 在 `/tmp/webnavior-staged-*-private.log`，沒有放入 repository。


正式 HTTP 路徑明確使用 `routing:staged`，Jev／SLM 共用相同語意樹；原 flat
介面保留供既有凍結研究重播，不能把 flat 單元案例通過數當成新樹準確率。

- 第一題固定 SERVICE／GREET／BACKGROUND／UNCERTAIN，先判斷服務對象與範圍。
- 服務需求再判斷單一效果、有效問題回答、複雜查詢、整句交接、未說完或不確定；
  多品項、換餐及多個效果先交 Main，不選單一步驟。
- 單一效果才選合法操作小組與葉節點，每題最多 6 選項；沒有或過多選項時整句交接，
  不截掉候選。菜單過大組再分查詢／推薦／導航。
- 有效問題只接受當前票據的合法答案。電話入口保留小型 phase 專用選擇；未通過
  服務入場不能先跑電話略過裁決。進行中需求、未完成語音有獨立關係判斷。
- 複雜飲食／價格條件先走既有 Main 唯讀查詢與價格裁決；這是刻意將自由語意交接，
  不再讓小模型同時比較操作、飲食、金額與授權。
- 獨立訂單寫入需再分別核對「這是操作要求」與「候選完整涵蓋整句」，不能只靠
  類別／葉節點選擇。此為共用政策，未新增個別語句判斷。有效問題答案維持自己的票據。
- 一般候選有效期對齊 60 秒決策上限；仍檢查 phase／revision。只有依賴舊問題的
  效果承接該問題期限；獨立新需求不受無關舊問題期限影響。金融／清空等確認仍為原本
  15 秒一次性授權，並未延長。新增測試先重現 20 秒過期及無關問題錯誤縮限，再驗證修正。
- SLM profile 使用 `slm`、OpenAI 相容 API root、modelId、加密 key、timeout。
  本機 DMR 範例為 `http://127.0.0.1:12434/engines/v1`；實際以 Server 可達位址為準。
  `/models` 是可用清單，不代表載入；readiness 必須對所選模型真的取得合法 READY。
- SLM 僅一個 token、關閉 thinking、禁止工具與推論文字；回覆須恰好一個合法字母。
  僅 adapter 轉換成候選 ID 並標示 `selectionMode:unscored`，不填信心值。
  Jev 真實信心仍照原 0.6 門檻驗證，不能由上游 Jev 偽稱自己是 unscored。
- 分段 checkpoint 保留來源識別；前端進度可顯示服務處理中，但不因此執行。
  Menu 仍驗證 target、phase、revision、必要參數與一次性確認。
- admin 可以新增、選模、驗證、啟用／停用／切回 Jev；改連線設定會撤銷 readiness。
  新增 SLM 不自動啟用，也不改 Main 模型。資料欄位原本為 text，無新 DDL migration。
  舊自訂提示保留；還原預設可使用精簡版本，自訂只影響服務入場後的需求判斷。

驗證分層記錄：完整 1,114 筆來源只重播新第一層的正式 adapter／協定，原任務 gold
不能硬轉四類準確率；全部 44 個封存 route 情境另外走整棵樹；26 個 synthetic Menu
情境另測真實工具執行與購物車。三組不混算總正確率，也不能宣稱包含真實 Main／ASR／
現場驗收。實際結果完成後記錄於本節及安全摘要，錯題保留原 gold。


### 最新補強：完整來源驗測（2026-10-29，已完成）

**本輪結論：維持現場Jev，不把目前SLM單選接法直接替換啟用。** 完整44題在原state-first位置仍只有30/43匹配（1題候選缺口），包含內用、查詢、漏單及多品項未通過。不能再用先前9/10支持整體替換取捨。這不是SLM與Jev的整體模型排名；本輪未重跑外部Jev，也沒有證明所有SLM架構不可行。四類首層先前10/10仍只是小型診斷，未達完整場域驗收。

安全結果檔：`test_prompt/turnClassifierPoc/results/slm-full-20261029-summary.json`。完整來源1,114筆記錄／986種不同文字，主批1,338項加完整route位置控制44項＝1,382項判斷；可評分來源案例771個、判斷1,038項。338筆未標註保留輸出，3筆沒有原始模型輸入，另2個來源案例缺預期候選（p24在兩個位置各列一次缺口）。這些都沒有被算作答對，也沒有從來源母體刪除。不同任務不混算總準確率。

| 組別 | 匹配／可評判斷 | 來源與限制 |
| --- | ---: | --- |
| 原八類語句形態 | 294/400 | 全部train／validation／test；不是新未見驗收 |
| 完整封存route，問題前置 | 26/43 | 44個原情境，p24候選缺口 |
| 同44題，原state-first位置 | 30/43 | 相同state／候選／gold，獨立版本，不挑更高者當驗收 |
| 上下文resolver route | 21/39 | 40例，r26候選缺口；不是執行成功率 |
| semantic setup需求選擇 | 18/26 | 全部26個重建情境，未執行Main或工具 |
| 20條對話鏈的逐步需求選擇 | 50/64 | 全部64步；未重播真實Main／queue／UI，idle投影非必然唯一 |
| 26例需求拆解五欄 | 84/130 | 僅1/26例五欄全符合；舊PoC能力探測，非採用的生產流程 |
| 40例依序效果／數量投影 | 62/160 | 僅1/40例全部符合；不含target／數量／條件解析 |
| 效果核對 | 16/29 | 32例中3例原domain先拒絕，沒有模型輸入；不能作唯一寫入授權 |
| 近期實際文字形態 | 40/104 | 126筆輸入中22筆無可靠標註；標註不證明原音或對象意圖 |
| 較早實際輸入 | 不計準確率 | 316筆全部取得輸出，缺獨立可靠標註 |

實際1,380次HTTP，模型批次合計65.1分鐘；包含1筆測試批次期限中斷後的明列補測，原始失敗保留在interruptedAttempts，未重跑語意答錯題。除該筆harness期限中斷外，各批沒有provider／格式錯誤，最終沒有NOT_RUN。52項離線檢查通過（19項transport、26項semantic fixture、7項報告來源／隱私／接續）；修改TS的ESLint、diff check通過，未跑全專案typecheck。真實模型測試保留語意失敗，不以成功收集全部結果冒充品質通過。

唯讀Docker inspect再次確認模型digest仍為`sha256:d5b4946297207000d0260314fd33c2ec32b7595a4a82a9eba173960a8fcf0078`，GGUF／4.21B／qwen35。沒有下載、換模、改Main thinking、profile、admin、訂單或部署。完整來源清單與執行方式見`test_prompt/slmDecisionInspection/README.md`；下文保留凍結與接續證據。後續模型／分流變動應使用這份完整來源基線，10題只作控制診斷，不能替代回歸驗收。

使用者指出題數縮減不可作為替換決策依據。本輪撤回以10題控制實驗支持整體替換取捨的充分性；它只隔離提示契約影響。新增完整來源盤點與本機SLM全量runner，採用既有資料全部相容記錄，不挑之前通過的題、不只重跑失敗題，也不把欄位或多次forward當獨立例句。

已凍結1,114個來源案例記錄、986種不同文字、1,338個判斷項目，兩個manifest包含所有資料：400句八類語料、44個partition、40個resolver、32個效果核對、26例五欄需求拆解、40例依序效果／數量投影、26個semantic setup、20條鏈的64步，以及126個10/28–29輸入與316個較早本機保存輸入。最近DB擷取沒有LIMIT：4台機器／21 session／2,613 entries；ASR與user_text同句只在同session去除重複記錄，保留不同狀態／來源的案例。另查10/21起的舊capture；缺session者保留來源並明列無法確定跨capture去重。

初始manifest `/tmp/webnavior-full-coverage-manifest.json` hash `5593460697f53ae36e0ff377ce386d4b332691ce4fa5003bcc3ed81ede761faa`；追加較早來源manifest `/tmp/webnavior-full-coverage-older-manifest.json` hash `bdb1671aa52a89a590a107fe84b87d239fff701534ad1cd812d8463a5caabd11`。追加只跑新發現的較早資料，不重跑已執行答案。每批35分鐘／單次35秒／連續三錯停止；時間到的NOT_RUN保留並可自動只接續未執行項，不以時間預算把母體縮小。模型／格式錯誤不偷偷重試。

SLM使用既有DMR與4B、非思考單標籤；為允許共同前綴重用，這個版本將固定問題放在最新state之前並送cache_prompt=true。每次仍帶完整最新state，不拿KV cache當業務記憶。此版本與前輪state-first輸入不同，分開報告，不能混算改善。只呼叫本機端點，私人原句不送外部Jev／Main；沒有改provider設定、寫入訂單或部署。

分組維持不同契約，沒有「全題總準確率」。3例效果核對原本在domain階段就被拒，沒有模型輸入，保留EVIDENCE_GAP；partition p24／resolver r26預期效果未在原候選中，保留APPLICATION_GAP。22個近期不明原句與316個較早輸入缺獨立可靠標註，保留模型結果但不計答對率。近期104句是推論前依原始文字做的八類形態標註，不等於核實原音／對象意圖。舊train／validation／test資料不能宣稱新未見驗收。

40個generative案例保留所有三個依序效果欄與需求數，但不驗target／數量／條件；26個semantic與64步chain是重建情境的需求選擇，沒有呼叫真實Main／執行工具／重播ASR或畫面。尤其chain的idle／acknowledge是操作層結果，投影到有限類別可能非唯一；嚴格label不符必須保留，不能直接宣稱為同數量的實際誤操作。例D08.2原outcome=idle，預先投影IGNORE而模型選WAIT，屬需審核的投影界線，不能看答案後改gold重跑。R01–R06缺少的原始決策／DOM證據仍是缺口，不以新增形態測試假裝補齊。

程式與重跑說明集中在`test_prompt/slmDecisionInspection/README.md`。私有log依序為`/tmp/webnavior-full-coverage-20261029-031307.log`、`/tmp/webnavior-full-coverage-pending-20261029-034833.log`、`/tmp/webnavior-full-coverage-older-20261029-040325.log`及`/tmp/webnavior-full-coverage-state-first-20261029-041551.log`；各批保留獨立manifest與完整request／response。安全摘要已生成，原文或憑證不進repository。

第一批35分鐘實際681次HTTP；最後p40因測試程式把剩餘批次時間當單題timeout，實際只等約3.2秒（3,224ms）便中斷，沒有取得答案。這是harness期限配置問題，不能直接歸因模型故障，也不能刪除紀錄。已修正後續排程為預留完整35秒才開始呼叫；原始逾時留在摘要interruptedAttempts，child manifest明列該筆與338個NOT_RUN共339項接續，提示／state／gold不變、不重跑語意答錯題。接續log `/tmp/webnavior-full-coverage-pending-20261029-034833.log`；其後自動完成316筆較早資料。報告程式驗證parent hash、相同case與期限證據，只有這種無答案的批次中斷可補完，普通provider失敗或已回答項不可覆蓋。7項provenance／隱私／接續測試通過。

完整44個partition情境在question-first版取得26/43匹配（p24候選缺口），400句形態分類294/400。此時不能拿26/43直接與前輪state-first9/10比較而宣稱全是樣本量效應；輸入位置也是變數。因此另凍結完整44題原位置控制，state／候選／預期相同，只設promptLayout=state-first，所有題都跑、兩版本都保留，不能挑更高者當未見驗收。控制manifest `/tmp/webnavior-full-coverage-state-first-manifest.json` hash `b3911339477ba4126b2968fcbc6146ccbd07ac99c2ec790fbd8af18c1deb5734`；已在其他批次完成後執行，結果為30/43匹配，避免推論競爭。額外44個判斷不增加來源案例或不同文字數。

### 先前：相同歷史情境的描述與分流控制實驗

依使用者最新四項目標，將模型替換、候選負擔與安全對話一併檢查。`slmRoutingExperiment.test.ts`一次完成60次真實HTTP，耗時202.8秒，無HTTP／格式錯誤，沒有看答案調提示再跑。題目是既有人工歷史情境p07、p13、p18、p29、p31、p37、p40、p43、p09，加上同空狀態的招呼控制，共10例，**不是新增10筆原始顧客對話，也不是未見驗收集**。預期在推論前凍結，不以目前Jev答案當gold。

| 實驗條件 | Jev符合預期 | 本機SLM符合預期 | 可回答的問題 |
| --- | ---: | ---: | --- |
| 原封存route問題與描述 | 3/10 | 4/10 | 原契約在這批情境的選擇結果 |
| 相同state、候選ID／數量／順序，精簡instruction與description | 9/10 | 9/10 | 固定候選數後，提示契約仍明顯影響結果 |
| 只判SERVICE／GREET／BACKGROUND／UNCERTAIN | 10/10 | 10/10 | 粗粒度服務分流的可行性；不是完成點餐 |

**本輪決策：SLM值得用於精簡首層的替代方案；不把SLM原樣接入現有複雜route後就全面取代Jev。** 固定候選數的兩組已顯示，問題不只是「選項太多」，指令、描述與任務邊界也需一起整理。instruction與description同時改變，因此不能再區分是哪一者單獨造成改善；四類組同時改了任務粒度，不能把10/10解讀為只減少候選就提高準確率，亦不能與9/10合併計分。兩邊精簡組均在p29「牛肉麵兩碗，水餃再一份」只選ADD_ITEM，未保留完整多需求，這是仍未通過的契約，不予抹去。

本機SLM HTTP中位時間原題12.702秒、精簡3.962秒、服務分流2.210秒；Jev分別420、278、197毫秒。兩邊硬體／runtime不同，不能作模型速度排名；組別按固定順序執行且未隔離cache，不能把延遲下降全歸因於精簡。品質結果是小樣本診斷，尚未驗收完整對話、工具執行、畫面同步、接受／棄權政策或實體收音。Main thinking、正式profile與場域程式維持原設定。

可提交摘要：`test_prompt/turnClassifierPoc/results/slm-routing-20261029-summary.json`，含題目ID、預期集合、各次選擇與時間；凍結hash `0592f2ef0ec7e755c085c594bb8b655a420d32a5b33fb09ea3e4f6a8545b0b00`。完整私有log／source manifest：`/tmp/webnavior-routing-experiment-20261029-024744.log*`。上限60次／8分鐘、單次35秒、連續三次失敗即停止；最初缺一個預先描述的啟動失敗發生在任何推論之前，補完整描述表後才執行這唯一一輪。只讀正式Jev profile並複製到scratch DB，未改正式資料、呼叫Main或操作訂單。測試通過只表示收齊合法結果，不把語意錯誤當整體驗收通過。

以下歷史SLM-only26例與快速對照保留原結果；較早「現行」結論以本節最新控制實驗的範圍為準，不混算成模型勝負。

### 先前結果：SLM歷史失敗案例驗測

`slmHistoricalFailures.test.ts`讀取既有`partition-frozen44.jsonl`的baseline紀錄，以原assessment.contractMatch=false挑出27例；不重跑Jev、不將舊Jev答案當gold。其中p24的預期人數操作不在當時候選中，列為Application缺口而不算SLM錯誤。其餘26例一次完成26個本機SLM請求，耗時188.6秒，**5例符合原預期效果、21例不符合，HTTP／格式錯誤0次**。進度更新先前誤說28／27例，最終以此27／26計數為準，沒有刪題換取成績。

| 歷史失敗家族 | 此次SLM選對／可測 |
| --- | ---: |
| 分類瀏覽 | 0/2 |
| 有沒有／查看餐點 | 0/4 |
| 明確新增訂購 | 0/2 |
| 漏單／畫面數量核對 | 0/4 |
| 內外帶切換 | 0/2 |
| 暫緩結帳 | 2/2 |
| 多品項／替換 | 1/4 |
| 未提供的餐點資訊 | 0/3 |
| 背景／資訊附和 | 1/2 |
| 未說完語句 | 1/1 |

例：p07「能不能看看紅茶」選ADD_ITEM而非SEARCH_MENU；p18／p19內外帶選defer-question；p31「排骨便當撤掉，換牛肉麵一碗」只選REMOVE_ITEM；p29／p32多品項只選ADD_ITEM。這些與歷史問題家族直接相關，不能用一般分類16例接近來掩蓋。

輸入保留該次人工重建情境的state、角色前文、references與候選描述；將Jev長instruction換為凍結的SLM精簡語意policy，非思考、單token標籤，沒有看結果後調提示重跑。gold原樣保留，只有原本needsAll多需求在route層允許NEEDS_ASSISTANT或MULTI_ACTION兩種明確交接，規則於推論前寫入manifest；不代表交接後完整需求完成。原44例是歷史問題家族的人工情境，不是原始顧客錄音逐字重播。這只測route；原baseline最終失敗可能在信心／後續解析／執行層，不能聲稱選對5例就修好5個歷史問題，也不能把21個route錯誤當成實際已發生21次誤操作。

**緊急決策：目前這個SLM有限選擇接法不直接替換Jev。** 依據是本次仍重現多項歷史語意缺口，不是硬體速度或Jev現在的成績；也不是SLM模型能力上限／所有SLM架構的結論。沒有證據可宣稱單純換provider能改善上述缺口。本輪停止，不擴成數小時研究、不啟用新模型或等待使用者逐階段指示。

私有證據：`/tmp/webnavior-slm-history-20261029-014652.log`及`.manifest.json`、`.summary.json`，保存凍結選樣、來源／實作hash、完整模型請求／回覆及失敗。預先上限7分鐘、每題30秒、最多27次、連續三次transport失敗停止；實際26次沒有重試。live測試因21個語意不符合而保持失敗；18項transport離線測試通過，history預設env guard略過，修改檔ESLint及diff check通過，未跑root typecheck。未連DB、呼叫Jev／Main、操作訂單、改設定、commit或部署。完整菜單實際畫面更新、retry queue與近期20條對話鏈尚不在這批route驗測範圍，不能宣稱一併驗收。

使用者提出候選過多的假設並要求curl：`test_prompt/slmDecisionInspection/README.md`及相鄰JSON已匯出p07／p18／p31精確request、候選字母映射、原始SLM答案與來源hash。另附未執行的p07四候選人工縮選控制，不以它宣稱正式縮選策略有效。舊失敗集route候選7–17個，近期影子root為11–20個；p07八候選也出錯，不能只由數量推定原因。不同抽象層級混合、候選重疊、prompt長度與位置效應尚未隔離。此次僅匯出／離線核對JSON及答案映射，未追加推論或修改runtime。

### 先前快速對照（旁證，非本輪決策依據）

2026-10-29先前緊急決策：**此次不以全面換用SLM作為現場問題的緊急修復，先保留Jev；SLM具備替代候選的可行性，不能判定比Jev差。** 決策依據是尚未觀測到換用可改善現場需求的證據，以及有限選擇仍有穩定性缺口。先前將本機長首題20秒作為主要否決理由的權重撤回；效能受硬體及輸入配置影響，另列部署條件。

使用者要求短時間決策、不需反覆回來下指令。本輪新增一次有上限的實際成對對照，已完成，沒有逐步等待使用者確認、追加調提示或重跑挑最佳：

| 項目 | Jev | 本機SLM |
| --- | ---: | ---: |
| 16個案例×正常／反向候選順序，符合預期 | 31/32 | 30/32 |
| HTTP／格式錯誤 | 0 | 0 |
| 將資訊／澄清／等待／背景誤判成訂購／更正／內外帶 | 0 | 0 |
| 候選順序改變時答案不一致的案例 | 1 | 2 |
| 此短提示配置HTTP中位時間 | 218ms | 1615ms |

模型對照64次HTTP共63.6秒；每次30秒上限、整輪7分鐘／66次上限。不是32個獨立情境，而是16個情境各兩個順序。題目先按需求固定預期、凍結hash，再執行兩個provider；不帶預期進prompt、不用Jev答案當gold。雙方同一state、問題與候選，SLM使用適合有限選擇的短提示及非思考單token輸出，不強制搬入Jev長業務提示；沒有調參預算差異。16例含既有已知問題與新組合，屬於公開開發診斷，不能稱未見驗收或完整公平性證明。

兩邊第一順序都把無前文的「對」選成INFO，反向候選後改成CLARIFY。SLM另將「你聽得到我嗎？」在反向候選時由INFO改成CLARIFY，這是澄清／資訊分界差異，沒有觀測到操作副作用；不能把一題差距說成模型顯著較差。事前篩選規則要求SLM至少不低於Jev、至少29/32、上述誤操作類型零次及零順序不穩定；此次未全滿足，不能事後放寬規則宣布通過。原Jev也有順序不穩定，不因此宣稱既有流程完整可靠。

這輪證明SLM能在短提示下做相近的直接需求分類，速度也不是所有題目都要20秒；尚未驗證完整下單／UI、原生候選logits對齊、接受政策或一般場域準確率。延遲硬體未對齊，不作模型速度排名。不能由分類接近推論能解決畫面不同步、假加入購物車或恢復流程問題。

程式：`apps/server/tests/experiments/slmQuickComparison.test.ts`；原始私有log及source manifest：`/tmp/webnavior-slm-quick-20261029-013907.log*`。最初sandbox阻擋本機DB連線的啟動失敗沒有進入推論；獲准網路執行後一次完成64次，沒有挑成績重跑。18項transport離線測試通過，quick測試預設略過；實際quick runner通過代表完整收齊有效回覆，不代表模型品質通過事前篩選。新檔ESLint及diff check通過；未跑root typecheck。

本次決策交付到此結束，不繼續擴大benchmark或等待數小時驗收。SLM後續如實作，應保留provider可切換並完成真實執行契約，不以固定confidence或直接去掉保護接入。現有對話修復部署是另一項工作，保留Jev不等於已修復或部署。

架構方向仍可試行：保留「System One 快速決策」作為管理及應用程式邊界，在現有 Dasein／lookski profile 之外增加 SLM provider；比較現有 Jev 與本機 Qwen 3.5 4B 的有限選擇能力，不直接取代 Main Agent、Menu 或 POS。

這裡將「不推論」落實為關閉模型的 thinking 模式、不輸出思考過程、不規劃工具、不建立 Agent 迴圈；模型仍需做語意判斷。模型只從本次候選選一項，不能輸出商品 ID、數量、工具參數、操作完成敘述或自創候選。

「每次輸出單一選擇」與「每句只呼叫一次模型」是兩個規格。現有 Jev 是多階段檢查，每題單選；本計畫優先保持這個流程，讓 provider 差異可被獨立衡量。若希望每句只跑一次，另做第二階段對照，評估是否同時保住對象、資訊／訂購、多需求及舊確認票據界線，不在替換 adapter 時一起刪除檢查。

現行 Jev 的 runtime 同樣報告 Qwen/Qwen3.5-4B；因此本次並非單純「換小模型」，而是比較 Jev 的選擇評分方式與通用 SLM 解碼、prompt、量化版本和部署引擎。不能將結果全部歸功或歸咎於模型參數量。

## 公平性複核：目前沒有優劣結論

目前結果是能力探測與接入診斷，**不足以判定SLM比Jev差或好**。22/24是與Jev的一致率，不是22題答對；本機約20秒的首題是目前部署的等待時間，也不能代表相同運算條件下SLM較慢。外部Jev與本機DMR的硬體、量化、部署版本及完整模板尚未對齊。

兩個影子差異都來自D03「我想請你幫忙，那個，我還沒說清楚。」：

| checkpoint | Jev | SLM | 可解讀範圍 |
| --- | --- | --- | --- |
| route | INCOMPLETE | NEEDS_ASSISTANT | 該對話鏈期望澄清，SLM可能更貼近這個目標；尚無獨立checkpoint gold，不能判它錯 |
| serviceRequest | BACKGROUND | UNCERTAIN | 明確求助不宜直接視為背景；仍需依該題完整契約審核，不能直接宣布SLM勝出 |

兩題相關，不能當成兩個獨立使用者案例。原Jev／Main鏈後來通過D03，也不表示Jev每一個中間選擇都正確；程式恢復與Main救援必須分開記錄。

目前案例與問題契約在Jev架構下發展，影子資料又只取Jev走過的前24個checkpoint；這可能偏向既有流程，也可能因歷史案例專挑Jev問題而低估Jev，偏向方向尚不能確定。測過的三句長短提示控制屬於開發資料，不能再當未見驗收集。短提示出錯只證明該提示配置有問題，不是SLM能力上限。

後續比較分成兩個問題，不混成一個排名：

| 比較目的 | 固定條件 | 允許調整 | 驗收依據 |
| --- | --- | --- | --- |
| 能否替換現有Jev provider | 同一語意輸入、候選、checkpoint契約與操作保護 | 各provider合適的輸入包裝與接受政策，在同一開發預算內調整 | 獨立gold的單題表現，以及各自完整流程的需求完成與錯誤效果 |
| SLM方案是否更適合場域 | 相同使用者需求、菜單、初始狀態、Main版本與操作權限 | 可另設適合SLM的問題拆法、穩定前綴與呼叫數，明列為另一方案 | 整句等待、完成率、誤操作、錯誤忽略、要求自行操作／重試的比例 |

正式比較前的必要工作：

1. 依使用者需求與題目契約獨立審核gold及可接受答案集合，保留來源和歧義；歷史Jev答案只是觀測。舊frozen測試保留，新審核結果使用新dataset版本。
2. 建立來源／語意家族去重的manifest，分開一般正常案例、歷史回歸挑戰及新案例；分開開發、校準、未看驗收集，不將重複forward算成獨立例句。原reserved需檢查是否已看過或受調整影響才能稱未見。
3. 先用固定checkpoint做成對比較，涵蓋Jev未走到的分支；再讓兩者各走完整流程。只有前者能直接比較同一題，只有後者能驗證場域結果。
4. 預先固定兩邊相同的調整預算與停止條件。共用業務語意，但分別調整適當的模板／輸出編碼；Jev模板移植只是一個實驗條件。JSON與單token模式分開報告，不能挑其中最佳數字混算。
5. 固定並記錄模型權重／量化、runtime、模板與硬體。品質比較與現有部署效能分表；硬體無法一致時明列差異，不做模型速度排名。延遲控制須匹配輸入長度、候選數、暖機、cache及併發條件。
6. 分別校準接受／棄權政策，按相同錯誤風險與覆蓋率目標比較，不能把Jev門檻直接套到不同來源分數。報告原始選擇、攔截、Main交接、最終完成與UI恢復負擔，避免把全部棄權或全交Main算成功。

在以上資料與條件備妥之前，現有數字只能標記為診斷，不作替換門檻或勝負依據。下一步先完成manifest與獨立gold，再進成對品質評測；快取／前綴實驗另外列為效能工作，不能代替公平性補強。

## 本機與現有程式的實際狀態

唯讀盤點得到：

- Docker Model Runner 正在運作，backend 為 llama.cpp；client v1.2.6，server v1.1.14。
- 模型目錄有 `huggingface.co/unsloth/qwen3.5-4b-gguf:latest`，4.21B，GGUF，模型 digest `sha256:d5b4946297207000d0260314fd33c2ec32b7595a4a82a9eba173960a8fcf0078`。CLI沒有回傳明確量化等級，不能由2.74B的大小直接推定。
- `http://127.0.0.1:12434/engines/v1/models` 可讀，確實包含該模型識別；當次 `docker model ps` 無已載入模型。清單存在不代表已完成推論或非思考驗證。
- 以上為規劃時的唯讀盤點；後續已授權載入既有4B並做推論，見末節。沒有下載、重啟、configure或切換正式啟用profile。

現有接入位置：

| 責任 | 位置與目前限制 |
| --- | --- |
| Profile資料 | `apps/server/src/schemas/webnavior-ai.ts`，implementation只有dasein／lookski；已有URL、加密key、modelId、timeout、active、verified欄位 |
| Provider邊界 | `apps/server/src/services/domain/kiosk-system-one/index.ts`；目前固定POST `/v1/systemone`，modelId是服務身份而非每次生成的選模參數 |
| 模型辨識／readiness | Jev讀`/health.model`或`model_id`，readiness使用noul；不能原封不動套在chat API |
| Admin API | `apps/server/src/routes/admin/webnavior-ai/index.ts`，兩處implementation schema及相關request type需擴充 |
| Admin畫面 | `apps/stage-web/src/components/Webnavior/SystemOneProfile{Panel,Dialog}.vue`、`useWebnaviorAiControl.ts`、`pages/system/models.vue` |
| 決策與執行 | `kiosk-interaction-decision`讀取choice／confidence；Menu持有候選、數量解析、版本、確認與執行權 |

## 有限輸出契約

SLM每個checkpoint只接受：本次語句、必要的角色對話、有效問題、最新狀態與候選ID／描述。預期答案、歷史模型答案、測試pass條件不進prompt。

輸出示意：

```json
{ "choice": "NEEDS_ASSISTANT" }
```

`choice`的enum每次由Application提供，模型不供應任何其他業務資料。需要棄權的題目由Application在該題候選中明確提供UNCERTAIN等對應出口；不讓模型憑空新增這個結果，也不把棄權算成HTTP／格式故障。

SLM只做直接選擇：不提供工具、`stream:false`、`n=1`（實機確認支援後才使用）、固定小輸出預算，禁止額外解釋及reasoning內容。超長、截斷、缺欄位、非法候選、額外工具呼叫、思考內容都記為契約失敗，不用擷取第一段JSON或刪除think標籤冒充正常輸出；不在這層新增LLM格式修復或隱藏重試。

優先驗證JSON Schema enum限制；不支援時，JSON mode只能列為另一個實驗條件，不能安靜降級且繼續宣稱具備相同保證。正確JSON不等於選對效果，仍須量測語意與實際副作用。

舊介面可一次帶多個question；SLM adapter要明確處理這個邊界：第一階段實驗以單題checkpoint為單位，正式接入前盤點所有caller；若需拆成多次請求，由Application決定固定順序，全部計時／計量／可取消，不能只取第一題或讓模型自行規劃下一題。生產主路徑目前使用segmented stages，仍需保留其他caller的正確性。

## 信心分數：主要接入風險

現有決策會拒絕缺少或不合法的confidence，且多處用其決定是否繼續。SLM輸出的自評0.99不等於Jev原有的分數，合法enum也不等於confidence=1。不得填固定分數、將缺分數填0、刪除門檻，或沿用Jev門檻便宣稱相容。

| 方案 | 評估方式 | 建議 |
| --- | --- | --- |
| Runtime分數＋獨立校準 | 實機確認可取得候選解碼所需logprobs，研究候選多token／grammar影響，再用獨立校準集建立接受／棄權規則 | 優先做可行性驗證；不是現成已保證功能 |
| 明確的無分數決策契約 | 將Jev分數證據與SLM有限標籤分為不同型別，設計可稽核的provider接受政策；以候選／狀態合法性與校準資料驗收，不能暗中模擬舊分數 | 若上列不可行，需另行設計、選定後才進正式執行流程 |
| SLM自填分數或合法輸出填1 | 不能證明風險可比，也容易讓原有guard失效 | 不採用 |

第一輪raw-choice評測不需要偽造confidence，也不接真實執行。取得結果後才決定上述生產契約；未解決之前SLM profile可評測但不可啟用正式Fast Path。這是實作依賴，不能只加一個implementation選項就算完成。

若使用logprobs，需記錄來源、計分方法、校準版本及適用checkpoint；受grammar約束後的token機率不能直接當成語意正確率，新的分數也不能與Jev 0.6直接比較。模型權重、量化、prompt或候選編碼改變後，舊校準不自動有效。

## Admin相容方案

沿用現有頁面、profiles表及啟用API，不另造第二套設定頁，也不將SLM偽裝成lookski服務。原有dasein／lookski值、key加密、資料所有權、驗證／停用行為保留，新增明確的provider分支（暫名`slm-openai`）。共用型別由無runtime副作用的擁有模組提供，避免繼續在Server與Vue各自維護枚舉。

| 管理項目 | Jev維持的語意 | SLM新增的語意 |
| --- | --- | --- |
| 服務類型 | Dasein／lookski | OpenAI-compatible有限決策；DMR為第一個目標 |
| Base URL | 服務root，不含systemone路徑 | API root如`http://127.0.0.1:12434/engines/v1`；adapter只附加models或chat/completions，避免重複/v1 |
| 模型欄位 | 已載入服務的身份 | 讀取可用模型清單，明確選擇完整model ID並在每次請求送出 |
| 生成設定 | 原有決策語意 | 非思考固定開啟，限制輸出長度；只暴露經驗證的少量參數，不開放任意JSON覆寫 |
| 連線測試 | 原health辨識保留 | models列舉＋實際有限選擇，不將models清單當readiness |
| 驗證狀態 | 現行verified／active | 分清連通、有限格式、非思考及執行接受政策是否通過；profile可先保存作評測 |
| 啟用／回復 | 保留現有流程 | 切換新需求的provider；失敗可明確切回既有Jev profile，不在同一輪靜默換模型重新執行 |
| 模型提示 | 既有語意policy | 語意policy先保持一致；SLM格式／非思考指令由adapter持有並版本化，不能被共用文字覆蓋 |

設定變動後使readiness／校準資格失效；普通Site人員不能修改系統模型。修改中的profile若失效，不能讓正在進行的判斷混用兩個provider：每輪綁定profile與設定版本，操作前仍重驗Menu狀態。

第一期不做大型admin測試資料編輯器。先以既有測試runner產出版本化報告，在admin呈現該profile的有效評測摘要／通過項與未驗項；報告不能由前端自行標記通過。完整測試資料管理另列後續需求。

## 現有資料能用到哪裡

10/29題數複核：先前盤點漏列`test_prompt/turnClassifierPoc/corpus.json`，它已有400句（240 train／80 validation／80 test），不能說現有語料只有下表的小型情境。10/22部署紀錄另有Menu757＋Kiosk233＋Server482＝1472項程式回歸測試，與獨立模型例句不是同一計數。目前尚未找到一份已確認含一千多個獨立、可直接用於本次SLM比較的標註題庫，不能擅自認定使用者記得的「一千多題」就是上述1472項。

本次quick的32是另外新編16個情境×兩種候選順序，並非從完整既有語料分層抽樣；400句題庫沒有跑進這輪。僅用這16例支持整體切換取捨的證據過窄，quick應降為小型可行性探測，不能代替既有語料比較。400句原契約為八類語句形態，與quick九類需求效果不同；若使用必須沿用其原契約單獨比較，不可粗暴轉標籤或拿舊遠端Jev成績充當目前端點對照。原train／validation／test是先前encoder實驗分割，不因此成為本次新未見驗收集。

| 資料來源 | 實際盤點 | 使用限制 |
| --- | --- | --- |
| `test_prompt/turnClassifierPoc/corpus.json` | 400句，八類，240 train／80 validation／80 test | 既有合成分類語料，非真實對話／操作效果；原標籤契約與本次quick不同，舊模型結果不能冒充當前A/B |
| `apps/order-menu/src/semanticReplay.test.ts` | 26個scenario，含development／holdout | 是舊版本frozen prompt語意；不能改寫舊成績或把看過的holdout稱全新未知測試 |
| `apps/order-menu/src/experiments/partitionScenarios.ts` | 44個scenario | 取其原句、前態與gold；不恢復舊partition實驗架構當正式gate |
| `apps/server/tests/experiments/kioskConversationCases.ts` | 20條人工對話鏈 | 包含主題切換、retry、數量總數等；reserved尚未跑，不拿來調prompt |
| `apps/order-menu/src/evaluation/historyData.ts` | R01–R06：3組partial、3組missing-evidence | 有來源hash／sequence可追溯；缺少原決策輸入者不能直接算SLM選擇正確率 |
| Server／Menu／Host各回歸測試 | 含價格、內外帶、舊確認、背景、語音片段與多需求 | 很多是mock／故障注入，測試數不等於獨立的語意例句數 |
| 10/22多需求計畫 | 另規劃48例正式baseline | 不能把計畫中的48例算成已備妥且跑過的資料 |

上述不可直接相加成獨立樣本總數。先建立manifest：穩定ID、來源／日期／hash、語句、菜單與狀態、候選、有效問題、角色對話、預期結果集合、禁止效果、證據完整度、case family與partition。只做必要的測試資料整理，不建通用utility平台。

去重按來源session與語意家族分組，避免同句改幾字分到開發／校準／保留集。先用熟悉資料debug，獨立校準集定接受政策，最後凍結未看的驗收集。歷史舊模型答案只是觀測，不自動當gold；有歧義先人工審核，保留不確定標註。

本次D09「我想問，那個，我還沒說清楚」在等待與主動retry回饋之間尚有規格差異，原套件仍保留未通過。新benchmark需先獨立確定可接受處置，建立新的dataset版本，不因某模型輸出而修改原frozen gold。

只在本機使用經整理的必要歷史片段；電話、裝置識別與客戶錄音不進prompt。當Jev指向外部端點時，公平A/B兩邊都使用相同的人工重建案例，真實歷史原文不送外部Jev；本機歷史重播另列來源與成績，不混成同輸入A/B。評測資料不先拿來微調；若未來要訓練，先固定完全隔離的驗收集。

## 分階段實施與驗收

| 階段 | 工作 | 交付／退出條件 |
| --- | --- | --- |
| 0：能力探測 | 確認固定模型digest、量化、server／llama版本；小型人工輸入測非思考、合法enum、截斷、額外文字、logprobs、取消、冷啟動 | 列出實機支援／不支援；不能以最新版文件代替舊版server結果 |
| 1：單題A/B | 同一gold、同一輸入與候選，同時比較當前Jev與SLM的raw choice；先6類smoke，再擴完整資料 | 記錄混淆矩陣、格式錯誤、正確接受／錯誤接受／棄權、延遲與輸出token；沒有操作權 |
| 2：接受政策與adapter | 選定分數／無分數契約；完成明確provider adapter與單元／整合測試、admin模型列舉與readiness | Jev既有行為不退步；SLM不能靠固定confidence啟用；變更設定會失效驗證 |
| 3：整條流程 | 每個provider走自己的完整decideInteraction與隔離Menu／Main，固定Main版本及菜單；20條鏈各3次 | 分開記raw選擇、程式攔截、需求完成與畫面結果；不能把Main救回算成SLM理解正確 |
| 4：負載與恢復 | 單機串行到2／4台併發；斷線、取消、慢推論、冷啟動、排隊滿、worker仍在跑及跨session | 有界排隊、公平性、過期丟棄；沒有晚到舊操作或重複寫入；故障不放大成重試風暴 |
| 5：場域小規模實測 | 先不執行的對照／隔離頁面驗證，再做明確選定的裝置試用 | 確認載入版本與provider身份；結果可核對、可切回Jev；經另外實作／更新授權後執行 |

固定checkpoint比較避免不同provider走不同路徑造成輸入不公平；整條流程測試再衡量各自的路徑差異。兩層分開，不把Jev產生的checkpoint分布當成所有SLM路徑都已覆蓋。

必測正常對照與失敗類別：背景同伴聊天、明確求助但意思不明、完整查詢／訂購、數量總數更正、內用自取、菜單與收音／付款題目切換、裸肯定、多候選、多品項、替代／更換、混合詢價加購、未知商品、價格與限制、待答問題過期、reset與retry。UI另外量「要求自己操作／按重試」「重複追問」「錯誤忽略」與完成率；全部轉交Main或全部棄權不算成功。

單一label若無法完整表示多需求，合法結果仍是MULTI_ACTION／NEEDS_ASSISTANT交接整句，不能只做第一項或強迫單選商品。

先分開測Jev與SLM以免同時搶同一GPU污染延遲，再做受控共用負載。每輪先固定最多600個模型HTTP／30分鐘，先到停止並標示partial；格式探測、readiness、Main及任何重試全部計入，三次連續provider故障停止。不同輪必須記明用途與版本，不無限重跑挑最佳。

模型在本機不代表免除排隊與恢復需求。沿用已存在的Kiosk語句queue；需要新增的共用限流應設在實際推論資源邊界，不能只限制每台瀏覽器。HTTP取消不保證GPU已停止，釋放執行額度前需核實backend行為。此次僅規劃，不先擴充queue基礎建設。

## 切換門檻與風險

- 格式／候選與單一結果契約通過全部固定故障案例；任何不合法結果都不進執行。
- 固定操作保護案例中零未授權寫入、重複操作、舊確認票據重放、不實成功宣告；有限樣本零事件不是未來零風險保證。
- 關鍵家族無未解的錯誤接受；比較Jev與SLM的逐類正確率、覆蓋率、錯誤忽略、Main交接率和完整需求完成率，不只報總平均。
- 延遲用冷／暖p50、p95、每turn呼叫數及端到端等待分開呈現；沒有量測前不承諾SLM更快。若上游SLM多花時間但仍需Main，不能只看單次token很少。
- 先在development固定品質及延遲目標，再凍結驗收；reserved不能用來校準。資料量不足以支持某類寫入接受政策時，清楚標為不可啟用，不以自評分數補齊。
- Qwen GGUF量化、chat template、上下文長度、候選順序及關閉thinking參數都可能改變結果，須固定並做候選順序擾動對照。
- 尚未證實SLM優於Jev，不直接刪除Jev設定；現有尚未部署的對話修復及D09缺口不能因換provider宣稱一起解決。

## 預估修改面與工作順序

預估為中等跨模組工作，admin表單本身較小，主要成本在provider契約、confidence政策及公平評測。依序進行能力探測／資料manifest、影子A/B、契約決策、adapter與admin、全流程／負載、裝置試用。第一階段無須新模型框架、新依賴、fine-tune或Agent。

產品實作以現有system-one service、admin route與profile表單為入口，必要provider-specific protocol／validation留在擁有模組；不建立只轉傳參數的service層。SQL變更如需新增SLM設定欄位採明確migration，不用假裝既有dasein值代表SLM。契約型別重整時完整追蹤所有confidence caller，不以葉節點cast掩蓋缺欄位。

正式runtime與admin尚未接入SLM，不commit／部署。已開始的實驗實作與結果見末節；正式接入前仍需確認confidence方案及「單一結果」的呼叫粒度。

## Forward、前綴快取與單token選擇的補充評估

Jev式單題forward的優勢是讀取最後位置的有限候選logits，避免長文字解碼；不等於跨題自動保存推論狀態。本機可讀的`/home/aimax/openjev/openjev/core.py`會為每題重新建立prompt並forward，未把past_key_values帶到下一題；該檔不是目前外部projev端點的已驗證部署身份，不能直接推定外部實作完全相同。

DMR目前使用llama.cpp，該backend具備共同前綴快取能力，可減少相同prompt token的重算。穩定system policy、店家靜態資料可放前綴，變動狀態／語句／問題放後方；各階段若在前面改動候選或指令，快取可重用部分會縮短。排序改動亦可能影響判斷，重排prompt需作新實驗條件。

這是計算重用，不是業務狀態來源：每次仍傳入最新完整必要情境，不依賴模型記住上一台／上一筆訂單。模型／模板／token prefix不一致、worker切換、slot被回收、重啟或混合模型架構的限制，都可能降低命中；不承諾DMR舊版已把所有控制項與量測欄位公開。

使用者已確認是每句新語句（招呼、詢問、訂購）各自的第一題慢，該句後續多次forward快；不是程序啟動後只有一次較慢。因此單純程序首次暖機不足以解釋整個現象。補看恢復後pilot `20261028-050654`：D01「我要水餃一份」route的state737字元／questions JSON5453字元，Jev exchange507ms；requestPurpose為30／391字元、199ms；cartRequest為90／663字元、222ms。這是問題資料字元數（非token／精確模型prompt）及HTTP往返（非純GPU時間），顯示首題較大輸入是已觀測因素，不能據此排除或證明cache。

本機server.py的--preload只呼叫get_engine載入，未執行暖機forward。公開core.py未見跨題past_key_values重用，但目前外部部署版本仍未核對；不能直接用本機檔案否定使用者部署存在cache。後續需在同token長度、等量候選的條件下比較：同一state換題、不同state同模板、完全不同前綴。保存同步後GPU時間、token與cache counters，分離prefill／問題長度／可能的跨題快取收益。forward_passes為程序累計的版本需按request另行關聯；core.py局部elapsed在GPU結果轉CPU前記錄，不能當同步後GPU時間。

在既有JSON有限輸出之外，可另測Application將候選映射成短標籤（例如A/B/C），限制SLM產生一個經tokenizer確認的token，再映射回原choice ID。這更接近Jev的短輸出，但不保證取得所有候選logits，也不自動解決confidence相容性。不得因JSON較慢就未評測地替換既定契約。

量測分成冷啟動、首次prefill、相同前綴第二題、前綴變動、多session交錯及cache eviction；紀錄backend確實提供的cached/evaluated tokens、prefill時間、decode時間與整句耗時。若DMR只回total usage，不能由第二次較快便宣稱cache已命中。快取也不取代queue、取消、GPU故障恢復或操作驗證。

依據：[llama.cpp server的cache_prompt與slot／timings說明](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)。本段未執行模型推論或調整runtime。

## 外部依據與實機未驗項

- [Docker DMR REST API](https://docs.docker.com/ai/model-runner/api-reference/)：OpenAI-compatible模型目錄與chat endpoint、JSON mode與logprobs；不據此推定本機舊版server完整支援JSON Schema。
- [Docker Agent的DMR參數說明](https://docker.github.io/docker-agent/providers/dmr/)：可用extra body傳chat_template_kwargs，但需engine與template確實支援。
- [Qwen3.5-4B官方model card](https://huggingface.co/Qwen/Qwen3.5-4B#instruct-or-non-thinking-mode)：提供enable_thinking=false的非思考模式；/think與/nothink不是Qwen3.5正式的軟切換。

以上只支撐能力探測方向；實測範圍與限制見下一節。單一選擇、非思考及JSON Schema已有小型控制證據，完整score契約、吞吐與公平品質評估仍未完成，未證明適合替代Jev。


## 第一批實作與實測結果

使用者於本輪核准開始處理。此次僅新增測試／實驗邊界與報告，不啟用SLM、不修改admin／正式資料庫、不commit或部署。原本對話修復的未提交變更仍保留。

### 已實作

- `apps/server/tests/experiments/slmDecision.ts`：有限選擇transport，支援JSON Schema與單token字母映射。固定非思考、無工具、無隱藏重試；拒絕多個completion、額外文字／欄位、非法候選、思考內容與工具呼叫。標籤模式刻意只生成一個token，僅在內容恰為合法標籤時接受length結束；JSON截斷仍拒絕。不產生production confidence。
- `slmDecision.test.ts`：18項離線契約測試通過；先有缺實作的失敗紀錄，再加入實作。這不是模型語意正確率。
- `slmCapabilityReplay.test.ts`：opt-in本機探測；新建private artifact目錄、保存source／prompt hash、原始請求／回覆、模型timings與預期。包括JSON／label、長首題加短題、共同前綴與前綴開頭改動、thinking開關及enum衝突。保留120 requests／10分鐘上限，不直接操作任何訂單。
- `kioskProviderReplay.test.ts`：`KIOSK_SLM_SHADOW=1`時擷取最多24個真實Jev checkpoint的state／question。先完成原Jev／Main情境，再於afterAll依序評估SLM，避免observer成本污染原deadline與Jev/Main結果。SLM答案不回傳Application；與Jev同意只算agreement，不充當gold。

### 能力與快取

最初四次小探測（`/tmp/webnavior-slm-capability-20261028-081713`）顯示JSON Schema／短字母可回有效答案，均有logprobs；短樣本JSON首次4.67s／第二次1.15s，label約0.38–0.40s。這四次不足以宣稱校準或所有題目皆能正確非思考回答。

完整長短控制輪（`/tmp/webnavior-slm-replay-CXKwOR`，對應`/tmp/webnavior-slm-live-capability.log`）：71次HTTP，零transport／格式錯誤，但只有35個控制回覆符合預期，capability suite為2通過1失敗。主要是縮短instruction後，招呼及訂購被反覆選成SEARCH。三句重複測試不是71個獨立案例，**不把35/71當成整體模型準確率**；不能為了速度直接縮短規則，也未更動gold。

較長共同state的cache實驗觀測：

| 條件 | cached tokens | 本次prefill tokens | prefill時間 |
| --- | ---: | ---: | ---: |
| 共同state第一題 | 0 | 2413 | 13.68s |
| 同state僅改問題末尾，後三題 | 1901 | 512 | 約3.00–3.03s |
| 每題改state開頭的控制組 | 0 | 2420 | 約13.78–14.55s |

所以DMR在此模型上**實際存在部分前綴重用**，不是全面不支援；短題重複仍可能cache_n=0。當次日誌也有forcing full prompt re-processing／likely hybrid/recurrent memory訊息，說明不能假設所有slot／長度都可重用。未由該訊息推定唯一原因，亦未更改全域cache／slot設定。

runtime紀錄：DMR server1.1.14，llama.cpp fingerprint `b1-3191462`，4B載入紀錄為Q4_K - Medium，模型buffer為CPU_Mapped／CPU_REPACK。尚未核實GPU加速可用設定；不可拿本機CPU載入條件與外部Jev的不同硬體時間，宣稱SLM模型本身比較慢或快。

第二輪將label輸入對齊公開lookski system／question模板（`/tmp/webnavior-slm-replay-X7GYcV`，`/tmp/webnavior-slm-aligned-controls.log`）：九個長短控制回覆中六個符合預期，招呼仍選成SEARCH，測試保持失敗。這輪不覆蓋第一輪，也未依同一句不斷加例外規則。

額外可重現控制（`/tmp/webnavior-slm-live-extra.log`）兩項通過、三次HTTP：關閉thinking的有限選擇有有效輸出；同一請求開啟thinking時出現reasoning_content，與關閉時分開；要求輸出非法BANANA及額外欄位時，回覆仍受有限JSON enum／欄位契約限制。只證明這些控制情境，不能保證所有語意正確。先前private enum探測缺user訊息的500是測試邊界錯誤，已用完整system／user請求重驗，不列為模型／CUDA故障。

### 實際Jev輸入影子對照

`/tmp/webnavior-slm-shadow-20261028-083255.log`與manifest／summary：擷取24題、嘗試24題、沒有因provider失敗提前停止；整輪86個模型HTTP含原Jev／Main與shadow。24題有22題與Jev同意；兩個差異為route的INCOMPLETE vs NEEDS_ASSISTANT、serviceRequest的BACKGROUND vs UNCERTAIN。未人工逐題標註前，不把Jev答案當gold，不直接判定哪個provider比較好。

當次SLM route九題往返median約20.03s，後續十五題約1.62s。這重現了「每句首題較慢、後續短題快」的型態，但大多數題目未命中cache；它也反映本機部署及輸入大小，不是單次forward的純GPU耗時。

top20 logprobs在22/24題包含所有候選字母，另兩題只含18/20，不能補零或直接假造完整分布。即使完整，API sampler／模板／量化造成的分數與Jev差異仍需校準，尚未得到可啟用生產的confidence方案。

原六條Jev／Main對話仍為5通過1失敗：D09原有INCOMPLETE／澄清預期差異保留。這不是SLM接管的完整流程測試。20×3、44／26來源的去重manifest、獨立gold／校準／holdout、完整SLM路徑、負載與實機仍未完成。

### 檢查與下一個交付單位

離線18項契約測試通過，五個live capability測試預設由env guard略過；改檔ESLint與git diff --check通過。此次只改測試／實驗與文件，不跑root typecheck／build，不將現有prod套件typecheck當成這些跨app實驗的驗證。

下一個品質交付單位是來源manifest與獨立人工gold，依前述公平性複核建立成對比較；另固定可重現的runtime／硬體條件，評估穩定前綴布局對首題成本的改善，再評估候選logprob覆蓋及校準。縮短提示與對齊模板造成的錯誤不能靠硬編語句解決。這些確認前，不接admin的正式啟用；保留Jev現況與切回路徑。
