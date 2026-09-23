# 點餐菜單瀏覽介面研究

研究日期：2026-09-22

> 範圍限定為顧客在 Kiosk／線上點餐頁「找餐點、看餐點、開始客製」的
> 瀏覽體驗；不討論推薦、購物車、結帳、付款或訂單送出。
> 以下以 POS／餐飲平台的一手產品與說明文件為依據，不把它當成市場佔比調查。

## 目前介面的判讀

`apps/order-menu/src/App.vue` 目前將 POS 回傳的扁平品項，依 `category` 依序
完整展開成多個區塊；畫面沒有固定的分類入口、搜尋或篩選。每張
`menuItemCard.vue` 同時承載圖片、描述、價格、可展開客製、數量與加入動作。
對約 35 品項的菜單，顧客得靠捲動找品類；而想先比較餐點時，客製與數量控制也會
讓每張卡的資訊密度變高。

現行 POS Bridge 的 `CatalogSnapshot` 只有每個項目的 `category: string`，沒有對顧客
呈現所需的分類排序、圖像、層級或時段可見性。`optionGroups` 已能表達必填與加價，
但尚未表達最少／最多可選數、條件式下一步或顧客可見排序。

## 官方產品中反覆出現的模式

| 模式 | 官方可驗證做法 | 對 AIRI 菜單瀏覽的含意 |
| --- | --- | --- |
| 顧客分類是獨立的展示模型 | Square 將給顧客看的組織稱為 menu groups，與內部報表／廚房 routing 的 categories 分離；其 Catalog API 的 menu categories 可有父子階層，且用來組織 Kiosk、行動與線上菜單。 | 不應只把內部 `category` 字串當版面。POS Bridge 應日後提供一個有排序、顯示名稱、圖示／照片且可選父層的 customer-facing menu 結構；內部 POS 分類仍維持其作業用途。 |
| Kiosk 先讓人「定位品類」，再看品項 | Square 對 Kiosk 的改版明列 picture-based categories、較大字、較寬的 item modals，以及更快的 menu loading/browsing。 | 首屏應以可觸控的大分類入口建立位置感：橫向螢幕可用左側固定分類列，直向／窄螢幕則用頂端可橫捲的分類 chips；內容區只顯示目前分類，並保留「全部」作為明確入口。圖片屬於分類與品項的辨識線索，不只是裝飾。 |
| 搜尋是找得到名稱時的捷徑，不取代分類 | Toast 的 Online Ordering 為大型菜單提供按品名／描述搜尋，行動版另以 bottom sheet 列出所有 menu 與 category，並標示品項數。 | 搜尋應放在分類導覽旁、但不是首屏唯一入口；顧客知道「蝦捲」時可直達，不知道要吃什麼時仍能靠分類探索。窄螢幕將完整分類收進「分類」面板，切換後保留目前瀏覽位置。 |
| 品項卡是「比較／進入」入口，不是完整表單 | Square 區分固定型態（variation，例如大小）與購買時才調整的 modifier（例如加起司）；modifier sets 可依品項定義顯示順序。 | 瀏覽卡只保留圖片、名稱、短描述、起價／價格與一個明確的「選擇」入口。將必填或多步客製移到品項詳情的寬 modal／側面板，按店家設定順序逐組完成；避免每一張卡片預先露出選項與數量控制。 |
| 客製是有規則的流程，不只是按鈕群 | DoorDash 讓店家設定某選項是否必填、可否多選、附加價格，並支援選定前項後才出現的 nested modifier；Square 也主張以 step-by-step flows、數量控制與 sequencing 處理複雜客製。 | 詳情流程要顯示「必選／可略過」、「已選 n / 最多 n」與加價，並只在前置選擇後揭露後續問題。若要支援這種真實 POS 結構，catalog contract 需補 `minSelected`、`maxSelected`、顯示排序與條件子選項；在此之前，介面不應假裝可處理多選或巢狀選項。 |
| 可點選性由當下供應狀態決定 | Square 的 menu／menu group 可依時段與銷售通路控制可見性；Kiosk 的時段 menu group 僅在可供應時出現。 | 顧客不應在瀏覽途中遇到已不能點的品項。POS Bridge 應把即時 `available` 與未來的分類時段規則視為展示資料；不供應的品項／分類預設不呈現，而不是留下無法理解的 disabled 卡片。 |

## 建議的第一版資訊架構

這個方向先解決「如何找菜」，不預先決定推薦或購物車將放在哪裡。

```text
店名／一句引導
┌──────── 分類導覽 ────────┬──────── 目前分類的品項網格 ────────┐
│ 全部（35）                │ [圖片] 蝦捲      $95   [選擇]          │
│ 招牌小吃                  │ [圖片] 肉燥飯    $…    [選擇]          │
│ 飯／麵                    │ [圖片] 綜合湯    $…    [選擇]          │
│ 湯品                      │                                        │
│ 飲料                      │                                        │
└───────────────────────────┴────────────────────────────────────────┘
                    ↓ 點「選擇」才開品項詳情／客製流程
```

- 分類導覽採固定位置，選取狀態高對比；每項可有圖片或 Icon 與品項數。分類不宜超過
  一個視窗高度，過多時先整理為上層分類，再在內容區顯示子分類。
- 網格卡維持一致高度與大觸控面積，只做比較所需的資訊。短描述以一至兩行截斷；
  沒有真實照片時使用一致的品類插圖，不使用不同語意的 emoji 當主要辨識。
- 詳情採「選擇餐點」而不是直接把表單塞進列表：先確認品項，再依序處理必要客製。
  單一、零加價的可選偏好可在詳情中快速略過；必填／加價／多選才要求顧客處理。
- 類別與品項顯示順序由店家／POS 提供，不在前端以名稱或回傳順序猜測；這也讓招牌、
  時段菜單與缺貨隱藏可保持一致。

## 對現有資料邊界的最小後續需求

開始實作前，先和 POS 方確認是否能提供下列展示資料。這是資料契約的討論，不建議
由 UI 硬編碼：

1. `menuGroups[]`：`id`、`label`、`sortOrder`、可選 `imageUrl`、`parentId`、
   `available`；品項用 `menuGroupId` 關聯，而非只留文字分類。
2. `optionGroups[]`：除現有 `required` 外，至少加 `sortOrder`、`minSelected`、
   `maxSelected`；只有 POS 能保證時再增加巢狀／條件式選項。
3. 品項提供真正的展示排序與 available 狀態。圖片是選配資料，但沒有圖片時應有
   穩定、可存取的替代呈現。

現有 Bridge 已經有 catalog revision 與 available 品項的邊界，適合作為這些欄位的
來源；本研究不建議前端另立一份可銷售菜單。

## 一手來源

- Square 說明顧客可見的 menu groups 與內部 categories／POS display groups 的責任
  分離，以及其跨 Kiosk、線上點餐與外送通路的用途：[Manage your menus across locations and sales channels](https://squareup.com/help/us/en/article/8553-manage-your-menus-across-locations-and-sales-channels)。
- Square Catalog API 說明 menu categories 用於 Kiosk、行動與線上點餐的菜單組織，
  並支援父子階層：[Manage Menus](https://developer.squareup.com/docs/catalog-api/manage-menus)。
- Square 的 Kiosk 產品更新列出 picture-based categories、較大字、較寬 item modal
  與更快瀏覽：[New Restaurant Features & Updates](https://squareup.com/us/en/releases/food-and-beverage)。
- Toast 說明大型 Online Ordering 菜單的品名／描述搜尋，以及行動版的 menu/category
  導覽面板：[Getting Started with Online Ordering](https://support.toasttab.com/en/article/Getting-Started-Online-Ordering)。
- Square 說明 variations 用於固定型態、modifiers 用於購買時客製，且 modifier set
  的順序可在品項層級設定：[Create and edit modifiers](https://squareup.com/help/us/en/article/5119-create-and-manage-item-modifiers)。
- DoorDash 說明 modifier 的必填、多選、不同加價，以及依前一個選擇顯示的 nested
  modifiers：[How to Add Modifiers to Your Menu](https://help.doordash.com/en-ca/merchants/article/editing-modifier-settings-on-your-menu?ctry=US&divcode=UT)。
- Square 說明 menu／menu group 的時段可用性，而 Kiosk 的時段 menu group 只會在可供應
  時顯示：[Create and update menus](https://squareup.com/help/us/en/article/6424-create-menus-with-square-for-restaurants)。
