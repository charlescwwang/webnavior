# Turn Classifier PoC：獨立比較報告（2026-10-06）

## 狀態與結論

**第一階段 PoC 已完成，不建議直接接正式操作。** 使用者確認選型後，已完成
MiniLM frozen encoder＋分類頭、同 encoder 的 embedding similarity、SetFit 微調、
validation-only 校準與 Encoder→Jev 分類 fallback 模擬。

本次 80 句保留測試：Jev 47/80、frozen head 58/80、similarity 54/80、SetFit 59/80。
三個本地方法暖機後約 8 ms，低於本次遠端 HTTP 基準約 1682 ms；但仍有高信心
複合需求誤判。高門檻縮小覆蓋率，不能將 classifier 的快或總分提升當成操作安全。

這個 PoC 完全沒有整合進正式 Kiosk。未修改 `deriveDecisionContext`、
`resolveIntent`、WebMCP、付款授權、上下文生命週期、正式 prompt 或 persisted policy。
未重啟服務或建立 commit。未把其他 thread、顧客附件或訂單紀錄傳給外部服務。

這組合成資料支持繼續研究小 encoder 與 contextual referral，但尚未證明能
穩定攔下足夠多的高信心簡單操作。SetFit 僅比 frozen head 多答對一題，不足以
宣稱微調顯著較好。Resolver、真實訂單效果、Main Agent 使用比例均未測量。

## 共同量測條件與訓練

本機 Apple M4、16 GiB RAM、10 個邏輯核心。三個方法固定 CPU float32 推論、
torch 一個執行緒，不使用 MPS／GPU；訓練為 CPU 四個執行緒。每句實際推論三次，
取 median 後計算整批 mean/P50/P95；沒有快取測試句 embedding。
Jev 使用每句一次的 HTTP 時間，含網路／TLS／服務處理。這是部署路徑成本比較，
不是同硬體純模型 forward-pass 比較；沒有用微秒級差距判定本地模型速度排名。

Backbone：`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`，
revision `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`。117,653,760 parameters，384 維。
環境 Python 3.13.2；核心套件及全量 freeze 分別在
[requirements](./requirements.txt) 與 [environment freeze](./environmentFreeze.txt)。

- Frozen head：固定原 encoder，正規化向量，multinomial logistic regression，
  C=1、max_iter=1000、seed=42。載入／encoding／fit 共約 1.26 秒。
- Similarity：相同原 encoder，對 240 個訓練句求 cosine；每類取最高分再選類。
  不微調 encoder，不把 cosine 本身當機率。
- SetFit：相同起始 encoder，240 訓練句產生 960 個 contrastive pairs，固定
  batch16、60 steps、learning rate2e-5、seed42，最後訓練相同 C=1 分類頭。
  body training 約 17.29 秒，載入／訓練／存檔約 18.58 秒。

只跑一個 seed 與一組事先固定設定，没有看 test 改資料或重試到成功。
Jev 是 prompt-defined 零樣本分類，Encoder 是 240 句有監督訓練；測試輸入和
標籤相同，但不能把差異宣稱為 backbone 的絕對能力差異。

## 語料與固定契約

[corpus.json](./corpus.json) 共 400 句、每類 50 句；240 訓練、80 校準、80 保留測試。
80 個手工分組，每組五句，每組只屬一個 split；沒有用替換品名模板擴增句數。
Dataset SHA-256：`e6d7c3d213d7c2b9e426bcd485b348260964926b2bcd65d99a4a63f4cab1f6b0`。

標註包含原先討論的失敗家族與其他餐飲語句：查詢誤當加購、分類願望、品名尾段、
「好／一位／微辣」、推薦拒絕、食材排除、反悔、未完成 ASR、背景話語與複合需求。
其他 thread 的架構討論只用來理解責任邊界，沒有視為真實測試結果或盲信其診斷。

標籤優先序見 [README](./README.md)。特別約定：

- `DIRECT_ACTION` 是提出需求的語句形態，不是 `ADD_ITEM`，也不是執行授權。
  「我想吃便當」仍需 Domain Resolver 判斷分類瀏覽，不能分類完成就加購。
- 「那個會辣嗎」優先 `REFERENCE`，不能因看起來是查詢就跳過 reference 解析。
- 「好／一位／微辣」標為 `REFERENCE`，不推論答案效果或付款同意。
- 修改、取消仍是 contextual；classifier 不猜對象或目前狀態。
- 多個獨立需求與有意義的未完成句為 `UNCERTAIN`；不是無意義噪音。

這是本次 agent 編寫的合成語句與單一編寫者標註，尚未經人員盲標或真實營運資料驗證。
手工家族拆分降低直接重複，但不等於所有語意近似已隔離；例如查詢句保留共同詞彙。
每類只有十個保留樣本，一句就改變該類 recall 十個百分點。平衡合成分布不等於現場分布。

## Jev 八類單句基準

端點：`https://openjev.aikcitri.qzz.io/v1/systemone`。
Provider 回報模型：`openjev/Qwen/Qwen3.5-4B`。
每次只傳目前合成語句與相同八類描述，不傳菜單、history 或 gold label。
80/80 取得合法輸出，完整批次沒有 provider failure。

這是 **Jev 作為 Turn Classifier 的同任務比較基準**，不是原本 state-aware domain
decision 的重播。原先 26 案例的正式 seam prompt 對照是不同任務，不合併計算。

| 指標 | 結果 |
| --- | ---: |
| Accuracy（合法輸出與全量分母相同） | 47/80，58.75% |
| Macro F1 | 0.5742 |
| 單句 HTTP latency 平均 | 1682.19 ms |
| P50 | 1660.25 ms |
| P95 | 2062.54 ms |
| 原始 confidence 的十區間 ECE | 0.1768 |
| Multiclass Brier（未除以類別數） | 0.5522 |
| 可用完整 probability vector | 80/80 |
| 回報 probabilities 加總範圍 | 0.9998–1.0002 |

未任意正規化上游 probabilities；只有加總與 1 差異不超過 0.001 的完整向量納入
Brier，以容許四位小數 rounding。ECE 直接衡量 provider 回報 confidence，不將其
當成已校準的正確率。續跑相同 prompt 的 80 句 validation，取得合法完整向量後
擬合 temperature，T=1.1482；test 校準後 ECE0.1243、Brier0.5435。
Jev 校準使用 log posterior，而 raw confidence 是 provider 的分數，兩者來源不同；
不是直接把 provider confidence 套公式改寫成可靠正確率。分類選擇完全不變。
這些數值不能直接決定正式 Kiosk 的信心門檻。

| 類別 | Precision | Recall | F1 |
| --- | ---: | ---: | ---: |
| DIRECT_ACTION | 0.7000 | 0.7000 | 0.7000 |
| QUERY | 1.0000 | 0.8000 | 0.8889 |
| REFERENCE | 0.7500 | 0.3000 | 0.4286 |
| MODIFICATION | 0.8333 | 1.0000 | 0.9091 |
| CANCEL_OR_REVERT | 0.6667 | 0.2000 | 0.3077 |
| CHAT | 0.7692 | 1.0000 | 0.8696 |
| NOISE | 1.0000 | 0.1000 | 0.1818 |
| UNCERTAIN | 0.2069 | 0.6000 | 0.3077 |

Confusion matrix：列是真實人工類別，欄是預測；A=直接需求、Q=查詢、R=reference、
M=修改、C=取消／回復、H=聊天、N=噪音、U=不確定。

| Gold \ Pred | A | Q | R | M | C | H | N | U |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 7 | 0 | 0 | 1 | 0 | 1 | 0 | 1 |
| Q | 0 | 8 | 0 | 0 | 0 | 0 | 0 | 2 |
| R | 1 | 0 | 3 | 0 | 0 | 1 | 0 | 5 |
| M | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 |
| C | 0 | 0 | 1 | 0 | 2 | 1 | 0 | 6 |
| H | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 |
| N | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 9 |
| U | 2 | 0 | 0 | 1 | 1 | 0 | 0 | 6 |

觀察：

- 「有牛肉麵嗎？」在這個新八類題目選 `QUERY`，confidence 0.7742；不代表已修好
  正式 route 或後續食材條件驗證。兩個測試的輸入與候選不同。
- 「我想吃麵，一碗」選 `DIRECT_ACTION`、0.3965；若只接受高信心，仍需 fallback。
- 「好」「一位」「微辣」被選為 `UNCERTAIN`；不符合本次 `REFERENCE` 標註，
  但 `UNCERTAIN` 本身是安全暫緩，不等於誤下單。
- 「不用啦謝謝」選 `CHAT`、0.7124；若直接當閒聊處理，可能漏掉拒絕。
- 「幫我結帳順便多加一份水餃」選 `DIRECT_ACTION`、0.7503，未保留複合需求。
  這是高信心也不能跳過下游驗證的例子；PoC 沒有執行它。

## Jev 原始分數的接受／暫緩檢查

先對 **Jev 自己的原始分數**做接受／暫緩診斷（不是 Encoder→Jev fallback）。
低於門檻或預測 `UNCERTAIN` 一律暫緩，其餘按固定 referral 規則計數。

| Threshold | Domain referral | Contextual referral | 非執行處理 | 暫緩 | 接受部分類別錯誤 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.70 | 11/80 | 6/80 | 7/80 | 56/80 | 2/24 |
| 0.80 | 4/80 | 3/80 | 5/80 | 68/80 | 0/12 |
| 0.90 | 1/80 | 1/80 | 3/80 | 75/80 | 0/5 |
| 0.95 | 0/80 | 0/80 | 1/80 | 79/80 | 0/1 |

不能看完這張表就選 0.80：這等於在 test set 選門檻，接受樣本也太少。
需要獨立驗證集與另一批保留資料。高門檻沒有觀察到錯誤不代表零風險。

## Encoder 結果與校準

| 方法 | Accuracy | Macro F1 | Mean ms | P50 ms | P95 ms | raw ECE | calibrated ECE | calibrated Brier |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Jev Qwen3.5-4B | 58.75% | 0.5742 | 1682.19 | 1660.25 | 2062.54 | 0.1768 | 0.1243 | 0.5435 |
| MiniLM frozen＋head | 72.50% | 0.7225 | 8.10 | 8.17 | 8.87 | 0.3581 | 0.1232 | 0.4892 |
| MiniLM similarity | 67.50% | 0.6742 | 7.99 | 8.02 | 8.62 | 0.1178* | 0.1609 | 0.4831 |
| MiniLM SetFit | 73.75% | 0.7349 | 7.80 | 7.86 | 8.83 | 0.3062 | 0.1079 | 0.4507 |

*Similarity 的 raw confidence 是最高 cosine，不是 probability。其 raw Brier 不可用，
也不能把此 ECE 當成未校準 softmax 的 ECE。Raw／calibrated 本地結果共用實測
latency（包含最終校準計算），不是各自重跑後挑較快結果。

校準只在 80 句 validation 以 NLL 選一個正 temperature，固定對數 grid0.01–10、
301 點；不調分類頭、不改 argmax。Frozen T0.4266、SetFit T0.4677、Similarity
T0.0794，均未落在 grid 邊界。校準提高分數的參考性，但不是操作正確率保證；
每類十句、十個 reliability bins 與單一 seed 的結果仍很粗。

以下每格為 Precision／Recall／F1；每類 support10。完整矩陣、reliability bins
及每一句原始／校準分數見 [comparison.json](./results/comparison.json)。

| 類別 | Frozen head | Similarity | SetFit |
| --- | --- | --- | --- |
| DIRECT_ACTION | .6364/.7000/.6667 | .6364/.7000/.6667 | .6667/.8000/.7273 |
| QUERY | .8182/.9000/.8571 | .8000/.8000/.8000 | .8182/.9000/.8571 |
| REFERENCE | 1.0000/.6000/.7500 | .7778/.7000/.7368 | .8571/.6000/.7059 |
| MODIFICATION | .7000/.7000/.7000 | .6364/.7000/.6667 | .7778/.7000/.7368 |
| CANCEL_OR_REVERT | .6429/.9000/.7500 | .5333/.8000/.6400 | .6429/.9000/.7500 |
| CHAT | .8750/.7000/.7778 | 1.0000/.6000/.7500 | 1.0000/.7000/.8235 |
| NOISE | .8182/.9000/.8571 | .8000/.8000/.8000 | .8182/.9000/.8571 |
| UNCERTAIN | .4444/.4000/.4211 | .3750/.3000/.3333 | .4444/.4000/.4211 |

SetFit confusion matrix，縮寫與上面 Jev 表相同：

| Gold \ Pred | A | Q | R | M | C | H | N | U |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 8 | 0 | 1 | 0 | 0 | 0 | 0 | 1 |
| Q | 0 | 9 | 0 | 0 | 1 | 0 | 0 | 0 |
| R | 0 | 0 | 6 | 0 | 1 | 0 | 1 | 2 |
| M | 0 | 2 | 0 | 7 | 1 | 0 | 0 | 0 |
| C | 0 | 0 | 0 | 0 | 9 | 0 | 0 | 1 |
| H | 1 | 0 | 0 | 0 | 0 | 7 | 1 | 1 |
| N | 0 | 0 | 0 | 1 | 0 | 0 | 9 | 0 |
| U | 3 | 0 | 0 | 1 | 2 | 0 | 0 | 4 |

實際問題回放（Encoder 分數為校準後，Jev 為原 provider confidence）：

| 本句 | Jev | Frozen head | SetFit |
| --- | --- | --- | --- |
| 我想吃麵，一碗 | DIRECT_ACTION .3965 | DIRECT_ACTION .9089 | DIRECT_ACTION .8789 |
| 排骨便當來一份。 | DIRECT_ACTION .8253 | NOISE .3435 | REFERENCE .3470 |
| 有牛肉麵嗎？ | QUERY .7742 | QUERY .8093 | QUERY .7959 |
| 好 | UNCERTAIN .4006 | REFERENCE .5818 | REFERENCE .6213 |
| 一位 | UNCERTAIN .5080 | REFERENCE .7337 | REFERENCE .7779 |
| 微辣 | UNCERTAIN .4319 | MODIFICATION .3563 | NOISE .4815 |
| 不用 | UNCERTAIN .3473 | CANCEL_OR_REVERT .7841 | CANCEL_OR_REVERT .8489 |
| 結帳順便加水餃 | DIRECT_ACTION .7503 | DIRECT_ACTION .8421 | DIRECT_ACTION .8340 |

低信心的 NOISE 仍走 fallback，不直接丟棄；REFERENCE 也不代表人數或付款已解析。
「結帳順便加水餃」是原句「幫我結帳順便多加一份水餃」的表格縮寫，預期 UNCERTAIN。
這是 Encoder 和 Jev 的共通失敗，而非換小模型即消失。沒有針對任何句子加特例。

## Encoder→Jev fallback 模擬

固定政策：低信心或 UNCERTAIN→Jev；高信心 A/Q→Domain Resolver；R/M/C→
Reference Resolver；H/N→非執行處理。以下使用校準後 Encoder confidence。
Domain referral **不等於執行**，contextual referral **不等於 resolver 已答對**。

| 方法 | 門檻 | Domain | Contextual | 非執行 | Jev fallback | 接受部分錯誤 | 混合類別錯誤率 | 投影平均 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Frozen | .70 | 9/80 | 13/80 | 11/80 | 47/80 | 6/33 | 28.75% | 1016.88 |
| Frozen | .80 | 6/80 | 7/80 | 8/80 | 59/80 | 4/21 | 36.25% | 1256.05 |
| Frozen | .90 | 2/80 | 3/80 | 6/80 | 69/80 | 2/11 | 41.25% | 1464.82 |
| Frozen | .95 | 0/80 | 2/80 | 4/80 | 74/80 | 0/6 | 38.75% | 1574.44 |
| Similarity | .70 | 3/80 | 5/80 | 8/80 | 64/80 | 0/16 | 35.00% | 1344.26 |
| Similarity | .80 | 2/80 | 3/80 | 5/80 | 70/80 | 0/10 | 37.50% | 1477.10 |
| Similarity | .90 | 1/80 | 2/80 | 2/80 | 75/80 | 0/5 | 40.00% | 1590.10 |
| Similarity | .95 | 0/80 | 1/80 | 2/80 | 77/80 | 0/3 | 40.00% | 1630.91 |
| SetFit | .70 | 9/80 | 14/80 | 11/80 | 46/80 | 5/34 | 27.50% | 1000.49 |
| SetFit | .80 | 5/80 | 9/80 | 9/80 | 57/80 | 4/23 | 32.50% | 1216.30 |
| SetFit | .90 | 0/80 | 6/80 | 9/80 | 65/80 | 2/15 | 33.75% | 1388.95 |
| SetFit | .95 | 0/80 | 4/80 | 7/80 | 69/80 | 0/11 | 32.50% | 1471.89 |

所有句子直接走 Jev 的類別錯誤率為 41.25%。這批 mixed class error 沒有更差，但
不能視為實際點餐更穩定。SetFit .70 投影比全 Jev 減少約 40.5% 分類時間；.95
約減少 12.5%。**它們不是已量測的端到端改善，也不是推薦採用的正式門檻。**

安全性：SetFit .70 有兩個 UNCERTAIN 複合句錯送 domain，.80 仍有一個；.90/.95
沒有這種 domain 誤送，卻沒有任何直接 domain 覆蓋。SetFit .90 接受部分兩個
類別錯誤仍被分到 contextual／非執行處理，而非直接操作。零錯誤的 .95 只接受
11 句，其中七句是非執行處理、四句是 contextual，不能證明簡單點餐已可穩定攔截。

投影為每句 Encoder 實測時間＋僅 fallback 句對應的既有 Jev HTTP 時間。
沒有啟動實際 chained server，沒有重新測 Jev 負載改變或逐句不同呼叫順序。
Jev fallback 的選擇只是分類假設，不額外模擬正式 confidence gate、slot verification
或語意問題追加。Resolver 未實作，未给予 oracle 答案；其延遲與正確率均未計入。
所有完整假設、錯誤／漏處理計數與 raw-score threshold 對照都保留在 comparison JSON。

## Cold start 與記憶體

| 方法 | 冷進程 imports＋載入 ms | 首次推論 ms | 進程 peak RSS MiB |
| --- | ---: | ---: | ---: |
| Frozen | 3854.29 | 15.21 | 1171.44 |
| Similarity | 3351.15 | 16.33 | 1183.52 |
| SetFit | 3444.52 | 137.75 | 1213.69 |

各方法只量一次新 interpreter 冷進程，不清除 OS 檔案快取；此時間從 script 開始
到模型載入，包含 imports，不是下載時間。模型下載／快取解析約 12.30 秒，另計。
首句和 warm latency 分開，不用單次冷啟動數字宣稱穩定分布。

117,653,760 個 float32 parameters 共 470,615,040 bytes（448.81 MiB）；
這才是權重大小。RSS 是 Python／PyTorch／tokenizer／已載入模型進程的 high-water
值，不是純模型記憶體。SetFit 訓練進程 peak 約 2522.55 MiB，不當成推論 RSS。
模型和環境檔案留在 git-ignored 的 `models/`、`.cache/`、`.venv/`，没有新增常駐服務。

遠端 Jev 未暴露模型生命週期或記憶體，因此 remote cold start／RSS unavailable。
首個 HTTP 請求不是 remote cold start；usage 累計欄位未當成每句 token 或 latency。

## 對原先五個問題的回答

1. 小 Encoder 可以很快辨識部分簡單語句，但目前覆蓋／誤送 trade-off 尚不足以
   宣稱高信心攔截已穩定；frozen 與 SetFit 都有高信心複合需求錯誤。
2. 指示詞、序號、裸答案、修改、取消應保守標為 contextual，實際目標仍由有效
   問題與 references 決定；沒有上下文不能把「好」補成同意。
3. 本次分類層混合錯誤率可較全 Jev 低，但 resolver 尚未驗證，不能回答整體流程
   一定更穩定。提高門檻也不等於消除未知風險。
4. 本地 warm latency 可降至約 8 ms，混合分類時間有下降空間；Main Agent 路徑
   未運行，不能聲稱其使用率已降低。
5. 值得進一步做**獨立 resolver／domain plan 回放**，但現在不值得直接把 Jev
   降為正式 semantic fallback。下一階段須先定義可直接解析的需求與安全退回邊界，
   再用新的保留資料驗證，而不是修補本次錯句、調低門檻或替換正式流程。

## 可重现结果与检查

- [完整比較／confusion matrices／reliability bins](./results/comparison.json)。
- [Jev test](./results/jevTest.json)、[Jev validation](./results/jevValidation.json)、
  [frozen](./results/frozenTest.json)、[similarity](./results/similarityTest.json)、
  [SetFit](./results/setfitTest.json) 均保留逐句結果及 provenance。
- [README](./README.md) 包含執行命令與精確標註／比較邊界。
- Python 默认 User-Agent 的初始批次收到 403，停止并保留于
  `results/jevPythonDefaultUserAgentFailure.json`，不并入完整分类分母。
  用明确识别实验客户端的 `airi-turn-classifier-poc/1` 可正常呼叫；没有加入凭证或
  绕过付款／订购授权。另有两次合成诊断成功，不算入这 80 句结果。
- Corpus audit、metric／routing smoke checks、Python compilation 與實際 CLI 訓練、
  校準、量測、report consistency 檢查通過。
  未跑 full-project typecheck：本次未修改任何正式 TypeScript/API 契約。

## 第二階段：獨立 resolver／安全分流驗證（2026-10-07）

結論：**仍不適合整合正式路由。** 已驗證現有 resolver、revision guard 與
付款確認的真實 interface；沒有另寫一套點餐狀態機。但「分類高信心＋唯一合法
操作」仍不能證明完整需求被理解。連唯讀旁路也有資訊問題只得到品名搜尋的缺口。
本次 prototype 隔離原則限制了變更範圍，codebase-design 的 seam 原則讓回放
沿用既有 Menu／Server interface，而不是複製正式規則。未修改任何正式流程、
模型設定、依賴、服務或工具分界，沒有提交 commit。

### 實驗與資料品質

[40 個新合成場景](./resolverScenarios.json) 在推論前固定，SHA256
`971bd9c212700dffbbd6ab2b7e5e49ddb404bce8318b1affae83f1ee5d73b45b`。
與第一階段400句沒有完全相同的字串，但仍有語意近似；不是獨立營運樣本。
同句「嗯，好喔」分別置於有效結帳問題及空訂單，刻意保留上下文對照。
涵蓋分類／別名、缺數量、未知品名、序號、修改／取消、隔句人數、55秒 idle、
複合要求、未完成 ASR、背景話語與已移除的客製選項。
標註由單一作者建立，沒有多人盲審；不能用這批挑模型、調門檻或宣稱泛化可靠。

凍結的 frozen／SetFit checkpoint 與第一階段 validation temperature 直接重用，
沒有訓練、重新校準或加入錯句。40句兩者均29/40分類符合標註，warm平均分別
8.24／8.52ms。分類分數不代表 target／domain operation 正確。

實際 finite Jev 使用既有程式預設 policy（沒有讀取或更改線上保存設定），回報
`openjev/Qwen/Qwen3.5-4B`。40句全數有回應，0 provider failure，共55次HTTP：
40次route、9次filter、6次具體question-answer relation，沒有逐句經 Main Agent。
每次 route 平均4453.86ms；後續filter約2.15秒、relation約2.36秒。因此本批
完整語意判斷平均5291.76ms，P50 5020.28ms、P95 7649.90ms。
不是第一階段八類單句分類的1682ms；任務、prompt、回合數及遠端負載都不同。

回放發現 `r23` 的 fixture 錯誤：兩次相同水餃被現有 cart 合併成一筆quantity2，
並未建立預期的多筆同名歧義。**沒有改標籤、改 runtime 或重跑到成功**。
原40句輸入、預測、回放、摘要完整保留；另產生排除此例的39句domain audit。
不把這個測試預期錯誤算成正式程式誤刪。後續多筆歧義驗證仍需合法的不同cart
line fixture；本階段沒有聲稱已完成該項。

39句中19句符合預先定義的效果／slot／resolution期待；12句安全停下或待支援。
這是 challenge-set **effect contract match**，不是顧客需求完成率或正式Kiosk
準確率。兩例走入錯誤draft／clarification phase：`r10` 查看牛肉麵卻建立新增
數量問題、`r32` 價格查詢加訂水餃卻被縮成單一ADD後詢問兩品项是哪一個。
這兩例没有把餐點加入購物車；報告的phase／preparation錯誤不等同誤扣款。
`r16` 在合成菜單成分未知時，Jev選NEEDS_ASSISTANT是合理的安全退回，不能只因
它不符合預標的SEARCH_MENU就認定模型錯誤；初始effect期待不足的限制保留說明。

### 沿用既有 resolver／guard 的實證

透過 `apps/order-menu/src/resolverPoc.test.ts` 使用真正的
`createMenuToolRuntime`、`decideInteraction`、domain resolution及authorization：

- 「一位」在 query＋55秒 idle 後可解析party-size，購物車不變；
  新口語「總共一個人而已」仍保留party-size問題，但缺人數候選，最後INCOMPLETE。
  根因是既有slot parser不支援「一個人」形式，不是waitingFor遺失。
- 沒數量的明確新增進CONFIGURATION，不自行新增；分類有多品項則CLARIFICATION，
  不任意挑第一道。自訂選項為空時，選到SET_OPTION仍安全退回，不刪除該決策路徑。
- cart revision變更後拒絕旧ticket，未回答需求仍保留。合法信用卡選擇仍需獨立
  一次性confirmation，測試中付款嘗試0次。
- 另以**刻意錯選意圖的診斷測試**證實：「水餃一份多少錢呢」若被選ADD，品項和
  數量都合法，guard會EXECUTE並在隔離cart加一份。「水餃來兩份，再幫我結帳」
  若只選ADD，也會加兩份卻未結帳。這不是本批live回應實際發生的誤加結果，
  而是說明guard能驗證domain合法性，不能替代semantic effect及整句需求覆蓋。

### 唯讀旁路假設的結果與反例

實驗只讓高信心QUERY＋真實精確品名／分類＋唯一search效果＋ordering phase＋
沒有已識別的有限食材／飲食／未知條件reference，直接進既有resolver。
其他都退回原finite Jev；contextual先標記需要reference semantics，**沒有假裝
建立了可獨立解析的Reference Resolver**。CHAT／NOISE也不直接丟棄。
任何門檻下，修改、取消、點餐及付款的模型旁路都為0。

以下分母39，唯讀接受案例實際執行，fallback重用本次對應Jev的真實結果／時間：

| 模型 | 門檻 | 唯讀旁路 | Jev fallback（含 contextual） | 投影平均ms |
| --- | ---: | ---: | ---: | ---: |
| Frozen | 0.70 | 2 | 37 | 5044.67 |
| Frozen | 0.80 | 1 | 38 | 5184.20 |
| Frozen | 0.90／0.95 | 0 | 39 | 5315.91 |
| SetFit | 0.70 | 3 | 36 | 4852.05 |
| SetFit | 0.80 | 2 | 37 | 5044.96 |
| SetFit | 0.90／0.95 | 0 | 39 | 5316.21 |

所有唯讀旁路都沒有cart／phase／人數寫入，但**不能當成需求處理成功**。
關鍵反例 `r16`：「水餃裡面會加花生嗎」兩模型QUERY信心0.8215／0.8498，
不在既有有限食材／未知條件詞彙中，於0.70／0.80都通過旁路，最後只回
「我找到：水餃。」菜單沒有成分資料，也沒有回答花生問題。
effect match20/39的投影增加僅來自這個不完整回答，**不是有效品質改善**。
不能藉提高0.80門檻解決，也不能據此聲稱Main Agent使用率降低。

因此**拒絕採用這個唯讀eligibility規則**；沒有看結果再加「花生」特判。
`没有識別到食材條件`不能推論`本句没有食材資訊需求`，這是共通的需求覆蓋問題。
混合latency只是把實測encoder時間與matched fallback時間相加的投影，不是
第二次真實hybrid運行，未含ASR、UI、IPC、TTS、模型冷載入及Main Agent。

### 下一個合理的獨立驗證範圍

先定義Domain Resolver需要的**具體效果＋資訊問題範圍＋整句需求覆蓋證據**：
只辨識商品不等於理解動作；沒有未知詞命中不等於需求已完整解析。
無法完整處理時仍退回finite semantic選擇或clarification，不能猜target、
預設新增、忽略第二個需求或把查詢當成已回答。保留八類Turn Classifier的責任，
不要把target與操作授權塞回classifier，也不要再疊一套正式點餐狀態機。
若後續實作此介面，應先shadow／新的獨立fixture驗證，尚未授權整合正式路由。

### 證據與驗證

- [新場景預測](./results/resolverPredictions.json)、[完整回放](./results/resolverReplay.json)、
  [原40句摘要](./results/resolverSummary.json)、[39句fixture audit](./results/resolverAudit.json)。
- 真實provider回放135個測試通過（包含40句量測）；這代表runner／隔離契約通過，
  **不是40句語意判斷全對**。後續離線新增兩個反例檢查，連同既有question／seating／
  intent測試161個通過，40個live量測guarded skipped。
- Menu package typecheck、兩個新增TS檔案ESLint、Python語法／摘要CLI及資料指紋檢查通過。
  未跑root typecheck；未重啟服務、修改保存設定、匯出客戶資料或提交commit。
- Date僅用於確定性idle／revision測試，HTTP及performance時計不fake；
  沒量正式UI操作／session持久化／真實provider長延遲造成的ticket到期競爭。

## 第三階段：具體操作效果＋整句需求覆蓋（2026-10-07）

結論：**不採用額外同模型覆蓋檢查作正式放行關卡。** 在32個固定假設中，
檢查仍誤放行9個不完整或不相符效果；其中4個信心超過.95。平均額外HTTP時間
5269.8ms，不能為這個成本提供可靠語意保障。正式Kiosk沒有修改或整合。

### 實驗邊界與可重現資料

[32個合成假設](./effectCoverageScenarios.json)在推論前固定，SHA256
`55f87340793c6ba4a76aa60c8c60a55c5ac885ecc918112042e22aa7f2ea3b76`。
同一句話刻意搭配不同候選：用來測review能否分辨正確／錯誤效果，不是32個
獨立營運對話，也不是前段模型自然產生的錯誤分布。標註由單一作者建立，
沒有營運樣本、跨作者一致性或獨立標註者複核。Gold只供離線評估，不傳provider。

Classifier完全不參與本階段，不改八類分類、checkpoint、calibration或正式
prompt。Application沿用真正的`resolveIntent`、`compileOperationPlan`、
`authorize`，先判斷候選存在與domain結構是否合法；只有可形成PLAN、
CONFIGURATION或CLARIFICATION的假設才發覆蓋檢查。

隔離模組位於`apps/order-menu/src/experiments/effectCoveragePoc.ts`，正式app
不import它。Reviewer只回六個有限結果：`COVERED`、`WRONG_EFFECT`、
`MULTIPLE_REQUESTS`、`UNSUPPORTED_REQUEST`、`UNRESOLVED_REFERENCE`、
`UNCERTAIN`；這些不是新增classifier類別、顧客選項或WebMCP工具。
Provider不能產生商品、數量、slot或授權；它看到完整本句、已提出的application
resolution、角色對話、有效問題、真實狀態與有限菜單能力。

合成菜單有5個商品，提供名稱／分類／價格／可售狀態；composition是明確的
unknown，客製化為空。沒有成分詞命中不當作需求已完整解析。缺少數量可以
合法進configuration，target不唯一可以合法clarification，但不得忽略另一個
獨立要求。一次menu lookup可回答同商品存在與價格，不把所有連接詞都當多操作。

`COVERED`且confidence≥.60只標記`CHECKED_HYPOTHESIS`，不是execution ticket。
門檻在推論前固定，不從本批結果選最佳threshold；沒有看結果改資料或prompt重跑。
實驗無WebMCP執行、POS寫入、付款或實際訂單；人工問題fixture不等於UI已呈現
的receipt，也不是session閒置持久化測試。

### 實測結果

模型`openjev/Qwen/Qwen3.5-4B`，29次實際HTTP，0provider failure；3個由
Application preflight先退回，不呼叫模型。32個測試全部沒有cart變更。

| 指標 | 結果 | 解讀 |
| --- | ---: | --- |
| 應支持假設 | 14 | Gold為COVERED |
| 正確保留 | 13/14（92.86%） | 有1個合法查看被錯攔 |
| 不應放行假設 | 18 | 錯誤效果、複合未覆蓋、未知資訊等 |
| 正確退回 | 9/18（50%） | 含3個Application preflight |
| 語意檢查誤放行 | 9/15 | 分母只計通過preflight的錯誤假設 |
| 原始review結果符合Gold | 18/29（62.07%） | 不含未呼叫模型的3個 |

只有domain合法性檢查時，15個刻意錯誤假設仍具備可規劃結構；增加review後
其中6個退回、9個仍誤放行。這是同批注入假設的對照，**不能解讀為正式系統
原有15/32錯誤或改善6/32的營運準確率**。也沒有量上游選操作或Main Agent頻率。

#### 最重要的同句反例

| 本句 | 提供的效果 | Gold | 實測結果／信心 |
| --- | --- | --- | --- |
| 水餃一份賣多少呢 | 查菜單（c01） | 完整 | 完整／.9793 |
| 同上 | 新增（c02） | 錯誤效果 | **完整／.9679** |
| 請讓我看一下排骨便當 | 查看（c03） | 完整 | 錯誤效果／.4632 |
| 同上 | 新增（c04） | 錯誤效果 | **完整／.8792** |
| 排骨便當給我來三份喔 | 新增（c05） | 完整 | 完整／.9958 |
| 同上 | 查菜單（c06） | 錯誤效果 | **完整／.9387** |
| 先點一份水餃再幫我結帳 | 只新增（c07） | 多個要求未覆蓋 | **完整／.9607** |
| 同上 | 只進結帳（c08） | 多個要求未覆蓋 | **完整／.9783** |

這些結果與「提供的操作假設可能影響review」相符，但模型內部原因屬推論，
不是已證實的機制。重點是它無法可靠辨別互斥效果，也會認可只完成半句的操作。

完整誤放行ID：`c02,c04,c06,c07,c08,c09,c20,c22,c31`。另包含查價格＋訂另一項
只接受ADD（c09）、修改份數卻接受ADD（c20，.9824）、修改份數＋人數只接受
其中一項（c22）、有展示序號但reference尚未正確解開仍接受未解決的clarification
（c31）。實際未執行這些plan，不能說本實驗誤加餐點或扣款。

四個unknown成分／醬料／辣度／熱量問題（c10–c13）全判
`UNSUPPORTED_REQUEST`。這支持明示資料能力在這四例有用，不證明全面泛化。
單獨回答人數、合法缺數量configuration與target ambiguity部分可保留；仍
不足以支持整層採用。即使改成.95，本批c02/c07/c08/c20仍會錯放；本次沒有
据此挑選新threshold或調整模型。

### 額外耗時與安全契約

| 量測範圍 | 平均 | P50 | P95 |
| --- | ---: | ---: | ---: |
| 29次額外review HTTP | 5269.8ms | 5379.1ms | 6848.4ms |
| 32個advisory probe（含3次快速preflight） | 4775.9ms | 5235.4ms | 6830.2ms |

沒有前段effect決策、ASR、UI、工具執行、TTS、Main Agent或模型冷載入；不是
端到端Kiosk latency，也不是與前兩階段相同任務的公平latency比賽。這29次
HTTP是額外成本，不會取代已發生的前段決策。没有測model residency／memory。

離線契約驗證：不接受違法choice／非數值confidence；低信心或provider failure
退回；provider額外附帶的target／quantity不寫進plan。等待review期間cart改變，
即使review通過，重新authorization仍拒絕舊revision。付款效果review通過仍須
獨立confirmation，沒有付款ID或執行權。這些測試保住責任分界，**不代表
review的高信心結果可靠**。

### 下一步判斷

此次否決的是「把具體假設交給同一4B再背書，作放行关卡」這種實作，並非否決
classifier／resolver分層。若要再做独立驗證，可先不提供candidate，獨立提取
本句需求／資訊範圍／reference／多需求，再與application效果及資料能力對照；
提取結果同樣不是target或執行授權。仍需新資料實測，不能宣稱一定有效、僅靠
換prompt便改善，也不應擴成第二套訂單狀態機。尚未整合或開始這個後續實驗。

### 證據與限定範圍驗證

- [逐個實測回放](./results/effectCoverageReplay.json)、
  [摘要／逐個判讀](./results/effectCoverageSummary.json)、
  [重現指令](./README.md)。Artifacts拒絕覆寫；29HTTP僅傳新的人工資料。
- Live runner79tests通過代表runner／無寫入契約成立，不是79句語意全對。
  最終離線47passed、32live guarded skipped；Menu package typecheck與三個
  新TS檔案ESLint通過，Python摘要完整性／語法與scenario指紋檢查通過。
- 沒有正式依賴／route／prompt／threshold／設定變更、服務重啟或commit。
  沒跑root/full-project typecheck；沒有匯出客戶紀錄。

## 第四階段：先盲解析需求，再比對效果（2026-10-07）

結論：**不採用這個五題獨立拆解實作。** 此次26句拆解全部因欄位互相矛盾
退回，完整profile符合0/26、可用覆蓋0。沒有錯誤放行是因為全部退回，
不是能更可靠處理訂購。正式流程完全未改；沒有工具、訂單或付款執行。

### 隔離設計與比較問題

問題是：不先暴露操作候選，能否先辨識整句需求，再核對Application的效果？
新[固定資料](./requirementScenarios.json)有26句及32個刻意注入的假設，SHA256
`9e978fbb139cc89f75c40ad161a8ef89498b0456bb4406df6f1e1488b8c15689`。
24句是新措辭；`n13`「我想吃麵，一碗」、`n16`「一位」是已討論的已知回歸，
單獨標記，不當作未見樣本。資料同樣由單一作者合成與標註，沒有營運分布或
跨作者複核。Gold、候選、plan、slots、商品ID及菜單都不進盲解析request。

`apps/order-menu/src/experiments/requirementPoc.ts`只接受本句、近期角色對話及
目前問題文字，與Turn Classifier分開。它讓4B分別選五個有限欄位：

- 第一需求效果、第二需求效果：QUERY、ADD、MODIFY_QUANTITY等有限語意，
  不產生target、數量或工具；沒有第二需求應選NONE。
- 需求數量：ONE／TWO／MORE_THAN_TWO等。最多表示兩個需求；超量明確退回，
  不截斷成單一操作。同類效果也可能是兩個獨立要求。
- 資訊範圍：菜單事實、成分／口味、營養、其他／混合或沒有資訊問題。
- Reference依賴：本句明示或需要前文／畫面／待答問題，不解析其對象。

每句只盲解析一次，再重用同一個結果核對所有假設。程式僅比較單一、明示、
資訊能力足夠的效果，沿用真正的resolver/compiler/guard；多需求、contextual、
未知資訊、矛盾、低信心全部退回。合法缺數量可configuration，分類多品項可
clarification，但這仍不是完成回答、執行權或商品已唯一解析的證據。

Baseline是在同一批新fixture上呼叫**未修改的上一版**`inspectEffect`，每個
假設各一次；它的結果不回填盲解析。這是不同方案辨別注入假設的比較，沒有
測classifier、前段effect選擇、完整Reference Resolver或Main Agent頻率。
固定.60門檻，以五個confidence的最小值作保守門檻，**不是校準過的聯合概率**。
不因錯誤而調資料、prompt、門檻或去重；測完停止，沒有再試其他設計。

### 4B真實結果

模型`openjev/Qwen/Qwen3.5-4B`，57次HTTP：26次盲解析、31次baseline；
1個baseline假設由domain preflight退回。0provider failure，沒有cart變更。

| 原始欄位符合標註 | 正確／26 | 比例 |
| --- | ---: | ---: |
| 第一需求 | 20 | 76.92% |
| 第二需求 | 2 | 7.69% |
| 需求數量 | 18 | 69.23% |
| 資訊範圍 | 24 | 92.31% |
| Reference依賴 | 19 | 73.08% |
| 整個profile | 0 | 0% |

只算24句新措辭，完整profile也為0/24。上述是原始choice與預先標註的對照，
不是信心門檻通過率或正式營運準確率。資訊欄較好，不能抵銷其他欄漏需求。

24/26句第一、第二欄填同一個效果；第二欄沒有一次選NONE。五句多需求
（n04/n05/n07/n22/n24）的count全部是ONE。因此26句都命中INCONSISTENT，
不是只因.60門檻太高；降低門檻也不能讓互相矛盾的結果變完整。

| 同批假設比較 | 舊版candidate review | 盲解析＋比對 |
| --- | ---: | ---: |
| 支持假設保留／13 | 12 | 0 |
| 明示支持假設保留／12 | 11 | 0 |
| 不支持假設誤放行／19 | 9 | 0 |
| Contextual假設被直接認可 | 1 | 0 |
| 總checked hypothesis | 21 | 0 |

「一位」是合法contextual回答，按盲解析分流規則應轉Reference Resolver，
不列為明示需求的誤攔。舊版對其effect認可不等於誤授權；兩者對contextual
本來就有不同責任，不能單看checked數字稱新方案安全提升。
其餘12個明示且支持的假設也全部退回，實際可用性沒有成立。

Baseline誤放行ID：`n01:add-item,n03:search-menu,n04:add-item,n04:start-checkout,
n06:add-item,n07:set-quantity,n22:add-item,n24:add-item,n25:search-menu`。
這是注入的假設，不是正式前段模型自然產生的錯誤率。

### 代表性失敗與不能採用的補救

- 「水餃一份要付幾塊錢啊」：first=QUERY、second=QUERY、count=ONE。
  第一效果對，但第二需求多填，整句契約不成立。Baseline仍把查詢與新增
  都認可，重現上一批互斥假設可同時得到認可的問題。
- 「水餃再來一份，接著結帳吧」：first=CHECKOUT、second=CHECKOUT、count=ONE。
  不只重複欄位，新增需求也漏掉了。
- 「水餃一份，再點紅茶兩杯」：first=ADD、second=ADD本來合理，但count=ONE錯。
  不能把相同效果自動去重，否則會吞掉第二項新增。
- 「我想吃麵，一碗」：first=ADD正確（confidence.7276），但second也填ADD，
  整體退回。不是正式點麵邏輯回歸；正式路由未改。
- 「一位」：有保留的「幾位用餐」問題文字，reference=CONTEXTUAL正確，
  first卻填REFERENCE、second=ADD。這次不是waitingFor或session資料清除。

因此不能將second重複值直接改成NONE、降低信心門檻或沿用第一效果硬執行。
这些補救會掩蓋多需求漏判，無法回答「整句是否完整」的共同契約。

### 介面核對與歸因限制

公開[lookski server.py](https://github.com/lookski/openjev/blob/main/openjev/server.py)
接受state、questions與各題instructions／criteria；AIRI本次request符合這個
wire形狀。[core.py](https://github.com/lookski/openjev/blob/main/openjev/core.py)
的`build_user_text`（68–93）會包含instructions與criteria；`system_one`
（237–252）則逐題對相同state呼叫，不把前題答案寫入後題。
這說明「同request多個choice」不自動具有跨欄位一致性或共同提取結果。

此處核對的是2026-10-07讀到的公開main參考實作，**沒有讀到實際部署commit、
backend或其改動**。不能斷言上游忽略instructions，也不能單靠結果把全部
失敗歸咎4B大小。有限詞彙、題目措辭、獨立判斷及模型能力共同影響結果，
本次沒有把它們分別ablation。否決的是本實作，不是所有先解析需求的架構。

### 實際耗時與是否繼續採用

| HTTP量測 | 次數 | 平均 | P50 | P95 |
| --- | ---: | ---: | ---: | ---: |
| 五題盲解析 | 26 | 4180.8ms | 4222.3ms | 4531.8ms |
| 同批上一版review | 31 | 2494.2ms | 2820.3ms | 3292.2ms |

盲解析也沒有比同批review快。不能和上一批review的5269.8ms直接比較，因為
措辭、prompt內容、遠端負載與cache狀況可能不同。沒有量ASR、UI、工具、TTS、
Main Agent或完整流程，沒有量此階段cold-start／model memory／forward數；
沒有將provider的累積usage當單句成本。都不是正式營運latency或信心校準證明。

本階段到此停止，不加正式關卡、不增加顧客選項、不重訓classifier或改模型。
若未來續作，需要重新選定並獨立驗證需求解析interface，不能直接宣布提高
門檻或更多同模型decision rounds會改善。仍維持classifier不負責target、slot、
完整domain plan或操作授權的責任分界。

### 證據與驗證

- [完整逐句／逐假設回放](./results/requirementReplay.json)、
  [摘要與欄位confusion](./results/requirementSummary.json)、[重現指令](./README.md)。
  Fingerprint、26句／32假設完整性、zero writes及摘要Python語法驗證通過。
- 離線40passed／26live guarded skipped；live66tests通過只表示runner與隔離
  契約通過，**不是66個語意判斷全對**。Menu package typecheck與三個新TS檔案
  scoped ESLint通過；曾發現runner空陣列的never型別並修正，沒有修改模型邏輯。
- 沒有新依賴、設定寫入、正式route／prompt／threshold變更、服務重啟或commit；
  未跑root/full-project typecheck。對外只送人工測試資料，沒有客戶紀錄。

## 正式決策程式＋小候選分層對照（2026-10-08）

結論：**不採用本次分層方案。** 它改善部分背景話語與耗時，但把大量常見
服務需求改成拒絕，仍高信心漏掉複合需求。這不是加入更多Jev回合即可改善的
證據，也不是所有分層架構不適合；否決的是此7分類＋有限leaf＋0.60政策。

### 測試範圍與公平性

- 44句新人工語句、11類情境、每句A/B共88筆，完成129次HTTP，零transport
  failure。上游實際回傳`openjev/Qwen/Qwen3.5-4B`，未切模型或重試。
- Baseline使用現有`decideInteraction`與程式內預設prompt；不是附件當時的
  自訂System One提示，也沒讀取或修改店家已保存的policy。
- 分層只替換ordinary route：先READ／CHANGE／ANSWER／ASSISTANCE／BACKGROUND／
  UNFINISHED／UNCERTAIN，再從application-issued候選挑leaf。不是需求抽取，
  不生成target、slots或plan，不做第二個同模型review。
- 兩邊使用等價但全新的人工Menu runtime，實際跑target resolver、compiler、
  guard與in-memory operation。逐句交錯A/B順序；五項模擬菜單有別名、單項
  麵食分類，沒有客製選項，成分未知。沒有使用或傳送客戶附件。
- 分層gate與leaf固定0.60，baseline維持既有不對稱政策。候選組織、提示與
  門檻同時不同，因此是整體policy比較，不能把差異單獨歸因候選數量。
- 每句各量一次，沒有在結果出現後改prompt、門檻、gold或人工變體。短句和
  複合句的gold預先固定；沒有訓練、挑最佳threshold或獨立營運test set。

### 原始分流／slots契約結果

| 指標 | 現行baseline | 分層方案 |
| --- | ---: | ---: |
| 符合預期分流與指定參數／44 | 17 | 13 |
| UNAVAILABLE拒絕判斷／44 | 8 | 28 |
| 有效服務需求符合契約／36 | 12 | 8 |
| 有效服務本地符合操作契約／36，不含交接 | 12 | 7 |
| 漏單核對正確交接／4 | 0 | 0 |
| 複合／替換正確交接／4 | 0 | 0 |
| 背景／已完成資訊附和正確忽略／4 | 2 | 4 |
| 真正未完成話語正確等待／4 | 3 | 1 |

17／13包含忽略、等待或正確交接，不是完整訂單成功數。服務36句排除四句
背景與四句未完成話語；正確交接不表示Main Agent已處理。本地「契約符合」
也只確認操作／slots，不代表ASR、實際畫面或每個資料問題已完整回答。

| 類型，每類4句 | Baseline契約符合 | 分層契約符合 |
| --- | ---: | ---: |
| 分類瀏覽 | 2 | 2 |
| 商品販售查詢 | 0 | 0 |
| 單品新增 | 2 | 1 |
| 漏單核對 | 0 | 0 |
| 用餐方式 | 2 | 2 |
| 內用人數 | 3 | 1 |
| 結帳同意／拒絕 | 2 | 1 |
| 多品項／替換 | 0 | 0 |
| 價格／未知食材／客製／素別 | 1 | 1 |
| 背景與已完成資訊附和 | 2 | 4 |
| 未完成語句 | 3 | 1 |

### 實際receipt核對：不能把階段變更算成購物車新增

原始evaluator的`wrongMutation`把cart、人數或phase變更合計，原始5比2
**不是5比2次錯誤購物車修改**。`wrongPreparation`漏了pendingClarification，
卻包含一般pendingCustomerChoice；這些原始counter保留，另存receipt audit，
不重新標註或覆寫原始結果。

- 真正未完整滿足需求的購物車變更：baseline2次（p31／p32），分層1次（p31）。
  p31是刪舊餐卻沒有補新餐；刪除本身是客戶要求，但**替換整句未完成**。
  p32只加水餃，略過不存在的乾炒意麵與其條件。
- 錯誤準備／單品釐清：baseline3次（p07／p29／p30），分層1次（p29）。
  p29／p30沒有新增購物車，而是把兩項要求問成單品二選一。
- 複合句落入單一Fast Action：baseline4次，分層2次；分層並非都安全交接。
- 完整服務句被當成INCOMPLETE：baseline10次，分層0次，但後者28次拒絕，
  不能把不再等待視為成功恢復。原始silentDrop=11包含p40已完成資訊附和。
- 原始backgroundAdmission=1是p40被當INCOMPLETE，不是Main Agent入場。
  未測完整UI，不宣稱背景話語顯示問題已修好。

### 常見句反例與信心

- p02「想找個便當吃」：baseline INCOMPLETE .7332；分層CHANGE .3984而拒絕。
- p03「先看看你們的麵好了」：baseline INCOMPLETE .8742；分層雖選READ，
  leaf改選低信心NEEDS_ASSISTANT而拒絕。分類證據與查詢候選均在。
- p06「水餃有在賣吧」：baseline INCOMPLETE；分層READ .4594而拒絕。
- p29「牛肉麵兩碗，水餃再一份」：分層CHANGE .911，ADD .8309；實際進入
  二選一釐清，不處理兩項。不是只有低信心問題。
- p31「排骨便當撤掉，換牛肉麵一碗」：分層CHANGE .9103，REMOVE .7478；
  domain授權成功刪舊餐，但沒有新增牛肉麵。合法operation不代表整句完整。
- p24「總共一個人而已」：待答人數問題存在，但原slot parser沒有提供人數
  候選。不能靠prompt補不存在的候選，這是另外的程式能力缺口。
- p07「能不能看看紅茶」可合理視為SEARCH或SELECT。Frozen gold維持SEARCH，
  不作事後重標；baseline卻走ADD並問份數，兩種閱讀下皆錯。分層拒絕仍不是
  查詢成功；此語意歧義不左右兩方案錯誤新增路徑的觀察。

### 隔離決策wall time

| 模式 | HTTP次數 | 有限question數 | 平均 | P50 | P95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 57 | 62 | 5724.3ms | 5654.1ms | 7552.4ms |
| 分層 | 72 | 76 | 2535.1ms | 1943.0ms | 4467.9ms |

分層多呼叫卻較快，可能和較短prompt／較小候選及上游負載有關；未分別ablation
或重複測量，不能說已確認原因。很多分層句第一層就拒絕，不進leaf／domain，
所以平均較快也不是等價成功處理的加速。量測包含決策HTTP，不含ASR、UI、
TTS、Main Agent、冷啟動或模型記憶體。沒有把provider累積usage當單句成本。

### 判斷與下一個實作切點

小候選沒有令此4B流程可靠識別完整常見需求；更高信心也不能證明完整。
不加入此gate、不增加正式決策回合、不繼續逐句補例外，也不降低門檻硬執行。
現有Guard確認的是單一操作合法性，仍需要把整句多項需求與逐項完成狀態
作為獨立的程式契約，不能讓尚未完成的要求變成默默成功或二選一。

若續作模型對照，應測**正式Main Agent提示＋實際隔離工具流程**，而不是把
先前Gemma需求抽取18/40當替換成績；或另定義並驗證更適合的有限語意adapter。
本次沒有測或替換Main Agent，也未證明只換模型即可修好程式能力缺口。

### 證據、隔離限制與驗證

- [逐句完整request／response](./results/partition-frozen44.jsonl)、
  [原始summary](./results/partition-frozen44Summary.json)、
  [receipt audit](./results/partition-frozen44Audit.json)、[重現指令](./README.md)。
- Test-only implementation在`apps/order-menu/src/experiments/partitionDecision.ts`，
  frozen cases在`partitionScenarios.ts`，runner在`partitionReplay.test.ts`。
  Dataset、baseline程式與partition程式hash在metadata。
- 這是使用真實程式的隔離challenge，不是正式客戶流量準確率。Fixture未提供
  真實UI surface，screen=unknown；沒有merchant saved prompt、ASR/FIFO、
  idle/session生命周期、對話顯示、Main Agent工具loop或支付/POS。
- 六個offline controls通過；live runner7tests通過表示記錄與隔離契約成立，
  **不是44句兩個模型方案都回答正確**。四個新TS檔scoped lint通過。
  沒跑root/full-project typecheck，沒有正式flow/prompt/model/settings變更、
  服務重啟、新依賴或commit。

## Gemma 提案／正式提示組裝＋隔離工具對照（2026-10-08，部分完成）

**尚不能判定架構或模型優劣；未採用到正式流程。** 已建立16句固定人工案例、
三種模式共48個預定turn。實際留下9個完成記錄、2個中斷中的助手turn；只有
a01、a02具有完整三模式配對。最重要的複合、替換、隔句人數、漏點補救尚未
量測。不能把這個簡單前綴當成完整benchmark，也不能報成16句準確率。

### 測量的三條路徑

- `jev-front`：真正的`decideInteraction`、code-default提示、候選及隔離Menu
  執行。沒有量測它交給正式Main Agent後的完成率；handoff不算完成。
- `proposal`：沿用先前需求提案prompt/schema，不給商品ID、gold或菜單；本地
  嚴格schema／原文跨度驗證，再透過實驗性精確品名／別名binding、現有context
  候選或Menu的`invokeForAgent` guard。不支援条件擋住整批寫入，不猜新商品。
  這不是完整的語意覆蓋驗證器、交易式替換或正式Reference Resolver。
- `tool-agent`：以真正的`createKioskRoutes`組裝Main Agent提示及工具history，
  使用scratch PGlite的人工development profile和真實Menu工具定義／guard，
  上限4次模型回合。不複製另一份「類似正式」prompt，也不新增正式工具。

測試Gemma明確指定`models/gemma-4-26b-a4b-it`。實測時現行`webnavior/chat`
已改成`amdllm.iservmeta.net`的`gemma4-31b`；因此只讀既有「google api」
26B profile作為測試credential，不套用選擇、不改正式模型。Jev回覆記錄的模型
為`openjev/Qwen/Qwen3.5-4B`。Profile、密鑰、正式session／客戶紀錄未傳出；
只有新人工語句、對話、狀態與工具結果送到原先同意的Google／OpenJev端點。

### 已觀察到的結果

| 人工句子 | Jev前段 | Gemma提案＋程式 | Gemma工具助手 |
| --- | --- | --- | --- |
| 我想吃麵 | 顯示牛肉麵、不新增 | 保留麵食分類，推薦牛肉麵、不新增 | 查到牛肉麵、不新增 |
| 我想吃麵，一碗 | UNAVAILABLE，未新增 | 實際加入牛肉麵1碗 | 只查詢，再問是否要點，未新增 |
| 有牛肉麵嗎？ | 正確查詢、未新增 | 正確查詢、未新增 | 回了正確menu_get呼叫，但路由500中斷 |
| 排骨便當來一份 | 未測 | 實際加入排骨便當1份 | 查詢後提出order_add_item；後續連線逾時，流程未完成 |

a01提案選`RECOMMEND`，但Application的真實分類證據保留了麵食scope，沒有
推薦其他類別。a02提案包含ADD／麵／quantity1，真實context resolver解析唯一
分類品項後加入；它另把「一碗」填成summaryCount1，不符合提案對「總共幾樣」
的約定。**購物車結果正確，不代表所有提案字段都正確。**

工具助手a01的原始answer包含`<thought>`英文推理段，工具calling回覆也有此
內容。這是Provider／實際Server envelope的可觀察結果，不是已證實顧客UI
洩漏；正式host仍可能採用canonical receipt，本次未測UI呈現。

### 中斷與缺失資料

1. `gemma16-first`未能連本機Redis，0模型請求；`gemma16-network`發現active
   upstream非Google而停止，0模型請求。兩個啟動失敗檔案均保留。
2. `gemma16-profile`有8個完成turn；a03工具助手的Google生成HTTP200，內容
   是合法menu_get，但scratch route回500。重播保存的3個人工首輪工具回覆到
   真正路由均200，未重現。原run未記cause，原因**未確定**，不可當模型誤判，
   也不可倒推就是下一批的網路故障。
3. 只接續從a04開始的**未測**案例，保留同一資料／gold／prompt，不重送a01–a03。
   `gemma16-rest`完成a04提案；a04助手已回menu_get及order_add_item呼叫，
   下一次Google生成連線逾時（Undici connect timeout10s）而停止，沒有重試。
4. 中斷時fixture購物車及tool receipt原先只在turn結束寫入，故a04失敗助手的
   原始最終cart **沒有保存**。不能由模型發出add呼叫就聲稱已加入成功，也不能
   因沒有observation row就聲稱沒有變更。該turn永遠保持未完成／execution
   evidence缺失，不用離線模擬重算成當次成功。

停止後僅修正**實驗記錄器**：立即保存每個tool execution，停止時另保存failed
turn的before／after／receipts；已完成寫入不得因記錄失敗改標成domain失敗。
另修正實驗binder的unresolved／summary preflight，避免單一context分支先執行
再做整句檢查。這些只供未來run使用，未重跑或改寫前面的frozen分數與raw檔。
原始source hashes均保留，可區分記錄器修訂。

### 流量與時間

Google11個成功生成回覆，另1次生成connect timeout；有12次token preflight。
Jev4個HTTP。成功Google回覆的usage字段共40,161 prompt tokens、551
completion tokens（不是包含所有thinking／失敗請求的完整計費估計）；
成功生成HTTP時間合計34.31s，preflight合計11.05s，已記錄quota wait267.10s。
失敗請求的全部等待／token費用未完整記錄，不能把上述當整個run總耗時／費用。

成功Google生成平均3.12s／次，不是完整助手turn latency。a01助手2次生成約
6.03s，但含配額等待的wall63.87s；a02助手約4.94s生成，wall112.58s。
TPM而非本地程式CPU是這個**刻意保守序列實驗**的重要throughput限制；不能
把quota等待當模型推論，也不能將忽略等待的時間說成此配額下實際端到端速度。

使用24RPM、12.8K reserved tokens/minute、每run11,520request cap，保留20%
headroom；失敗請求保留reservation，序列執行。以native countTokens計算完整
OpenAI envelope的序列化文字，加512轉換headroom及1536輸出reservation；
actual prompt usage另檢查低估。這是保守proxy，不是native工具token等價或
project-global／persistent RPD ledger；未知共用流量／每日餘額仍可能限流。
官方參考：[token計數](https://ai.google.dev/gemini-api/docs/tokens)、
[OpenAI相容工具呼叫](https://ai.google.dev/gemini-api/docs/openai)。

### 證據、驗證與下一步

- [首批raw](./results/assistant-gemma16-profile.jsonl)、
  [首批summary](./results/assistant-gemma16-profileSummary.json)、
  [未測案例接續raw](./results/assistant-gemma16-rest.jsonl)、
  [接續summary](./results/assistant-gemma16-restSummary.json)。
- [執行與離線摘要指令](./README.md)。程式位於`apps/server/tests/experiments/`
  的`assistantComparison.test.ts`、`assistantFixture.ts`、`assistantProvider.ts`、
  `summarizeAssistant.ts`；保存回覆的離線診斷在`assistantReplay.test.ts`。
- 最終58項離線測試通過、live opt-in測試1項跳過；5個TS檔scoped lint通過。
  live completion assertions失敗是刻意保留中斷訊號，不是全部案例通過。
  未跑full-project typecheck／UI／ASR／真實POS；沒有新dependency、commit、
  服務重啟、正式prompt／model／WebMCP／deriveDecisionContext／resolveIntent改動。

目前不替換Jev，不把Gemma定為正式模型，也不由此前綴新增正式gate或逐句補丁。
若要續测，先恢復Google連線，再優先測**尚未測的複合、替換、漏點補救與隔句
人數**；保留未完成／失敗turn，不為刷分重試已測句子。只有完成這些逐項需求
與實際結果對照後，才有依據決定是否引入proposal模組或調整Main Agent契約。

## Gemma 正式提示／工具對照續測（2026-10-09）

沿用Oct8固定16句、相同gold／prompt／工具guard，只量測尚未測過的case/arm
配對；沒有重跑成功或失敗turn刷分。新增明確case順序與獨立arm選擇，避免
Google連線中斷同時阻止Jev對照。每批獨立artifact保留source hashes與selected
IDs／modes；切換Google批次前等候超過一個配額視窗，沒有並行Google生成。
這是測試控制變更，不是正式決策結構、模型、prompt或WebMCP變更。

### 已收齊的兩條路徑

合併Oct8及Oct9原始紀錄，Jev前段與提案各16個settled turn。自動契約完成
分別為6/16與9/16，結果匹配8/16與11/16；差額包含兩個只測安全拒絕的案例，
**安全拒絕不算需求完成，也不是完整正式pipeline的準確率**。Jev未續跑Main
Agent，提案使用實驗binder，不可據此宣稱Gemma普遍優於4B或提案架構可上線。

| 核心案例 | Jev前段 | Gemma提案＋實驗binder |
| --- | --- | --- |
| 麵一碗 | UNAVAILABLE，未新增 | 加入牛肉麵1；summaryCount誤填1 |
| 牛肉麵一碗＋排骨便當一個 | ADD .8661，變成兩品項擇一釐清，未新增 | 保留兩個ADD，實際各加入1 |
| 排骨便當不要了，換牛肉麵一碗 | UNAVAILABLE，舊餐點保留 | 根陣列不合schema，未執行 |
| 你沒有點到我的牛肉麵 | INCOMPLETE .3579，未補點 | ADD／quantity null；程式再問幾份，未補點 |
| 隔句「一位」 | 承接實際party-size問題，設為1位 | PARTY_SIZE1，guard執行成功 |
| 改兩份 | UNAVAILABLE，未修改 | 根陣列不合schema，未執行 |
| 還是內用好了 | UNAVAILABLE，仍自取 | 正確改內用，未修改餐點 |
| 那第二個一份 | ADD .8242，但程式列出三個候選擇一 | 根陣列不合schema，未執行 |
| 還有沒有其他推薦 | RECOMMEND_MORE，呈現水餃／紅茶 | RECOMMEND_NEXT，more=true，呈現水餃／紅茶 |
| 混合不存在品項／小辣／不要香菜／總共3樣 | UNAVAILABLE，未寫入 | 保留三項與條件，unsupported preflight擋整批 |
| 有沒有素食 | 如實表示成分資料不足，items=[] | DIET查詢，binder因未知成分擋住，未推薦假品項 |

人工receipt審核沒有發現這兩條路徑額外改用餐方式、人數或支付；Jev兩筆
ADD誤處理留下clarification準備狀態，不能稱為餐點完成。背景軟體問題Jev
UNAVAILABLE而非IGNORE，無工具；提案CHAT無寫入。這不等於已測到UI顯示
或真實背景語音准入。「我要一……呃不是」Jev INCOMPLETE；提案因空requirements
不合schema而拒絕，雖沒有變更，不能改算為正確UNFINISHED辨識。

### 失敗所在的不同邊界

- a09的真實context已提供牛肉麵與排骨便當兩個exact alias references，prompt
  也有MULTI_ACTION；4B仍選單一ADD。不是缺品名證據或上下文清空。
- a12提案看出了ADD，但沒有承接人工歷史中的「牛肉麵一碗」，quantity=null、
  contextRequired=false。實驗binder只轉現有ADD候選，再問數量；它沒有訂餐
  需求與已完成receipt的對帳帳本。**辨識ADD與安全完成漏點補救是不同能力。**
- 提案a11／a07／a15輸出root array，a14輸出空requirements；四筆HTTP200、
  finish_reason=stop，不是截斷或網路故障。嚴格schema擋住，沒有自動拆陣列、
  修JSON或重試。a11還同時提出REMOVE和REPLACE；就算修格式，也不能略過
  重複效果及替換完整性驗證。a06的contextRequired=false也不符合依待答問題
  解讀人數的語意，雖實際party guard成功。
- a10的「條件擋整批」證明預防部分寫入，並不等於向顧客完成不存在品項與
  客製化的逐項解釋／釐清。a16提案只回binder blocked，也不是已完成顧客回答。

### 工具助手與連線：保留未完成，不改算模型錯誤

a09使用真正Kiosk route prompt builder、實際工具history／guard：menu_get
查兩品項，先加入noodle1、再加入bento1，第四個模型回合確認兩項共192元。
實際購物車與回答皆保留兩項，沒有額外用餐／付款變更。它仍回出<thought>
段落；本次沒有測正式Host canonical receipt或顧客UI，不能聲稱UI洩漏已修正。
提案逐項tool receipt各自產生fulfillment問題，也不是批次UI對話品質已驗證。

接著a11助手只完成cart_get，下一次Google生成connect timeout10s，使scratch
route回500。即時記錄的failed-turn before／after皆bento1，沒有remove/add。
這次cause明確屬連線中斷，不能回填Oct8未保存cause的a03為同一原因。沒有
重試a11或重播mutation；後續只挑未量測的arm／case。Oct8a04仍保留原始
execution evidence缺失，不能由新記錄器補造當次cart。

獨立助手slice新增觀察：a12查到牛肉麵後僅問「要加入購物車嗎」，兩個模型
回合、沒有補點，雖歷史原需求已明確一碗；a06直接執行partySize1再回覆無
空桌，沒有自行改自取或訂餐。a10查到牛肉麵／排骨便當、指出炒鱔魚意麵
不存在，未寫入購物車；但把原本屬於炒鱔魚意麵的「不要香菜」錯接到牛肉麵，
並說再確認客製選項，沒有如實逐項解釋已知empty optionGroups。這是安全
沒有寫入、但條件scope與整句服務尚未完成，不能只因cart={}而當成解析成功。

a07助手透過cart_get取得實際lineId，再cart_set_line_quantity=2，第三回合
確認便當兩份；a08直接order_set_fulfillment=dine-in，第二回合確認，沒有自行
設定人數。兩筆購物車／用餐設定與需求匹配；raw回答的thought段及重複問題
不在這個cart completion分數內，正式UI去重／canonical呈現仍未驗證。

a15助手依先前展示順序查詢「炸排骨便當」，menu_get返回bento；尚未發出
新增工具，下一次Google生成回HTTP500，scratch route因gateway例外回500。
failed-turn before／after皆空cart。這是**上游HTTP500**，不同於a11的connect
timeout；Provider沒有保存error body，所以不能進一步推測上游內部原因。
該turn未完成、未重試，也不算模型把第二個選錯。

最後未測slice的a05助手執行menu_recommend(more=true)，實際呈現dumplings／tea
而非舊批；a13軟體背景問題與a14破碎句皆無工具／cart變更，但分別回覆導回
點餐與請顧客慢慢想，**不符合本實驗的靜默契約**。這是reply/admission邊界的
失配，不是它新增了錯誤餐點；沒有實際UI准入測試，不能據此報顧客UI現況。

a05還出現值得另驗證的state/prompt分界：第二次模型請求的system prompt
把本輪工具剛返回的dumplings／tea列為「已展示但尚未選擇……不可再次推薦」；
工具收據卻是在回答目前的換批需求。模型27.82s回覆的thought反覆猶豫此
限制，最後仍確認正確的新批。這個snapshot與本輪receipt／上一批的語意區分
值得檢查；沒有prompt ablation，不能斷言它就是延遲唯一原因，更不能由一筆
正確結果保證所有推薦都不會重複。正式Host可能已用canonical receipt呈現，
本實驗未測該優先序／去重行為。

a16助手使用menu_get(dietary=vegetarian)，availability=UNKNOWN、五個商品
composition未知；最後如實表示「資料不足，無法確認」，沒有推薦不存在商品，
也沒有把items=[]說成確定沒有素食。這是合適的安全回答；凍結gold把此案例
歸在safeOnly，所以不加入自動操作完成數，**不代表這筆回答錯誤**。

### 全部預定配對與時間

16句×3模式的48個配對皆各嘗試一次，44個settled observations、4個中斷助手
turn；沒有未嘗試配對，也沒有重送已完成／失敗的配對。四個中斷是Oct8 a03
路由500原因未知、a04 Google連線逾時、Oct9 a11 Google連線逾時、a15 Google
HTTP500。模型語意失配與服務故障保持分開，不能把48筆都當成有模型答案。

| 模式 | 預定／已嘗試 | Settled | 自動非safeOnly完成 | SafeOnly結果匹配 | 服務中斷 |
| --- | --- | --- | --- | --- | --- |
| Jev前段 | 16 | 16 | 6 | 2 | 0 |
| Gemma提案＋binder | 16 | 16 | 9 | 2 | 0 |
| Gemma正式提示＋工具 | 16 | 12 | 6 | 2 | 4 |

自動分數未衡量thought／回覆品質、完整Host、UI或安全回答的服務價值；人工
審核已指出a10的條件錯綁、a13／a14沒有靜默、a02提案summaryCount錯誤、a06
提案contextRequired錯誤。不能以cart匹配或schema有效就斷言整句完全理解。
所有保存的settled助手receipt沒有額外訂餐、人數、用餐方式或支付變更。
a04中斷時舊記錄器沒有保存cart，仍不能把它列為安全無變更；a03也未補造
失敗工具收據。人工資料／提案prompt及三個被記錄的正式實作source hashes
在各run一致；實驗runner／binder修訂沿用各run原始source hashes區分。

下列時間按每個settled turn加總成功模型HTTP，不含配額等待／token preflight；
wall含等待與本地流程。它們是不同完成量與配額條件下的測試值，**不能直接
當作正式部署的速度排名，也不能代表包含中斷turn的全體端到端latency**。

| 模式 | 生成平均／P50／P95（秒） | Wall平均／P50／P95（秒） |
| --- | --- | --- |
| Jev前段（16） | 5.58／5.53／7.04 | 5.58／5.53／7.05 |
| Gemma提案（16） | 3.96／3.48／7.85 | 15.95／3.87／55.43 |
| Gemma工具助手（12） | 14.19／10.76／38.38 | 106.95／112.58／190.48 |

Google共46個成功生成HTTP、3個生成失敗（2connect timeout／1HTTP500），另
有49次token preflight；Jev20個HTTP。成功生成HTTP時間合計251.99s，已記錄
quota wait1,453.09s、preflight16.59s；失敗請求wait未完整記錄，不能把這個
加總當完整run總時間。成功回覆usage共173,904 prompt／2,734 completion
tokens，不是完整thinking／失敗費用；也未測模型cold start或本地記憶體。
工具助手的多輪與大工具envelope在16K TPM下，配額等待不能從可部署latency
估計中刪掉；另一方面，a05自身生成38.38s也不能都歸因於配額等待。

### 採用結論

**不直接上線或替換Jev；也不是證明分層架構在本環境完全不適合。** 明確雙
品項、隔句人數、修改數量／用餐方式及換批推薦有可用證據；但漏點補救三路
均未完成、混合條件有scope錯綁、結構輸出有拒絕，替換助手因服務故障仍無
能力結論。Main Agent有工具能力，不等於適合每句ASR都必經；提案也尚未
證明是必要的新模組。這次沒有測Gemma替換Jev模型或正式Host整套流程。

下一步應收斂共同契約，不為上述句子新增特例或更多同模型選擇回合：每項
需求的原文／target與條件歸屬、數量或reference的可驗證來源、對應tool receipt
及完成／待釐清／不支援／失敗狀態。尤其漏點補救要對帳原先已授權需求與
實際cart，服務失敗不能自動重送mutation；新工具結果與上一批展示的優先序
也需明確。結構與程式guard只能防錯並提供安全釐清，不保證模型每句都懂。
這些尚未整合到正式流程；若續作，應先固定共通不變式及新的獨立holdout，
不要對這16句調參後再宣稱泛化改善。

### 證據與隔離範圍

- [核心首批raw](./results/assistant-gemma12-core-oct09.jsonl)及
  [summary](./results/assistant-gemma12-core-oct09Summary.json)：a09三模式、
  a11助手連線中斷，原12句計畫未整批完成。
- [Jev剩餘12句raw](./results/assistant-gemma12-jev-oct09.jsonl)及
  [summary](./results/assistant-gemma12-jev-oct09Summary.json)：所選slice完成。
- [提案剩餘11句raw](./results/assistant-gemma11-proposal-oct09.jsonl)及
  [summary](./results/assistant-gemma11-proposal-oct09Summary.json)：所選slice完成。
- [助手核心接續raw](./results/assistant-gemma10-agent-oct09.jsonl)及
  [summary](./results/assistant-gemma10-agent-oct09Summary.json)：五個settled，
  a15上游500中斷；原十句slice並未完成。
- [助手最後四句raw](./results/assistant-gemma4-agent-oct09.jsonl)及
  [summary](./results/assistant-gemma4-agent-oct09Summary.json)：所選slice完成。
- 59項離線控制／schema／真實路由重播通過，live opt-in1項跳過；新增arm
  選擇控制有正反測試，changed-file lint通過。未跑full-project typecheck。
- 未傳任何客戶attachment、修改正式profile／prompt／模型／流程、重啟服務、
  加dependency或commit。16句人工資料不能代表營運準確率；沒有UI、ASR、
  idle生命周期、真正POS／桌位／付款、替換原子性或完整Main Agent續接的驗證。
  Agent task沿用fixture當時已有的constraints，沒有重現Host每句語音開始task、
  限制解析及跨工具同步的完整生命週期；不可把這個隔離工具實驗當成正式Host
  所有guard的測試。小菜單／人工development profile也不代表真實門市配置。

## Oct9：使用者重啟服務後，四個中斷案例的獨立重試

依使用者明確要求，只重試tool-agent的a03／a04／a11／a15；每筆使用新的
人工runtime，不續跑可能已有變更的舊session。這是另列的重試觀察，**不改寫
上面48個首次嘗試的分數、四筆服務中斷或a04原先缺失的執行證據**。

沿用Google `models/gemma-4-26b-a4b-it`、正式提示建構器、工具guard及最多
四次生成回合；沒有調參或增加回合。人工dataset、提案prompt及三個記錄的
正式實作source hashes與前次一致；runner只新增`userRetry`紀錄標記。

| 案例 | 回合 | 實際結果 | 完成 |
| --- | --- | --- | --- |
| a03「有牛肉麵嗎？」 | 2 | 查到紅燒牛肉麵及人工菜單價格101；未新增訂單 | 是 |
| a04「排骨便當來一份」 | 3 | `order_add_item`收據確認排骨便當1份 | 是 |
| a11「排骨便當不要了，換成牛肉麵一碗」 | 4 | 刪除舊便當、查到牛肉麵、再讀空購物車；沒有新增牛肉麵 | 否，部分變更 |
| a15「那第二個一份」 | 3 | 正確對應先前推薦第二項，加入排骨便當1份 | 是 |

本次12個生成請求沒有500、逾時或工具錯誤，3筆完成、1筆到達回合上限。
**這不能證明重啟就是改善原因，也不能把這四筆當成營運準確率。** a11的
原始推理仍包含刪舊／查新／加入的完整計畫，但實際執行停在
`cart_get → cart_remove_item → menu_get → cart_get`，沒有`order_add_item`
或最終回答。這是本次四回合預算下的未完成，不代表更多回合必然成功或永遠
不能成功；本次沒有擴增預算。只看每個工具呼叫是否合法，仍無法保證整句
替換需求完成，且這個序列沒有原子性：舊餐已刪、新餐未加。

人工收據審核沒有額外餐點、人數、用餐方式或付款變更；a15原始最終回答
帶有英文`<thought>`，自動cart分數不衡量這件事，完整Host／顧客UI呈現仍
未測。替換需求對帳／完成狀態契約的缺口仍在，不因此整合正式流程。

生成時間每筆加總平均10.31s、P50 6.83s、P95 15.61s；配額等待共623.51s，
preflight共2.19s，整批約671s。成功usage記錄63,919 prompt／278 completion
tokens；這不是完整thinking費用。大量時間仍來自16K TPM下的大工具envelope
及多輪配額等待，不能把生成時間當端到端延遲，也不能把它都算成服務卡住。

- [重試raw](./results/assistant-gemma4-retry-oct09.jsonl)與
  [summary](./results/assistant-gemma4-retry-oct09Summary.json)另存，標記
  `userRetry=true`；保留原始失敗檔案及分數。
- 本次9項離線控制通過，live未啟用時1項跳過；啟用後10項測試通過代表
  記錄器／控制完成，**不是四個模型案例皆完成**。changed-file lint通過，
  未跑full-project typecheck。
- 未傳客戶紀錄、改正式prompt／模型設定／Kiosk流程或真實訂單；沒有自動
  重試機制、依案例調整gold或commit。README已記錄明確授權重試的隔離規則。
