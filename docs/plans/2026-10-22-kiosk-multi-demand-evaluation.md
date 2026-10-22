# Kiosk 多候選／多需求測試設計

日期：2026-10-22。狀態：已完成第一批歷史資料及離線重播，並使用使用者設定的真實 Jev／Main 跑過八例 smoke pilot；指定狀態檢查 7 通過、1 失敗。48 例正式 baseline、固定 Main sessions 與 DOM／ASR 延伸仍未完成，正式 prompt 未調整。使用者先要求設計，後續授權實作。目標是決定現有架構能可靠處理到哪一層，不預先選定新模型或新分類架構。

## 要回答的問題

1. 現行 Jev 能否把「一個需求有多個候選」和「多個獨立需求」導向正確流程？
2. 同時出現 A、B 時，能否區分並列訂購、替代選擇、比較、更換，以及詢問加操作？
3. 上游判斷錯誤時，Application 是否保住操作邊界？
4. 交給 Main 後，是否逐項處理原始需求，還是只完成第一項就宣告全部成功？

模型選對路由、程式攔住錯誤、服務真的完成，是三個不同結果。不得以「最後沒亂加」推定 Jev 理解正確，也不得把 NEEDS_ASSISTANT 算成需求已完成。

## 既有證據與可沿用設施

- [歷史問題與本機修正](2026-10-22-kiosk-field-investigation.md)：多餐句誤入單選，以及 bare assent 被解成第一個候選；目前已加保守交接與執行保護。這些保護會掩蓋上游錯誤，評測必須讀取 guard 前的真實 Jev route。
- [決策研究 §12.3](../research/2026-10-02-jev-decision-review.md)：10-07 的 26 句／32 個假設，五題需求拆解完整符合 0/26；重複第一／第二效果、五句多需求被判 ONE。該實作已否決，不能恢復成正式 gate，不能用全部退回的零誤放行宣稱理解改善。
- `apps/order-menu/src/semanticReplay.test.ts`：現有 `decideInteraction`、真實 Menu runtime、角色對話、development／holdout 與 env-guarded live replay。其凍結 prompt／案例有歷史版本語意，不能直接改成此次 baseline。
- `apps/order-menu/src/clarificationDiagnosis.test.ts`、`fieldRegression.test.ts`：沿用真實 revision／question／cart 邊界及錯判注入方式。
- `apps/server/src/services/domain/kiosk-interaction-decision/liveReplay.test.ts`：沿用 provider 回應、實際 call／question 與延遲觀測方式。
- `apps/order-menu/src/experiments/{effectCoveragePoc,requirementPoc,partitionReplay}.test.ts`：沿用 oracle 不進模型、每輪保存、結果不覆寫、實驗和正式流程分離的做法；不修改其 frozen gold 或重算既有實驗成績。
- Kiosk 現有 Browser 測試：用實際 DOM 驗菜單、問題、cart、selected 與 session 重設。單元測試不取代這一層。

不加新依賴；先使用既有 Vitest、System One adapter、Menu runtime 與 loopback simulator。runner／evaluator 限測試目錄，產品路徑不讀取測試標註。

## 案例資料與判定來源

每個案例包含：穩定 ID、來源組別、development／reserved 分組、語句、版本固定的菜單、起始 cart／screen／checkout、目前問題與期限、角色對話、操作順序、逐項預期與禁止效果。人工案例使用人工菜單；歷史重現須另保留原始版本與重建差異。

預期答案由人工依完整語句及上下文標註。標註拆成「效果、對象、數量、關係、依賴、可接受處置」，與實際觀測分開保存。例如：

```text
語句：牛肉麵、水餃各一份
預期：ADD(noodle,1) AND ADD(dumpling,1)
禁止：只加第一項卻宣告整句完成；任一項重複加；改動原有 cart

語句：牛肉麵不要了，改水餃一份
前態：cart 有 noodle×1
預期：REPLACE(noodle-line, dumpling×1)
禁止：留下 noodle 同時新增 dumpling；新目標未確認就刪掉原餐
```

`REPLACE`、`AND`、`ONE_OF` 等是測試 oracle 的需求關係，不是新增正式 Jev intent、工具或生產用需求清單。逐項對照先由測試 evaluator 完成，用來確認是否有必要再設計產品端追蹤機制。

同名不同規格以實際 cart line／options 識別，不能只比對餐名。省略份數時要保留未解決狀態，不由測試替顧客補 1。不支援品項可正確說明不能處理，但不等於已完成訂購。

## 歷史對話、人工對照與泛化三組

歷史對話正式納入測試規劃，與下方 48 個新編案例分開。此前只有歷史問題作為設計依據，尚未建立獨立來源組與對話重現契約；本節補足這個缺口。

| 組別 | 用途 | 計分方式 |
| --- | --- | --- |
| 歷史重現 R 組 | 保留必要原始對話及當時狀態，確認已知問題是否仍發生 | 只依證據足以支持的層級評分；不完整事故不算整條重現通過 |
| 人工對照組 | 從 R 案例只改一個條件，例如「對」前面是單餐確認或多項單選 | 連結既有 D/H 案例，必要時補新 ID；不把改寫版本冒充原始案例 |
| 人工泛化組 | 用新的措辭、商品與操作順序，避免只修已知句子 | 沿用 48 例的 development／reserved 分組，與 R 組分開報告 |

### 第一批歷史候選與來源

下列六項是收錄候選。後續已核實兩份本機原始快照，R03–R05 製成局部重現資料，R01／R02／R06 在已核實的資料中未找到原附件，保留待補標記。來源是既有 [10-22 調查](2026-10-22-kiosk-field-investigation.md) 與 [handoff](../codex-handoff.md)；具體檔案與 row hash 保存在 `apps/order-menu/src/evaluation/historyData.ts`。不宣稱已搜尋所有私有儲存或補齊原事故。

| ID | 歷史問題／定位 | 必須保留的情境 | 目前已知證據限制 |
| --- | --- | --- | --- |
| R01 | 10-08 附件 `fedc8278`：多餐點後回答「對」 | 原始多餐句、真正顯示的問句、合法候選、後續 route／relation／工具結果 | 原附件從釐清後開始，最初路由未捕獲；可重播確認邊界，不可捏造完整首輪事故 |
| R02 | 10-21 附件 `b0b98800`：鱔魚意麵被加成牛肉麵 | 原話、當時無鱔魚品項的菜單、分類／商品證據、實際加購結果 | 核對本機 recording 的關聯；測試不能自行加入不存在的商品或修正原話 |
| R03 | 10-21 session `WpW9YM6aK7lDFgT-V1m3e`：加購 1＋2，後續宣告 2／4／5／7 | 兩次成功工具回執、逐輪 cart、後續 assistant 原文及無對應寫入的區段 | cart／文字可核對；沒有當時畫面就不宣稱 DOM 已證實 |
| R04 | 10-22 session `-P5dg5ANoXS371a95szIt`：seq134–153、329、341、346–371、396 | 內外帶改口順序、當時 fulfillment、結帳問題、工具是否執行、後續權威快照 | 記錄可驗宣告與狀態矛盾；原始 selected／動畫畫面不足，另以 Browser 對照驗 |
| R05 | 同一 10-22 調查的單品→其他推薦→全部菜單，seq186–221 | 單品 query、推薦批次／排除條件、原始完整菜單要求、文字與 presentation 結果 | 收錄前核對對應 session，不憑 sequence 單獨關聯；缺 DOM 時不補成原始畫面證據 |
| R06 | 10-07 附件 `196c07ec`：「其他推薦」被選成 fresh recommend | 原批次、已展示品項、對話、more 候選與捕獲 route | 當時缺執行回執；可驗路由／本機重建機制，不直接判定原場域實際重複展示 |

每項需記錄：來源檔案／附件、session 與 sequence 或事件 ID、原時間與時區、來源 hash、當時程式／菜單／policy 版本可知程度、顧客原文、目前有效問題、工具與 cart 證據，以及缺少的資料。找不到原檔就保留「待補證據」，不能只依 handoff 摘要還原一段自稱原始的對話。

### 對話重現與 oracle 邊界

重播從能建立必要前態的最早一輪開始，至少保留：正在回答的 assistant 問句、其前一個使用者需求、影響指代的查詢／選餐，以及建立 cart 的成功回執。保留先後次序、角色、問題 ID 的對應與狀態版本；執行時可重新發行合法 ticket，但不能把原本過期的回答變成有效同意，也不能用舊模型宣告建立假 cart。

歷史對話分別標記：

- **完整重現**：必要前態與對話／工具證據齊全，可驗整條需求的結果；不要求保留所有無關閒聊。
- **局部邊界重現**：例如 R01 只有釐清後的 route，能測該邊界，但不能評首輪 Jev 是否正確。
- **待補證據**：缺少會改變預期的前態或原始內容，先不進入 pass/fail 分母；報告仍列出缺口數與原因。

人工 gold 以顧客原意與可驗證的成功結果為準，不把事故中的錯誤 assistant 文字當標準答案。歷史無法唯一判讀時，標註需釐清，不從模型當年的高信心倒推出顧客已授權。若需要補人工菜單／state／provider 回答，只能列為連結的人工重建對照，不能升級成完整歷史重現。

### 執行與報告

先作本機離線歷史邊界重播，再連到 A／C／D 的 runtime 及 DOM 對照。真實模型 baseline 的 144 turn 預算仍只涵蓋下方人工 48 例；不能把新增 R 組偷偷混入相同預算或計分。歷史資料進模型的重跑，須在 fixture 完成後另列輸入內容、模型執行環境、資料處理方式與用量；本設計階段不啟動。

原始對話留本機；共用的 fixture 去除電話、姓名、裝置／會員識別及非必要談話，保留角色、指代與語序。去識別或替換商品若改變語意，該版本是人工衍生組，不再標原文重現。測試程式不讀 `/tmp` 證據作執行時依賴；實作時建立可重現的最小 fixture 與來源對照，敏感原始檔不進版本庫或外部模型。

最終報告分開呈現 R 組完整／局部／待補、人工對照及人工泛化成績，並為每個 R 案例列出連結測試 ID、實際覆蓋層級與尚未驗收部分。R01 優先連結 D19/D20/D21，R02 連結 D03，R04 連結 D17，其他連結不足處再補對照；不能因人工版通過就把原事故標為已通過。

## 第一版 48 個人工案例

八組各六例：三例 development、三例 reserved。下表每列是兩個獨立案例，D 與 H 使用相同測試契約、不同措辭。reserved 只用於凍結後驗證，不用於 prompt／候選描述調整；這是工程上的保留組，不宣稱模型從未見過類似語句。

人工菜單含牛肉麵、水餃、兩款便當；「便當」有兩個候選；「招牌餐」是兩品項共用別名；鱔魚意麵不在菜單。每例初始狀態明列，除表中特別指定外均為新 session、可點餐、無待答問題、空 cart。人工必選辣度只用於明示的規格案例，不改實際店家菜單。

| 組別／ID | Development 語句 | Reserved 語句 | 狀態與預期 |
| --- | --- | --- | --- | --- |
| 多項訂購 D01/H01 | 牛肉麵、水餃各一份 | 一份麵，再一份水餃；麵指牛肉麵 | 兩項明確訂購；各加一次 |
| D02/H02 | 牛肉麵兩份，便當一份 | 給我兩份牛肉麵，再來一個便當 | 麵數量明確；便當需選款，不能用麵成功代表全句完成 |
| D03/H03 | 牛肉麵跟鱔魚意麵各一份 | 水餃一份，鱔魚意麵也一份 | 一項不支援；逐項說明，不把不存在餐點替換成現有麵食 |
| 單項歧義 D04/H04 | 我要一份便當 | 便當來一個 | 一項訂購、兩個 target 候選；先釐清，不先加第一款 |
| D05/H05 | 招牌餐一份 | 給我一個招牌餐 | 共用別名，不是兩項訂購 |
| D06/H06 | 那個兩份 | 剛剛那個來兩個 | 畫面同時展示兩道、未選中；要釐清指代 |
| 替代選擇 D07/H07 | 牛肉麵或水餃，幫我挑一個 | 水餃跟牛肉麵選一道就好 | ONE_OF／推薦；不能兩道都加，推薦本身不授權訂購 |
| D08/H08 | 牛肉麵或水餃都可以，我要一份 | 兩種任一種就好，只要一份 | 一項訂購、顧客允許替代；目前能力不足可交接／再確認，不變成兩份 |
| D09/H09 | 牛肉麵還是水餃呢 | 我在想選水餃還是牛肉麵 | 未明確要求現在訂購；比較或釐清，不改 cart |
| 資訊／比較 D10/H10 | 牛肉麵跟水餃哪個便宜 | 水餃和牛肉麵價格差多少 | 查兩項價格、比較；零寫入 |
| D11/H11 | 牛肉麵跟水餃都有嗎 | 有賣水餃和牛肉麵嗎 | 一個多品項可售查詢；不是兩項訂購 |
| D12/H12 | 牛肉麵兩份多少錢 | 兩份水餃要多少 | 數量在資訊問題中；不能因份數自動加購 |
| 更換／撤回 D13/H13 | 牛肉麵不要了，改水餃一份 | 那份牛肉麵換成一份水餃 | cart 有 noodle×1；驗真正替換，不是單純 ADD |
| D14/H14 | 水餃改兩份，不要換牛肉麵 | 水餃要兩份就好，不改成牛肉麵 | cart 有 dumpling×1；只改數量，否定品名不當成新增 target |
| D15/H15 | 牛肉麵別換，另外加水餃一份 | 原來牛肉麵留著，再點一份水餃 | cart 有 noodle×1；保留原餐並新增，不誤判替換 |
| 混合需求 D16/H16 | 加牛肉麵一份，水餃多少錢 | 水餃一份幫我加，牛肉麵有賣嗎 | 一項 ADD 加一項 QUERY；查詢餐點不加購 |
| D17/H17 | 水餃改兩份，再改外帶 | 改內用，水餃要兩份 | cart 有 dumpling×1；兩個效果各自核對，不能只完成其一 |
| D18/H18 | 牛肉麵一份大辣、一份小辣 | 小辣牛肉麵一份，大辣的也一份 | 人工 POS 提供辣度；兩個規格組合各一份，不能合併成兩份同辣度 |
| 上下文短答 D19/H19 | 對 | 是的 | 有效「A 或 B，請選一項」問題；不選第一項，保留待答 |
| D20/H20 | 對 | 沒錯 | 有效「您要點 A 一份嗎」問題；只確認 A，仍走既有授權 |
| D21/H21 | 第二項 | 第二個 | 有效單選問題順序固定；只選第二個真實 target；交換順序的控制另測 |
| 背景／未知 D22/H22 | 小陳，牛肉麵跟水餃你想吃哪個 | 小王，你要水餃還是牛肉麵 | 對同伴說話；不改 cart，不因多餐名轉交易 |
| D23/H23 | 外面說可以做，但這個軟體有問題 | 這個程式為什麼算出這種分數 | 無點餐服務需求；不進交易助手流程 |
| D24/H24 | 我要一份…… | 給我那個…… | 無可確定指代、明顯未說完；不補品名／份數、不寫入 |

首次模型測試前，檢查 D/H 每句標註與 fixture 是否自洽；例如 H01 明確補全「麵」指代，不以單一分類成員充當身份。真正有多種合理解釋的句子，以必須釐清或允許處置集合標註，不強迫唯一 label。爭議在觀測結果前處理，不能跑完才改答案。

每個案例的「可接受 route」須依凍結的當前合法候選另列：例如多項訂購可接受完整轉交 Main，但錯選 ADD 後被程式擋下，只算程式保護成功；不算 Jev route 成功。比較及更換不必發明新 Jev label，可由既有 NEEDS_ASSISTANT 等合法路徑承接。

## 四層測試，四份成績

### A. 離線邊界重播

先用固定 provider 回應重播正確與錯誤選擇，沿用真實 runtime／schema／authorize，不偽造 cart mutation。覆蓋：把多項需求選成 ADD、把「對」選成第一項、重複／過期 ticket、換顧客、觸控插入修改、失去工具回執、provider timeout。

這層回答程式是否安全及測試能否抓錯，不給模型準確率。evaluator 本身須有反例驗證：漏第二項、重複加第一項、錯規格、只有 assistant 成功文字、讀到資料但未更新 DOM，都必須被判失敗。

### B. 現行 Jev 真實模型 baseline

使用目前 `decideInteraction` producer、當前合法候選、實際 policy 與相同 fixture；保存原始 route／relation／recipient、最終 decision、Application resolution 與 handoff。不能直接拿舊 replay 檔內凍結的 prompt 當成目前部署設定。

每例跑三次，48 × 3 = 144 個完整 decision turn；固定亂數排序，每例新 session，不把上次結果塞回歷史。三次結果分開保留，不能挑最好或多數決冒充正式行為。報告每例 0/3～3/3 的一致性；這不是 144 個獨立使用者樣本。

raw route 與 guard 後分開評分。若程序在 Jev 之前就解決問題、沒有呼叫模型，要標 `application-resolved`，不計 Jev 命中。模型需要多次 forward 時，各次回答與實際 call／question 數都要保存。

### C. Main 接手與逐項完成

先注入可控 Main 回應驗 evaluator，再用相同 baseline 的真實 Jev 接真實 Main／當前工具契約，對人工菜單及本機 cart 執行。交易與付款只能用隔離 simulator；不得觸碰正式店家 cart、訪客資料或支付。

對每項人工預期，從工具結果、最新 cart line／quantity／options、展示內容與真實 DOM 取得結果；模型自行宣告完成不能當證據。可用處置狀態為：已完成、待顧客補充、不支援且已說明、失敗、結果不明。測試最後報告「全部履行／部分履行／尚待回答／未完成」，不把未完成項刪掉。

獨立且明確的需求可以有部分成功，但必須逐項說清楚；不支援的餐點不能算已訂購。替換、付款等有依賴的效果先核對前提，不能先移除原餐或付款再發現替代目標不明。以「正確處置每項需求」和「實際履行全部可履行需求」兩種指標分開表示。

首輪不用跑完整 144 次 Main。預先固定 12 個 case ID：D01、D02、D03、D07、D10、D13、D16、D17、D18、D19、D20、D21，各一條最多四個顧客 turn 的 session；需要補充時使用預先寫好的回答，不看結果臨時救場。總計最多 48 個顧客 turn，沿用現行 Main 工具／輪數／timeout 上限。完整工具明細與最後回覆都留下。

### D. 顧客畫面及連續操作

在本機 Browser fixture 驗：單選問題問法、第一／第二項順序、明確規格、cart selected、完整菜單 DOM、由 voice 轉 touch、reset 後舊答案拒絕。至少把 D01、D13、D18、D19→D21 四條關鍵流程接至真實 DOM；其餘可先用 runtime 驗，報告清楚標明覆蓋層級。

ASR 與現場麥克風是後續一層：先把文字理解與執行測準，再用同一批人工句子錄製測試音訊，分別比較人工文字與辨識文字的結果。不得把 ASR 錯字直接算成 Jev 理解錯，也不能因 ASR 錯就忽略最終服務失敗。

## 如何量測「Jev 是否理解結構」

正式路由只能顯示它是否把需求導向可處理的路徑。比較與替換都可能合法轉 Main，因此兩者轉交正確，不代表 Jev 已能辨識兩者的內部結構。

若 baseline 不足以回答能力問題，再做**獨立、單題、非執行用** finite-choice probe：SINGLE、MULTI、ALTERNATIVE、INQUIRY、REPLACEMENT、MIXED、ANSWER、BACKGROUND、UNCERTAIN。單題測主要關係，不做先前已失敗的五欄獨立拼接；混合操作／資訊優先 MIXED，只有資訊／比較用 INQUIRY，操作更換用 REPLACEMENT，有效問題的短答用 ANSWER，不明確時允許 UNCERTAIN。

probe 使用相同 utterance／question／必要角色對話，不提供 gold、商品 ID、執行計畫或前次分類結果。先固定標註及優先順序，再跑同一 48 例 × 3；單獨產生 confusion matrix。其成績只能叫「新測試 prompt 的結構辨識能力」，不能與正式 pipeline 混算，不能自動採用為新 gate 或授權寫入。這是可選第二階段，不在第一輪 baseline 預算內。

## 結果、門檻及執行上限

報告逐列列出：模型路由正誤、是否 application 攔截、是否正確交接、每項實際處置、錯加／漏加／重複／錯替換、錯誤成功回覆、問題／畫面同步、呼叫數、provider 時間與完整 turn 時間。分組統計及失敗原文必須可追溯；不能只給整體平均準確率。

第一輪判定採下列標準，測前固定：

- 安全：案例中零未授權／錯 target／重複／付款鎖定寫入，零把部分成功宣告為全部完成。任何一例不符都必須列為失敗；不是統計上的「零風險保證」。
- 語意：逐案例報命中與合理 abstention，不把「全交給 Main」算理解成功。development／reserved 各自呈現；少量樣本不換算成現場保證率。
- 服務：每項需求有可追溯處置，明確可履行需求實際完成；需要補充時問對範圍、保留其他需求及既有 cart。模型 unavailable／timeout／schema 錯誤分開列，不能移出分母讓成績變好。
- 效率：記錄 median／p95／最大值、實際 provider calls／questions、額外 Main 回合及過度轉交情況；相同負載與模型設定才作比較。不在資料產生前聲稱特定 SLA。

先跑 A，不連外；再跑八個 development pilot（每組一個），驗 transport／artifact 可靠性，不計正式成績。pilot 後若改測試契約或 prompt，要重新凍結版本，保留 pilot，不能併入未改版的成績。B 正式 turn 144 個；除非另行安排，不重試失敗 turn、不自動切換模型、不因錯誤降低 confidence 門檻。B 最多 600 次實際 provider HTTP、30 分鐘，先到即停止並保留部分結果；這只是本次實驗上限，不改正式 timeout。HTTP 400／401／403／404／429 停止檢查；連續三次 provider failure 停止。C 另記 Main 用量與 turn 預算，不能把它隱藏在 Jev 次數裡。

第一輪真實模型 baseline 只用新編人工案例；歷史組依上節另外整理與執行。現場證據留在本機用於回歸對照，不直接送去外部模型。執行前固定 git revision／dirty diff hash、cases／gold／菜單／policy／candidate prompt hash、模型實際回報名稱、設定與時間；dirty 工作區不能只記 HEAD 冒充可重現版本。無法核對模型身份即標 unknown，不從 profile 名稱推定實際 loaded model。

輸出用唯一 run ID，保存 case/input manifest、逐 turn JSONL、模型 exchanges、Application receipts、cart 差異、必要 DOM 證據、摘要與未執行項目。credentials 不進 artifact；檔案不覆寫，gold 不進模型輸入；不同版本結果不混成一次測試。

## 實作與判讀順序

1. 先核實 R01–R06 的原始證據與前態，建立來源對照並標明完整／局部／待補；再按人工表建立獨立 cases／gold／fixture，檢查 48 個 ID、分組、前態與預期可成立，並鎖定版本。歷史來源組不併入人工 48 例計數。
2. 補離線 evaluator 及錯誤注入反例，與已存在的 historical regressions 同跑。這一步通過只表示測試設施可用。
3. 跑現行 Jev baseline，先辨認是模型路由、Application 解讀／授權或 transport 出錯。
4. 用固定 12 條 Main session 及四條 DOM 流程檢查逐項完成；若現有架構無法保留未完成需求，明確記為功能缺口，不用測試端代替產品修復。
5. 只有需要區分「會轉交」和「懂結構」時，再執行獨立單題 probe。對照結果後，才選擇改 prompt／候選描述、保留保守轉交，或另設計需求追蹤；不先決定要多加一個分類器。

上列完整評測流程仍是規劃；已實作範圍與離線、真實模型 pilot 結果分別依下節記錄。沒有正式設定變更、部署或提交。

## 第一批本機實作：歷史資料與離線重播

`apps/order-menu/src/evaluation/historyData.ts` 保存六項來源狀態與三項局部原始節錄。R03 來源為 `webnavior-quantity-session-audit.json`，SHA-256 `d5d22c5b831cc15e0d058041722a671dce79371a08b533a77ed97e2359e02ddc`；R04／R05 同屬 `webnavior-20261022-entries.json` 的同一 session，SHA-256 `6b88ff131e438d7c4736a896c4dbc2086ef7b012ae90486c9d8b647bd3ec9f7f`。以 source file hash、原 sequence、UTC 時間與原 row 的 canonical-JSON SHA-256 定位；公開 fixture 不保存 session／transport IDs，cart line ID 依位置替換。原始來源仍是私有資料，不作測試執行時依賴。

- **R03**：保留原始多選問句、`排骨便當`／`我要兩份。` ASR、兩次工具呼叫及 1→3 的收據、`總共只有兩份` 更正與後續 2／4／5／7 份宣告。測試先驗收據事實，再驗顧客更正仍未滿足；新的明確 `cart_set_line_quantity` 是人工修復對照，不冒充捕獲到的歷史操作。
- **R04**：保留真實內外帶快照、原始改口、結帳問題與無回執的成功文字；Kiosk 測試將原文字送入現行回覆邊界，拒絕假成功。正確工具變更另測為控制組。
- **R05**：保留單品 query、原始 update／continue／data-only 呼叫、菜單 receipt／presentation IDs 與完整菜單要求。原有錯誤工具序列仍無法證明完整呈現；明確 catalog 工具是人工修復對照。沒有原始 DOM，不將 presentation receipt 升級為畫面驗收。
- **R01／R02／R06**：標 `missing-evidence`，連結現有人工控制測試；取用原案例會明確失敗，不用 synthetic 替代後算作歷史成功。

`outcomes.ts` 為測試專用逐需求事實評估器：依權威 cart 的品項／數量／規格、用餐方式與實際 presented IDs 判定 satisfied／mismatched／unknown。沒有快照不能當空 cart；同品項不同規格不能合併成已完成；只有文字不能證明操作或呈現。提供 before-cart 時另檢查未要求的 cart／fulfillment 改動。它不判斷同意、不授權操作，也不測模型準確率。

反例測試透過真實 Menu runtime 製造漏第二項、重複第一項、兩份同辣度冒充兩種辣度、額外品項，以及 data-only 讀取，核對 evaluator 能否偵測。回覆測試留在 Kiosk，不讓 Menu 測試跨入 Kiosk recording／model type graph；不調整 tsconfig 或使用替代 import 掩蓋邊界問題。

固定重跑入口：

```sh
pnpm -F @proj-airi/order-menu test:history
pnpm -F @proj-airi/stage-kiosk test:history
```

這些測試也自動納入各 package 的 `test:run`。一項既有推薦診斷仍預設跳過，不能算已解決。完整歷史事故 0、局部原始案例 3、待補原始證據 3；測試通過表示局部資料／當前保護／人工修復對照符合預期，不表示三個原始事故已完成真實模型端到端驗收。

驗證結果：新增 11 項測試通過；固定 history 範圍 Menu 54 通過／1 個既有診斷跳過，Kiosk 5 通過。Menu 全套 757 通過／176 跳過，Kiosk 全套 233 通過／48 跳過；最終節錄與更正控制修改後，兩條 history 指令再驗通過。Menu／Kiosk package typecheck、修改檔案 ESLint 與 diff 檢查通過；未執行全專案 typecheck、真實模型、正式 POS 或本輪 Browser 驗收。紀錄在 `/tmp/history-{suite-final,replies-final,menu-complete,kiosk-complete,menu-types-final,kiosk-types-final,style-final}.log`。


## 使用設定中的真實模型：八例 smoke pilot

使用者授權「先用我設定裡的 jev 跟 llm」後，沿用 Server 的 `tests/experiments/kioskProviderReplay.test.ts`，補上八個人工情境。此為 transport／實際執行檢查，不是上述八分類各一例的正式 development pilot，也不是 48×3 baseline；沒有把歷史私有對話送給模型。

執行時間：2026-10-22 16:12（Asia/Taipei）。Run ID：`20261022-081236`。實際設定及身份核對：Jev implementation `lookski`，設定及 runtime health 回報皆為 `Qwen/Qwen3.5-4B`；Main alias `webnavior/chat`，設定 upstream override 為 `qwen36`，本次未獨立核對供應商實際 checkpoint，該身份仍為 unknown。使用當時 dirty 工作區；沒有測前凍結完整 diff／prompt／cases manifest，因此不升格為可重現的正式 baseline。

測試透過真實 Jev adapter、LLM router、Kiosk SSE route、Menu／Kiosk runtime 執行。修正舊 replay helper，帶入原始 transcript／handoff、每輪刷新 conversation context、按 allowedToolNames 提供工具、沿用正式回覆驗證。沒有強制把所有情境送 Main；只有真實路由為 NEEDS_ASSISTANT 時才呼叫。訪客／對話／health 更新在隔離 PGlite；正式 PostgreSQL 連線加 `default_transaction_read_only=on`。採 simulator 菜單與 development profile，模型路由仍使用既有 Redis 的用量／併發機制；未修改正式設定，未寫真實 POS／付款。

| Case | 新編語句／前態 | 本次觀測 |
| --- | --- | --- |
| multi-add | 牛肉麵跟水餃各一份 | cart 兩品各一份；Main 實際呼叫兩次 add。Jev 的 cartRequest 卻選 SINGLE（confidence 0.9881），由 Application 多品項保護轉交；不能算 Jev 理解並列成功。最終回覆只確認最後一項水餃，兩項摘要完整性尚未通過獨立驗收。 |
| single-ambiguous | 我要一份便當 → 對 → 第二項 | 初始不寫 cart；真實 Jev 將「對」選第一候選，Application 拒絕並再次釐清；第二項才加入一份。狀態保護通過，原始 Jev 指標失敗。 |
| alternative-inquiry | 牛肉麵或水餃，你推薦哪個？先不要加 | cart 保持空，presentation callback 收到兩品；未評推薦文字品質。 |
| replacement | 已有牛肉麵一份；牛肉麵不要了，改水餃一份 | Main 透過 replaceLineId 更換為水餃一份，原牛肉麵移除。 |
| mixed-query-add | 牛肉麵一份幫我加，水餃一份多少錢？ | **失敗**：cart 空；主模型五輪、七次 menu_get 皆被拒絕，未完成加購或詢價。 |
| quantity-correction | 已有水餃三份；剛才的水餃總共只要兩份，請幫我改好 | cart 最終兩份，沒有再次累加。 |
| fulfillment-correction | 已有水餃一份／外帶；等等我要改成內用 | runtime fulfillmentMode 變內用，品項數量維持；未驗實際 selected DOM 或動畫。 |
| whole-menu | 已顯示椒麻雞；我要看你們全部的菜單 | callback 收到完整七品，cart 空；尚非 Browser DOM 驗收。 |

混合句的已觀測失敗鏈：Jev 先選 add-item，再將 requestPurpose 選 INQUIRY（confidence 0.7648），因此略過整句 cartRequest coverage，轉入資訊流程；price INFORMATION 的 confidence 0.4778 未過門檻，交接 reason 是 UNCERTAIN_FILTER。現行 `conversationDecisionStateFrom` 將該 reason 設為唯讀；價格仍未解決時，工具回覆要求指定單份價格上下限／範圍。Main 反覆查同兩個品項，七個收據皆 ok:false，五輪內沒有結束。這同時暴露混合需求被二分目的壓掉，以及受限制後未適當停止／釐清的問題。不能只加大輪數或解除唯讀來當修復；需先補能保留「指定加購＋獨立詢價」的整句交接契約及回歸。

結果是 **8 個指定狀態檢查中 7 通過、1 失敗**，不是 Jev 理解率、逐需求服務完整率或現場成功率。另 16 個 opt-in 既有 provider cases 因 `-t` 篩選而未執行。沒有重試失敗句、改 confidence 或改正式 prompt 來提高分數。Main 實際參與 multi-add、replacement、mixed-query-add 三個 session；其他流程由快路徑／Application 處理。

執行命令（須先安全載入既有環境；不輸出 credentials）：

```sh
KIOSK_PROVIDER_REPLAY=1 pnpm -F @proj-airi/server exec vitest run tests/experiments/kioskProviderReplay.test.ts -t 'configured multi-demand acceptance' --maxWorkers 1 --reporter=verbose
```

本機原始結果：`/tmp/webnavior-configured-multidemand-20261022-081236.log`（權限 0600），包含 Jev 原始 choice／probability、執行工具收據及最終 cart／presentation callback。不是完整每輪 provider exchange manifest；未保存的資料不可追補成已捕獲。環境未開啟時，檔案可載入、24 個 live tests 全部跳過，這只是 env guard 驗證。新增 runner 的修改檔 lint 通過；沒有以離線 skip 當模型成功，也未執行全專案 typecheck。實際 DOM、ASR、正式裝置 profile 與 48 例 baseline 仍待驗。
