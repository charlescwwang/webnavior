# System One 預期行為討論草案

日期：2026-10-09。狀態：**供討論，未核准，不是實作指令或驗收標籤**。

本輪後續討論已確認三項原則：查看須依上下文辨識菜單／商品／購物車，
無法唯一判斷時詢問；新增餐點缺少顧客指定的份數必須詢問，不依用餐人數
推算；商品更正須依對話辨識更正對象，缺少更正後份數時詢問，不默認繼承。
其他項目仍為提案，這三項確認不等於核准整份情境或開始實作。

範圍從人工輸入文字開始，不處理 ASR。以
[介面檢視第 13 節](../research/2026-10-02-jev-decision-review.md#13-webmcpjev-語意介面檢視2026-10-09)
的七項發現為起點；本文件不把現有輸出當成正確答案，也不要求先重建整個架構。

## 1. 對外部建議的判斷

| 建議 | 判斷／修正 |
|---|---|
| 先定義預期，再實作 | 採用。先定義關鍵行為與禁止效果，不必先寫完所有情境才開始改善。 |
| 不再檢查現有程式 | 不採用為絕對規則。程式與真實送出 payload 是介面能力及失敗原因的證據，但不是預期行為的來源。 |
| 六欄 Given／When／Intent／Resolution／Behavior／Must Not | 適合做情境模板；不是每句都一定有可執行 intent、唯一 target 或 mutation。 |
| Expected Domain Resolution 全由 System One 產生 | 不符合目前分工。Jev 選語意／有限解讀，application 解析與驗證 domain，不能把模型測試與 domain 測試混成一個準確率。 |
| 所有情境只設一個 intent 標籤 | 待定義契約後才可如此。未決業務語意不能偷偷給 gold label；交接或拒絕也要有明確條件。 |
| 真實 Qwen3.5 4B 測試 | 採用對照實驗，但先核對實際 loaded model、部署版本、prompt、候選與評分路徑；profile 名稱不是模型版本證據。 |
| 文字到 WebMCP／UI E2E | 採用於代表情境；先做 deterministic domain/runtime 驗證，再安排真實模型 browser 測試。支付用 simulator，不把人工語意驗證擴成真實扣款。 |
| trace 可以判定失敗原因 | 部分採用。能定位候選遺失、資訊缺失、解析及執行差異；單次低分不能證明是 prompt、排序或模型問題，需對照回放。 |
| 失敗不能增加 prompt 或 regex | 不採用為絕對禁令。不做單句補丁；若證據顯示 prompt 契約不清、數量或正式別名解析有缺陷，仍可修正並驗證整類案例。 |
| 一開始建立完整規格 | 改為第一批可討論的行為契約。明確列出未決項及擴充範圍，不宣稱涵蓋所有自然語言。 |

## 2. 責任與驗收口徑

- **語意意圖**：顧客要求的效果；名稱不綁目前 candidate ID。
- **決策結果**：raw model choice 與信心、Server 最後接納／拒絕／交接，分開紀錄。
- **Domain resolution**：對象、份數、規格、限制及其來源；不唯一時保留歧義，不編造資料。
- **Operation**：application 編譯、授權後實際执行的操作。
- **完成**：業務 state 與 UI 同步到預期結果；產生 candidate、plan 或 Main Agent handoff 都不等於完成訂購。

對正式預期已確定的案例，缺少正確候選算 candidate shaping 不符；
不能把「現有可选候選中最接近的答案」改成 gold。
未決案例可用於討論與觀察，不能計入正式 pass／fail 或訓練標籤。
模型選對但低分被拒絕，要分別計為語意正確、未完成自動化；不算已成功執行。

## 3. 七項發現如何轉成待決契約

| 編號 | 已確認的事實 | 建議方向（尚未核准） | 待決問題 |
|---|---|---|---|
| D1 查看／選取 | SELECT_ITEM 建立或重設 draft；focus refs 不一定提供 SELECT_ITEM 候選。 | 已確認：依本句、近期對話、實際呈現對象／問題區分查看菜單商品或購物車；資訊不足就詢問。不能把「查看」一律標成 SELECT_ITEM。 | 確定是菜單商品查看後，是否建立／覆蓋 draft 仍待決；畫面位置只是線索，不能單獨充當顧客意圖。 |
| D2 規格引用 | cart refs 只有品名與序號，不含 quantity／options。 | 提供短的規格 labels、份數與來源，由 domain 按已知規格解引用。 | 規格唯一時直接解析；多筆同規格時澄清。規格引用是否包含未加入 draft？ |
| D3 否定／更正 | literal matching 同時保留被否定與新提的商品；route 不能傳達更正關係。 | 已確認：依上下文識別更正，可能是在修正系統誤加而非顧客改單；更正後缺份數須询問清楚，不默認繼承旧份數。 | 更正目標不唯一時如何合併詢問；更正完成後以何種操作替換、必要規格如何取得，仍待決。 |
| D4 未指定份數 | Fast Path 正式品名問份數、Main Agent tool 預設 1、selected 繼承。 | 已確認：新增未說份數必須問，不論已知幾人用餐；不能以 tool default 或 draft 的預設值代替顧客指定數量。 | 已在同一未完成新增需求中明說的份數如何保留，須與商品更正需確認份數分開；查詢／查看不因缺份數而詢問訂購數量。 |
| D5 確認內容 | pending confirmation 只傳 action 名稱，未明示其 slots。 | 從同一確認 record 提供顧客可讀效果摘要，讓本輪 state 足以判斷。 | 「信用卡」重述是否算授權？建議選方式與確認啟動仍分開。 |
| D6 引用來源 | browser 有 referenceOrigins，模型 context 未完整攜帶。 | 保留必要 origin／freshness／ordinal，實際 ID 仍留 application。 | 明確新商品優先；省略引用在 draft／最近加入／展示之間有衝突時如何問？ |
| D7 查看全菜單 | 泛 SEARCH_MENU 會編譯為最多三項推薦，可能承接目前推薦批次。 | 顧客要求全部商品時可看到完整可販售清單。 | 分頁完整清單、先展示三項但可續看，或一律推薦？不能以推薦三項宣稱已列出全部。 |

## 4. 第一批情境矩陣

以下是**情境提案**。標「既有契約」表示有文件依據，仍等待本輪整體確認；
標 D* 要對照上表確認程度。已確認的原則可固定，但其餘未決效果／intent
表示方式不能直接作為 gold，也不能因同一列有一項確認而核准整列。

### 共用 Given

每列先套用 G0，再套用 Given 欄位覆寫。G0：phase=ordering，無 selected、
cart 空、checkout 無、無 pending question／clarification／confirmation，
無 active Agent request、無 previous utterance、無 presentation、無飲食條件；
catalog revision 與所有 domain revisions 為當前且一致。

測試菜單（合成 fixture，不當作真實商店資料）：

- S：招牌便當，100 元，便當分類，可販售，無必填規格。
- D：水餃，60 元起，主食分類，可販售；必填顆數十／十五，另有不辣／小辣選項。
- B：牛肉麵，120 元，麵食分類，可販售，無必填規格。
- V：蔬菜飯，80 元，飯類分類，可販售；店家明確標示 vegetarian、無豬肉。
- X：停售便當，不可販售。各 item 的價格／成分／規格均由 catalog 提供。

`draft D(十,不辣,1)` 是未加入的選取；`L1:D(十,不辣,1)` 是 cart line。
`present[S,B]` 依此順序真實顯示；`confirm(card)` 是有效且未消耗的
付款啟動確認，包含 card 效果摘要、當前 cart／checkout revision 及 expiry。
覆寫 cart 時總額依 fixture 算得；付款情境的 cart 為已檢視的一份 S、
fulfillment=takeout，非 uncertain POS receipt。各列獨立，不隱含前列 state。

| ID／契約狀態 | Given 覆寫 | When（完整文字） | Expected Intent | Expected Domain Resolution | Expected Behavior／狀態 | Must Not |
|---|---|---|---|---|---|---|
| S01／D4 | G0 | 我要兩份招牌便當。 | 新增 | target=S，quantity=2，options={} | cart 增加 S×2，UI 顯示同一結果 | 選其他便當、只選取不加入 |
| S02／D4 | G0 | 我想吃招牌便當。 | 新增（既有預設政策，待確認） | S；quantity=missing | 詢問招牌便當要幾份，尚未加入 | 預設 1、從人數推算、把想吃誤標為已完成查看 |
| S03／既有分類政策 | 菜單麵食只有 B | 我想吃麵。 | 查詢分類 | category=麵食，無訂購 target | 顯示 B，cart 不變 | 因分類只有一道就加入 B |
| S04／既有契約 | G0 | 有水餃嗎？ | 查詢 | query=D，quantity 不適用 | 顯示真實商品與可販售狀態 | 要求先補新增規格、加入 cart |
| S05／D1 | 菜單 present[S,B]；前一句系統：「想看哪一道的介紹？」；無 cart | 看第二個。 | 查看菜單商品（intent 表示方式待決） | target=B，source=當前菜單展示第二項 | 展示 B 資訊；draft 副作用仍待決，cart 不變 | 缺候選便改判新增、選第一項、把展示列表當 cart |
| S06／D1 | draft D(十五,小辣,2)；菜單商品畫面；前一句系統：「要查看哪一道的商品介紹？」 | 看水餃。 | 查看菜單商品 | target=D，scope=商品資訊 | 展示 D 資訊；保留 draft 是建議、未核准 | 宣稱已加入；未定義查看副作用就把它當無副作用操作 |
| S07／既有修改契約 | draft D(十,不辣,1) | 改成兩份。 | 設定份數 | selected D，quantity=2 | draft 份數為 2，cart 仍空 | 新增一筆、改規格 |
| S08／既有修改契約 | cart L1:D(十,不辣,1)，無 draft | 改成兩份。 | 設定份數 | L1，quantity=2 | L1 份數為 2 | 新增第二筆、增加到 3 |
| S09／既有歧義契約 | draft S×1；cart L1:D(十,不辣,1) | 改成兩份。 | 設定份數 | {selected S,L1}，quantity=2，target 未定 | 澄清兩個真實對象，先不改 state | 靜默優先 draft 或 cart |
| S10／待決無 target 回應 | G0 | 改成兩份。 | 修改需求，缺對象 | quantity=2，target=missing | 不執行；如何詢問／交接待決 | 任選菜單商品或標成已完成 |
| S11／D2 | cart L1:D(十,不辣,1)、L2:D(十五,不辣,1) | 十五顆那份不要了。 | 移除 | D2 建議唯一解析 L2 | 移除 L2，保留 L1 | 只按品名任選第一筆 |
| S12／既有歧義契約 | cart 兩筆不同辣度的 D，各一份 | 水餃不要了。 | 移除 | 兩個 cart targets | 澄清，問題顯示區分規格 | 移除全部、只問兩個相同品名 |
| S13／D3 | G0 | 不是水餃，是牛肉麵，一份。 | 新增 B；不是兩個新增 | B×1；D 是否定提及 | cart 增加 B×1 | 保留 D 為並列購買 target、加入 D |
| S14／D3 | 上輪顧客：「我要一份牛肉麵。」；系統誤加 cart L1:D(十,不辣,1)，並回覆已加一份水餃 | 不是水餃，是牛肉麵。 | 更正先前誤加（意圖表示方式待決） | correctionTarget=L1、requestedItem=B；更正後 quantity 尚待詢問 | 問牛肉麵要幾份；更正完成前的 cart 呈現／修改時機仍待決 | 當作另加 B、默認沿用一份、把系统誤加記成顧客原先點 D |
| S15／D6 | draft S×1 | 我要一份水餃，十顆，不辣。 | 新增 D | D×1，十／不辣；新明示 target | cart 增加 D；旧 draft 如何處置待 D1/D6 | 沿用 S 的 target 或規格 |
| S16／既有必填契約 | G0 | 我要一份水餃。 | 新增，待設定 | D×1，必填顆數 missing | 問十／十五顆，未加入 cart | 擅自選十顆、假裝加入完成 |
| S17／既有設定契約 | S16 後：pending 新增 D×1，等待顆數 | 十五顆。 | 補完原新增需求 | D×1，顆數十五；其他合法預設依已核准政策 | 完成原筆新增並清除該 pending | 把十五顆當十五份、新增兩筆 |
| S18／D6 | S16 後的 pending D | 有牛肉麵嗎？ | 新商品查詢 | query=B，不繼承 D slots | 查 B；未加入 D 的保留／失效待決 | 把 B 當 D 顆數答案、取消已存在 cart |
| S19／既有條件契約 | G0；菜單成分可驗證 | 找不要豬肉的飯。 | 條件查詢 | 飯類且 exclude=pork，非餐點客製 | 只顯示能驗證符合的結果，cart 不變 | 宣稱未知成分安全、不經授權改餐點 |
| S20／既有能力契約 | 無過敏交叉污染資料 | 水餃能保證不會讓我過敏嗎？ | NEEDS_ASSISTANT | target=D；所需安全保證 unsupported | 交接完整問題；不得宣稱安全 | 把不含某食材當過敏安全保證 |
| S21／既有多操作契約 | G0 | 我要一份牛肉麵，再幫我推薦飲料。 | MULTI_ACTION | 已知 B×1；推薦飲料需求一併保留 | handoff 不丟子需求；Agent 完成需另驗 | 只加 B 就宣稱整句完成 |
| S22／D7 | present[S,B] | 我要看全部菜單。 | 完整菜單查詢 | scope=all 可販售商品 | 按 D7 展示完整或可遍歷清單 | 僅給推薦三項卻宣稱是全部 |
| S23／既有背景契約 | 明確待答問題是「要看推薦嗎？」 | 我們下午再討論專案分工。 | IGNORE | 無訂單／回答 slots | 不執行，保留原問題 | 因有待答問題推定同意推薦 |
| S24／既有不完整契約 | G0 | 我要一份…… | INCOMPLETE | quantity=1，target 未定 | 不改 cart；保留片段的期限依既有核准政策 | 選招牌便當補完 |
| S25／既有 checkout 契約 | cart S×1、takeout、已顯示 review | 訂單沒問題，結帳。 | START_CHECKOUT | 當前 cart 明確同意 | 進 membership，不啟動付款 | 直接送 POS 或略過發票 |
| S26／既有 checkout 契約 | checkout_membership；無 scan | 不用會員。 | SKIP_MEMBERSHIP | 無 scan 結果 | 進 invoice | 偽造會員掃碼 |
| S27／既有 checkout 契約 | checkout_tax_id，尚未帶入號碼 | 統編是12345678。 | SET_TAX_ID | exact taxId=12345678 | 完整顯示，仍待確認 | 直接確認／前進付款 |
| S28／D5＋既有付款契約 | checkout_payment_select，idle；card/mobile 可用 | 信用卡。 | SELECT_PAYMENT | method=card | 建立啟動確認，尚不啟動終端 | 宣稱付款成功、自行授權 |
| S29／D5＋既有確認契約 | confirm(card)，已向顧客呈現摘要 | 確認，信用卡。 | 確認該啟動操作 | 同一有效 record、card | 消耗一次性確認，啟動 card 終端一次 | 改為 mobile、重複啟動 |
| S30／D5 | confirm(card) | 不要信用卡，改行動支付。 | 改選／新需求 | method=mobile，card 未授權 | 撤銷旧確認；建立新確認的流程待決 | 先啟動 card、把改選當 card 同意 |
| S31／既有支付鎖契約 | payment pending；checkout payment | 取消，重新開始。 | 取消需求，phase 禁止執行 | 不產生可執行取消／清空 plan；raw label 政策待決 | 保留鎖定、顯示真實付款狀態 | 取消終端、清空 cart、重付 |
| S32／既有一次性契約 | S29 的同一啟動收據／確認 ID 重送 | 確認，信用卡。 | 技術重送，不是新授權 | 已消耗 record | 最多一次終端啟動；展示可驗證現況 | 遺失回覆便重付；把正常新一句文字當同一重送 |
| S33／既有 freshness 契約 | 已解析修改 L1 的 plan；其後 relevant cart revision 改變 | 水餃改成兩份。 | 修改（原解析） | 原 plan stale，不能授權 | 拒絕旧 plan；是否重判需新流程 | 靜默用新 state 重編译旧 plan |
| S34／既有不可售契約 | G0；X available=false | 我要一份停售便當。 | 有效購買需求，無合法購買 target | X 不可售 | 說明不可售；回應路由待決 | 自行替換為 S、謊稱已加入 |
| S35／D1 | cart L1:S×1、L2:B×1；購物車畫面；前一句系統：「想看訂單哪一筆的明細？」 | 看第二個。 | 查看購物車餐點明細 | target=L2，scope=cart line 明細 | 展示 L2，訂單內容不變 | 對照菜單第二項、重設選取、新增 B |
| S36／D1 | 菜單及 cart 都有水餃；近期對話沒有查看對象線索 | 看水餃。 | 查看需求，scope 歧義 | menu D 或 cart D；scope 未定 | 詢問要看菜單商品資訊或購物車中的水餃 | 僅靠當前畫面猜 scope、先改 draft/cart |
| S37／D4 | 已知內用三位，桌位已處理；cart 空 | 我要招牌便當。 | 新增 | S；partySize=3；quantity=missing | 問招牌便當要幾份 | 加三份、預設一份、把三位當三份 |
| S38／D3 | 上輪系統已加入兩份水餃；顧客原需求與更正對象缺少可靠紀錄 | 不是水餃，是牛肉麵。 | 更正需求，對象／份數需釐清 | new=B；old target 的範圍與 quantity 未定 | 問清楚要更正哪筆與牛肉麵幾份 | 默認兩份、刪掉所有水餃、把誤單對話當權威需求 |
| S39／D4 | selected S 顯示 machine 預設 quantity=1；顧客尚未指定份數；前一句介紹 S | 就這個。 | 承接新增（意圖表示方式仍待驗證） | S；quantity=missing，UI default 不是顧客指定 | 問 S 要幾份，尚未加入 | 把 machine 預設值當已指定份數 |

## 5. 我建議的最小驗證順序

1. 先討論 D1–D7；選取其中已確定的情境作第一批規格，不讓未決案例進訓練。
2. 建立 scenario fixture，先驗候選與所需 facts 是否實際送達；用固定語意決策驗
   domain/runtime 效果。這個層次不受模型波動影響，能直接攔住本輪 A/B/C 缺口。
3. 從相同 fixture 經正式 compiler／Server 組真實 Jev payload；不要手工提供
   比正式流程更完整的 state 或較好描述的候選。記 raw choice、接納結果及 score。
4. 代表情境再用人工輸入入口做 browser E2E，驗 UI、cart、draft、pending 與
   simulator side effects；unit/runtime tests 不算已完成 UI E2E。
5. baseline 與 prompt/fine-tune 對照共用獨立驗收集；歷史失敗近似改寫與同一段
   對話不可散落 train/test。不能修一案就重跑直到一次通過並報為可靠率。

目前已有需 endpoint opt-in 的 liveReplay.test.ts，也有 domain/runtime 測試。
現有 live replay 部分直接手寫候選／state，適合 isolated contrasts，但不證明
正式 browser context 沒有資訊遺失。尚未在本輪證明完整 UI E2E harness 可用；
不承諾所有情境立即自動化，也不因此省略最終 UI 驗收。

每個失敗紀錄：原文／完整 fixture／revision／實際候選與 facts／有效 prompt／
模型與部署資訊／原始回答與可取得分數／Server 接納結果／resolution／plan／
authorization／實際工具收據與 UI。沒取得的證據明列，不用猜測填補。

報告分開列 raw semantic accuracy、直接完成率、澄清後完成率、錯誤執行率、
延遲及拒絕／交接原因。測試零錯誤不是營運零錯誤保證。

## 6. 本輪交付限制

只新增本討論草案；不修改 production code、prompt、候選、測試或 glossary。
不重新指定已完成的介面 audit 為業務規則；不採納仍有文件矛盾的敘述。
例如舊 delivery record 的題目批次描述與目前 route-first 實作並非全部一致，
本輪以既有 glossary／RMAP 為規則依據，delivery record 只作歷史與實作參考。
正式核准後，才同步 source-of-truth 契約與情境資料。
