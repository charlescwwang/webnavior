# 溫暖但低干擾的 Kiosk Agent 呈現研究

研究日期：2026-09-22

> 本筆記比較官方產品頁與官方文件中可驗證的互動模式；不是對所有
> AI Agent 產品的市場統計。結論用於 AIRI 點餐 Kiosk 的介面方向探索，
> 不改變既有的隱私、語音與訂單確認邊界。

## 觀察對象與可驗證做法

| 官方產品 | 看見的 Agent 呈現 | 可帶走的設計訊號 |
| --- | --- | --- |
| Apple Siri | 服務啟動時以包覆螢幕邊緣的發光效果表示正在作用；使用者也能在文字與語音之間切換。 | Agent presence 可以是短暫、環境式的狀態回饋，而不必佔一個人物區塊。 |
| ChatGPT Voice | 語音在既有 chat 中進行；可一邊聽、一邊看文字、改用輸入，並在支援時顯示 widget 視覺結果。 | 對話與操作結果留在同一個工作平面；聲音是輸入方式，不是獨立的大型舞台。 |
| Amazon Alexa+ on Echo Show | 購物保留完整的商品瀏覽、比較、詳情與結帳畫面；顧客可在語音、觸控或兩者間切換，且針對遠距螢幕採更大字與按鈕。 | 對於交易型任務，親切感來自「會協助」但仍讓商品與可驗證的購物車當主角。 |
| Amazon Alexa+ Alexicons | 在藍色燈條上出現微笑、愛心、音符等小型動態圖像來對應談話語氣與主題。 | 若要給 Agent 個性，可用小而可辨識的情緒／服務記號；不必常駐一個全身角色。 |
| Google Search Live / Gemini Live | 以 Live 圖示啟動即時語音與相機／畫面理解，並把互動定位為針對眼前內容提供即時協助。 | 將「我看得到目前情境、能幫你下一步」具體化，比把 AI 擬人成服務生更能建立能力預期。 |
| SoundHound 餐飲語音點餐 | 官方餐飲白皮書的示意將對話式語音與可見的購物車並列；說明顧客可在對話中即時客製、編修訂單。 | 餐飲情境的信任中心是即時可見的訂單結果與可修正性，而不是角色形象。 |

### 一手來源

- Apple 描述 Siri 在作用時以環繞螢幕的發光效果呈現，並支援文字與語音間切換：[Introducing Apple Intelligence for iPhone, iPad, and Mac](https://www.apple.com/newsroom/2024/06/introducing-apple-intelligence-for-iphone-ipad-and-mac/)。
- OpenAI 說明 Voice 在既有對話中運作，可聽取回覆、閱讀文字、改用輸入，並在可用時呈現 widget 視覺結果：[ChatGPT Voice](https://help.openai.com/en/articles/20001274)。
- Amazon 說明 Echo Show 的 Alexa+ 讓顧客以語音、觸控或混合方式瀏覽、比較、購買，並為遠距使用採大字、大按鈕與簡化版面：[Echo Show gets a new visual shopping experience powered by Alexa+](https://www.aboutamazon.com/news/devices/echo-show-alexa-plus-shopping)。
- Amazon 將 Alexicons 定義為出現在藍色燈條上的表情動態，會依談話語氣與主題呈現笑臉、愛心、音符等：[Here’s what Amazon’s new Alexa+ can do for you](https://www.aboutamazon.com/news/devices/new-alexa-plus-amazon-devices)。
- Google 說明 Search Live 以 Live 圖示進入可用語音與相機的即時往返對話：[Search Live is expanding globally](https://blog.google/intl/en-ie/products/search-live-global-expansion/)；Gemini Live 的官方案例亦以即時視覺指引與購物輔助為定位：[5 ways to use Gemini Live with camera and screen sharing](https://blog.google/products-and-platforms/products/gemini/gemini-live-android-tips/)。
- SoundHound 的官方餐飲白皮書描述顧客可即時客製與編修語音訂單，並在示意畫面中保留可見購物車：[Food Ordering Complexity: Not All Voice AI Is Created Equal](https://www.soundhound.com/wp-content/uploads/2022/11/WHITE-PAPER-Enterprise-Restaurant.pdf)。

## 對目前 Kiosk 的判讀

目前全身 VRM 被放在左側固定欄位，視覺上會先被辨識為「展示中的人物」；
而右邊才是任務入口。當角色服裝、鏡頭或動作本來就強烈時，即使縮小欄位比例，
它仍可能與菜單爭奪第一眼注意力。上列產品的共通點不是完全沒有個性，而是將
個性壓縮到**使用者需要它的時刻**，並讓目前商品、答案、購物車與下一步始終保有
最大的面積與層級。

因此，下一版不宜只繼續微調角色欄寬，而應決定 Agent 在操作流程中的出場形式。

## 適合 AIRI 的四種方向

### 1. 服務光帶（建議優先做原型）

移除常駐人物欄，改在上方對話／輸入區邊緣放一條 8--12 px 的柔和光帶與小型
聲波／麥克風。光帶依狀態呼吸：待命、聆聽、思考、說話、已完成。旁邊只保留
「小葵｜智慧點餐服務員」與一句當下可做的事，例如「可以幫你找套餐、調整購物車」。

- 好處：最大化對話與菜單；角色不再和商品競爭；概念接近 Siri 的環境式 presence。
- 親切感來源：命名、聲音、節奏細膩的狀態動效與用語，而不是臉部佔比。
- 可保留 VRM：首次招呼與顧客主動點「認識服務員」時，以短暫浮層播放 3--5 秒，
  結束後收回光帶。

### 2. 情境服務卡

人物不常駐。只有在四個有價值的節點出現一張可收合的半身卡：首次招呼、提出
  推薦、購物車有衝突／缺漏、送單成功。卡片內容必須是可立即採取的行動，例如
「兩份套餐已加入，還要湯品嗎？」加上兩個可點選選項；其他時候只留小型服務徽章。

- 好處：把角色變成「有事才出現的服務員」，避免展示感。
- 親切感來源：短暫眼神／招呼動作配合明確服務成果。
- 注意：不得用卡片取代購物車或確認頁；動作結果仍需在正式 UI 顯示。

### 3. 訂單旁的智慧小幫手

讓 Agent 固定附著在購物車附近，而非獨佔一個舞台。桌面／橫向螢幕可做成購物車
標頭內的 40--56 px 圓形記號或小型半身頭像；它只在新增、修改、推薦、確認時
展開成一行結果摘要。角色在這裡扮演「訂單副駕」，不是餐廳的主視覺。

- 好處：每次 Agent 說話都直接對應顧客最在意的訂單狀態；符合餐飲語音訂購中
  對可見購物車與即時編修的模式。
- 親切感來源：以第一人稱簡短回應、清楚覆述實際變更，並提供撤銷／修改入口。
- 注意：它不應遮住結帳按鈕或訂單明細。

### 4. 菜單內的服務標記

完全不顯示人物，只把 Agent 做成菜單中的溫和引導：推薦卡上有小型「小葵推薦」
記號、適合原因、可一鍵加入；有過敏原／客製需求時，把追問放在該商品卡旁。
對話區只保留 voice indicator 與狀態文字。

- 好處：最接近 Alexa+ 在同一購物畫面中讓語音與觸控共同工作的形式，適合以
  點餐效率為優先的店面。
- 親切感來源：推薦理由貼近情境，而不是虛構人格表演。
- 代價：角色 IP 與陪伴感最弱；若品牌非常依賴角色，應選方向 1 或 2。

## 建議的取捨與下一步

先以方向 1「服務光帶」做低成本原型，再選擇性在首次招呼加入方向 2 的短暫角色
卡。這組合能保留現有語音、招呼動作與角色資產，又將主畫面從「角色展示」改為
「正在為你服務的點餐介面」。

第一輪可用兩個可觀察準則判斷是否有效：

1. 顧客在未教學下能否說出／點出「可請它推薦、改數量、送出訂單」。
2. 每一次 Agent 回應後，顧客是否能在一眼內找到它實際改變的餐點或購物車結果。

若兩者成立，再考慮將角色卡用於招呼、推薦和完成三個短暫時機；不要恢復全程常駐
全身人物。
