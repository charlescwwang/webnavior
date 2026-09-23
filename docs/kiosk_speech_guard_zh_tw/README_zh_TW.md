# 智慧點餐 Kiosk Speech Guard｜繁體中文合成語料 v1.0

## 1. 標籤定義

這份資料用於「ASR 轉寫是否值得交給主要 Agent」的語意候選篩選。標籤不代表已確認說話人，也不構成送單、取消訂單或付款授權。

| label | 定義 | 邊界 |
|---|---|---|
| ORDER_INTENT | 選餐、加減份數、客製、單品修改，以及直接協助選餐的詢問。 | 刪單一餐點屬此類；清空整張訂單屬 KIOSK_COMMAND。替親友代點仍是有效需求。 |
| AGENT_RESPONSE | 有相符的上一輪 Agent 問句時，可理解為確認、否定、數量、規格或其他欄位值的回覆。 | 「不要、兩份、外帶」不應無條件歸此類；必須檢查問句與狀態。 |
| KIOSK_COMMAND | 操作介面、系統、整張訂單、付款流程、會員、發票或可及性功能。 | 「改用信用卡付款」是操作要求；被問付款方式後回答「信用卡」是 AGENT_RESPONSE。 |
| BACKGROUND_CONVERSATION | 在指定標註場景中，屬於旁人、其他交易、其他系統或非本次 Kiosk 任務的談話。 | 有餐飲詞、第三人稱、過去式或拒絕詞，不代表應攔截。說話對象決定標籤時，標為 requires_context=true。 |
| AMBIGUOUS | 就該筆實際提供的前文與畫面資訊，仍不足以安全選擇其他四類。 | 表示保留判斷，不等於背景雜音。也包括「有前文，但問句不相符或指涉仍不明」。 |

### `requires_context` 的意思

`true`：要判定這一筆的標籤，需要前文、畫面指涉、或可靠的說話對象線索。
`false`：在此合成情境的語意判讀中，不需依賴特定上一輪才能給出該標籤。

這個欄位**不是**「是否已具備所有下單參數」，也**不是**「已證明這個人正在跟 Kiosk 說話」。例如「不要辣」仍可辨識為餐點客製需求，主要 Agent 再處理要改哪一道餐。

## 2. Dataset 設計原則

### 短句的標籤依情境，不依字典

「不要」在「需要加購薯條嗎？」之後是 AGENT_RESPONSE；在沒有有效前文時則是 AMBIGUOUS。原型資料刻意保留 28 組這種跨標籤同句，但每個標籤內沒有重複轉寫。

這不是可以直接拿五個類別的單一向量中心做 argmax、就期望解決的歧義。相同文字的 embedding 無法表達資料中未輸入的前文差異；需要先判斷可用情境，或把情境作為另一個輸入。

### 不把否定、親友稱謂、轉述或過去式當成攔截條件

包含「不要辣」「先不要送單」等有效否定，也加入「我媽說她那份不要辣幫我改一下」「朋友傳訊說要花枝羹我這單再補一份」等代點／轉述正例。對照資料則包括別人的訂單、過去用餐、同桌分食、店員與其他客人的交談。

### 保留真實口語形式，但不聲稱是現場採樣

涵蓋便當、蝦捲、肉燥飯、蚵仔麵線、雞排、鹽酥雞、豆漿、茶飲等詞彙，也包含短答、斷句、自我修正、少量台語夾華語轉寫，以及人工模擬的同音字、重複字與漏字。

整份資料都是**合成資料**。ASR 變體不是從任何特定 ASR 模型實測得來，不能用其比例估計現場錯誤率。文中餐點、客製選項、支付方式與系統功能均為情境範例，不表示你的 Kiosk 已支援。

### Hard test 隔離

Prototype 與 hard test 的原文重複為 0；經 NFKC、拉丁字母大小寫正規化，以及移除空白、標點、符號後，重複也為 0。

Hard test 有 75 組 pair，每組兩筆，分成五種設計，各 15 組：

- 明確點餐 vs 餐飲聊天／轉述。
- 相同短句，有有效前文 vs 無有效前文。
- Kiosk 操作 vs 對別人／別的系統的操作。
- 完整餐點需求 vs 未指明對象的片段。
- 回答 Agent 的省略短答 vs 明確系統操作。

其中 15 組是**同一句文字、不同情境**，所以 154 筆共有 139 個不重複轉寫。這是診斷上下文利用能力的測試，不是 prototype/test 洩漏。

此外，6 筆背景樣本也附有上一輪 Agent 問句；6 筆 AMBIGUOUS 則有前文但仍不足以判定，避免把「context 不是 null」當成正確分類捷徑。

目前的隔離檢查不等於語意家族或改寫家族完全隔離。不能拿這個 hard test 調完閾值後，再把它當作未使用過的獨立測試。閾值校準應另備 dev set，最好加入你實際場域的匿名轉寫。

## 3. 完整資料與筆數

| label | prototype_examples.jsonl | hard_test.jsonl |
|---|---:|---:|
| ORDER_INTENT | 125 | 32 |
| AGENT_RESPONSE | 180 | 30 |
| KIOSK_COMMAND | 120 | 30 |
| BACKGROUND_CONVERSATION | 140 | 32 |
| AMBIGUOUS | 120 | 30 |
| 合計 | 685 | 154 |

180 筆 AGENT_RESPONSE 中，176 筆在上述正規化後不超過 4 個字元。單一標籤內沒有重複句。

檔案清單：

| 檔案 | 用途 |
|---|---|
| prototype_examples.jsonl | 全部五類原型語料。 |
| hard_test.jsonl | 獨立 hard test，含 pair_id 與 pair_focus。 |
| hard_test_reference_views.jsonl | 以 ID 對應不同上下文可用程度的評測目標，不是新增的測試樣本。 |
| label_definitions.json | 機器可讀的標籤與欄位定義。 |
| validate_dataset.py | 僅用 Python 標準函式庫檢查格式、數量、重複與 pair 完整性。 |
| validation_report.json | 此版本的檢查結果與主要資料檔 SHA-256。 |
| README_zh_TW.md | 本說明。 |

所有 JSONL 都是 UTF-8、無 BOM，每一行一個完整 JSON object，使用 LF 換行。

## 4. 欄位

每筆原型與 hard test 都包含使用者要求的四個欄位：

- `label`：五類之一。
- `text`：ASR 轉寫形式的文字。
- `difficulty`：`easy`、`medium` 或 `hard`；這是合成資料的設計難度，不是實測模型分數。
- `requires_context`：布林值，定義見上。

另附 `id` 與 `context`。`context` 可為 null，或包含：

```json
{
  "previous_agent_turn": "需要加購一份薯條嗎？",
  "kiosk_state": "AWAITING_ADDON",
  "expected_response": "addon_confirmation"
}
```

需要物件指涉時，會有 `selected_item` 或 `selected_control`。狀態名稱是這份資料的描述性代碼，導入時請映射到你的實際狀態機；不能假設它們已存在於你的程式。

`annotation_note` 是人工合成場景／錯字說明；hard test 另有 `pair_id`、`pair_focus`。

**不要把 label、id、annotation_note、pair_id、pair_focus 或評測參考目標餵給 embedding 或 classifier。** `requires_context` 也是標註目標／評測切分資訊，不是推論時可以預先知道的真值特徵。`context` 只能使用現場系統實際可觀測到的部分。

## 5. 背景樣本最重要的限制

32 筆 prototype 背景樣本，以及 7 筆 hard-test 背景樣本，必須知道說話對象／場景，才能確定它們是背景。

例如「我昨天吃過這個」可以是朋友聊天，也可以是使用者回應 Agent 推薦；「我媽說她那份不要辣」也可能是在替家人點餐。這些資料的 `annotation_note` 說明了生成時設定的場景，**但註解不等於你的 Kiosk 已觀測到該場景**。

當系統只有 ASR 文字，或只有 ASR 加上上一輪問句，卻沒有可靠的說話對象資訊時，這些樣本的安全評測目標應為 AMBIGUOUS，而不是硬要求系統輸出 BACKGROUND_CONVERSATION。不能用觀看螢幕、等待回答等單一訊號，直接宣稱已確認每段聲音的來源。

## 6. 三種評測目標

`hard_test_reference_views.jsonl` 以每筆 `id` 提供三種參考：

| 欄位 | 假設可用輸入 | 處理 |
|---|---|---|
| text_only_expected_label | 只有 text。 | requires_context=true 的樣本以 AMBIGUOUS 為保守路由目標；這個 view 沒有 AGENT_RESPONSE 類，不應計算含該空類的五分類平均。 |
| dialogue_state_expected_label | text 加上該筆實際提供的 previous_agent_turn／kiosk_state／指涉資料。 | 採原始標籤，但那 7 筆依賴外部說話對象的背景樣本改以 AMBIGUOUS 為目標。 |
| scene_grounded_expected_label | 除對話狀態外，必要時另有可靠說話對象證據。 | 使用 hard_test.jsonl 的原始場景標籤。只有 annotation_note 不算取得證據。 |

這三者是**評測設定**，不是三組額外樣本，也不應混在一起重複計分。以你的系統實際擁有的輸入選擇一個 view。

至少應分開檢查有效輸入被誤擋的比例、背景被誤放行的比例、短答召回，以及 pair 的兩筆是否同時判對。涉及相同文字的 pair，文字-only 評測本來就應保留歧義，不應把無法區分的標籤硬算成模型缺陷。資料是刻意平衡且偏難的集合，不代表餐廳現場的類別先驗機率。

## 7. 初始 embedding 使用方式

向量庫可以先只編碼 `text`，但在檢索／判斷時用真實對話狀態選擇候選原型。不要把五類各平均成一個向量後，忽略短答的情境差異。

一個起始拆法是：

```python
import json
from pathlib import Path

root = Path(__file__).resolve().parent
with (root / "prototype_examples.jsonl").open(encoding="utf-8") as f:
    rows = [json.loads(line) for line in f]

# 全域文字候選：排除須靠外部場景才能確定的背景原型。
global_pool = [
    row for row in rows
    if not row["requires_context"] or row["label"] == "AMBIGUOUS"
]

# 用實際上一輪問句／expected_response 選適合的短答原型。
response_pool = [row for row in rows if row["label"] == "AGENT_RESPONSE"]

texts_to_embed = [row["text"] for row in global_pool]
```

`global_pool` 共 438 筆；`response_pool` 共 180 筆。其餘情境式 ORDER_INTENT／KIOSK_COMMAND 可在對應的畫面或選取狀態下使用。需要外部話者證據的背景樣本，不建議當成全域無條件攔截原型。

若使用多原型近鄰分數，可先固定每類相同的 top-k 聚合規則，再用 dev set 校準；不要因 AGENT_RESPONSE 有較多樣本，就把全類相似度直接加總。這是待實驗的起始設計，不是已驗證的最佳配置。

AMBIGUOUS 應保留給狀態機、短暫等待補句或既有互動流程判斷，不要直接等同 DROP，也不要讓任意一個短答自動授權送單／付款。

## 8. 驗證

在解壓縮後的資料夾執行：

```bash
python validate_dataset.py
```

或指定資料夾：

```bash
python validate_dataset.py --data-dir /path/to/kiosk_speech_guard_zh_tw
```

腳本會檢查必填欄位、型別、五類最少筆數、hard test 不重複句數、ID 唯一性、跨 split 重複、同句異情境的合法性、pair 結構與短答前文，並重寫 validation_report.json。

目前通過的是**資料格式與一致性檢查**。尚未在你的 embedding 模型、ASR 或實際 Kiosk 音場上進行分類效能測試。
