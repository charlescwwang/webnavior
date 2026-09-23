# 購物車與暫時比較／選擇的版面歸屬研究

研究日期：2026-09-23

> 範圍：比較 Apple Store 與自助點餐／零售 Kiosk 的一手資料，釐清「已承諾購買的
> 訂單」和「仍在選擇、比較、客製中的暫時狀態」應如何分占版面。本文不討論推薦、
> 付款或實作細節。

## 可驗證的產品模式

| 產品 | 已承諾的購物狀態 | 暫時的比較／選擇狀態 | 版面歸屬訊號 |
| --- | --- | --- | --- |
| Apple Online Store | 每頁右上都有 `Bag` 入口；開啟後才進入可改數量、看商品／取貨／運送資訊的 Bag review。 | Apple 將「稍後考慮」放到 `Your Saves`（帳號區），客製進度也可保存後再續；iPhone 的 `Compare` 另為獨立的並排型號比較頁。 | Bag 是跨頁、可回到的交易容器；比較、收藏與尚未完成的客製不是 Bag 的常駐內容。官方說明沒有規定比較器的固定位置，但清楚把它們分成不同狀態與入口。 |
| Square Kiosk | 顧客加點時 persistent cart 保持可見；`Your order` 允許重新開啟已加品項、改選項、移除或清空。 | Square 同時使用較寬的 item modal 進行單品客製。 | 訂單摘要需持續可見，但單一商品的決策可以暫時佔用較大的 modal；兩者不必共用同一塊固定側欄。 |
| Toast Self-Ordering Kiosk | 顧客在畫面底部點 `View order` 進入 `My Order`，於其中調整數量、移除或 `Edit item`。 | 單品詳情／客製從右側滑出，完成後才回到點餐。 | 右側是暫時性的「現在這一品」選擇空間；整筆訂單的入口在底部，完整編輯在專屬覆核畫面。這是最直接的 Kiosk 對照。 |
| Clover Kiosk（23.8 吋直式） | Clover 要求使用者可直接在 order summary 修改品項，避免反覆按 Back。 | Clover 將常用 menu／modifier 放在螢幕中段；重要導覽放在固定、可觸及的位置。 | 對 1080×1920 的直式大螢幕，常用互動應集中在中段、關鍵 CTA 放底部。訂單不應變成置頂小角落，也不宜與單品選擇並排搶窄寬度。 |

## 對 AIRI 的結論

將畫面狀態分成兩種所有權，能避免「比較」覆蓋或擠壓「已加入訂單」：

```text
交易狀態（跨餐點、可持續）
  固定摘要：目前訂單 · 件數 · 合計 · 查看訂單
  完整覆核：可改數量／客製／移除

暫時選擇（只屬於目前餐點）
  品項詳情／客製／並列比較
  完成、取消或切換品項後關閉，回到原分類與捲動位置
```

- **不要讓比較面板變成購物車。** 暫時比較僅管理「正在看的 2–3 個餐點」與其差異；
  它關閉時不影響已加入的訂單。顧客確認一項後，結果才寫入固定摘要。
- **橫向桌上型 Kiosk：** 以底部固定摘要保存購物車入口，右側可暫時作品項詳情／
  比較 pane。這符合 Toast 對右側與底部的分工，也保留菜單的主寬度。
- **直式 Kiosk：** 固定摘要列置於底部；詳情／比較以全高頁或從底部展開的 sheet
  呈現。Clover 的直式裝置指南支持把高頻選擇置中、主要下一步置底，避免右側常駐欄。
- **頂端右側只作次要入口。** Apple 的網頁 Bag 證明它在桌面商店可作跨頁入口；
  但它本身不能證明這是直式、近距離觸控 Kiosk 的最佳位置。若保留頂端圖示，必須有
  同等功能的固定底部摘要，不能把它當唯一購物車入口。
- **不可移動。** 檢索的 Apple、Square、Toast、Clover 官方流程皆採固定位置或固定
  畫面轉換；未找到將 cart／comparison 作可拖曳浮窗的官方模式。固定位置更適合陌生
  顧客快速建立空間記憶。

## 建議的直式骨架

```text
┌──────────────────────┐
│ 返回／分類     訂單圖示 │  ← 次要入口
│                      │
│        品項網格        │
│                      │
│ 〔選擇／比較〕暫時面板  │  ← 覆蓋內容，不覆蓋固定摘要
├──────────────────────┤
│ 目前訂單 3 項 · $285   │
│              查看訂單  │  ← 固定、可觸及底列
└──────────────────────┘
```

比較不是目前 AIRI 菜單的既有需求；若後續要加入，先限制為同分類、少量餐點的短暫
比較，且不把它與購物車資料模型混在一起。產品詳情與比較關閉後，顧客應回到原先的
分類與捲動位置；訂單摘要則始終保留。

## 一手來源

- Apple 說明任一頁右上 `Bag` 可進入 review，並在其中調整數量與查看商品、取貨、
  運送資訊；`Your Saves` 與客製進度則另行保存：[Shopping Experience](https://www.apple.com/shop/help/shopping_experience)。
- Apple Store app 官方頁列出 compare models 與 `Your Saves` 為購物／瀏覽能力：
  [Apple Store on the App Store](https://apps.apple.com/us/app/apple-store/id375380948)。
- Apple 的 iPhone `Compare` 是獨立的型號並排比較頁，而非 Bag 的一部分：
  [Compare iPhone models](https://www.apple.com/iphone/compare/)。
- Square 說明 Kiosk 的 persistent cart／`Your order` 編輯：
  [Preview the diner experience on Square Kiosk](https://squareup.com/help/us/en/article/8540-preview-diner-experience-on-square-kiosk)；其 Kiosk 更新也列出較寬 item modal 與 always-visible carts：
  [Square Releases](https://squareup.com/us/en/releases)。
- Toast 說明右側 item detail pane、底部 `View order` 與可編輯的 `My Order`：
  [Kiosk: Place Orders and Make Payments](https://support.toasttab.com/en/article/Kiosk-Placing-Orders-Making-Payments-and-Tipping)。
- Clover 明定 23.8 吋直式 1080×1920 訂餐螢幕、中段高頻互動、底部主要 CTA，及可從
  order summary 直接修改品項：[Developer quick start: Clover Kiosk integration](https://docs.clover.com/dev/docs/developer-quick-start-clover-kiosk-integration)。
