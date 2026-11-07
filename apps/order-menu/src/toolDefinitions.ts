import { ingredientDefinitions } from '../../order-menu-server/src/domain/composition'
import { menuPageStates } from './domain/menuPageState'
import { priceProperties } from './domain/pricing'

/** Stable Menu tool names shared by runtime execution and the compiled input contracts. */
export type MenuToolName
  = | 'kiosk_test_menu' | 'kiosk_customer_entry_start' | 'kiosk_customer_phone' | 'kiosk_fast_path_clarify' | 'customer_skip_phone'
    | 'menu_get'
    | 'menu_confirm_item'
    | 'kiosk_conversation_context'
    | 'menu_open'
    | 'menu_scroll'
    | 'menu_recommend'
    | 'menu_show_recommendations'
    | 'menu_select_item'
    | 'menu_set_item_option'
    | 'menu_set_quantity'
    | 'order_add_item'
    | 'cart_add_item'
    | 'cart_remove_item'
    | 'cart_set_line_quantity'
    | 'cart_set_line_option'
    | 'cart_clear'
    | 'cart_get'
    | 'order_answer_confirmation'
    | 'order_set_fulfillment'
    | 'order_set_party_size'
    | 'order_defer_question'
    | 'order_cancel_request'
    | 'order_ask_question'
    | 'seating_get'
    | 'seating_reserve'
    | 'checkout_start'
    | 'checkout_skip_membership'
    | 'checkout_choose_invoice'
    | 'checkout_request_tax_id'
    | 'checkout_set_tax_id'
    | 'checkout_confirm_invoice'
    | 'checkout_confirm_tax_id'
    | 'checkout_select_payment'
    | 'checkout_cancel'
    | 'kiosk_interaction_state'
    | 'kiosk_fast_path_context'
    | 'kiosk_fast_path_execute'
    | 'kiosk_fast_path_continue'
    | 'kiosk_dialogue_presented'
    | 'kiosk_question_validate'
    | 'kiosk_agent_task'
    | 'kiosk_query_scope'

/** Static tool contract; runtime discovery narrows POS capability enums and availability. */
export interface MenuToolDefinition {
  description: string
  inputSchema: Record<string, unknown>
  name: MenuToolName
  readOnly?: boolean
}

const ingredientFilterProperties = {
  dietary: { type: 'string', enum: ['vegetarian'], description: '素食需求。需 POS 明確素食標示才列為符合；不能僅以缺少肉類成分推論。更嚴格或未支援的飲食條件不可省略或弱化。' },
  excludeIngredients: { type: 'array', items: { type: 'string', enum: ingredientDefinitions.map(definition => definition.id) }, maxItems: ingredientDefinitions.length, uniqueItems: true, description: '排除成分 ID。依成分表篩選；不代表過敏安全，也不自動移除食材。' },
  includeIngredients: { type: 'array', items: { type: 'string', enum: ingredientDefinitions.map(definition => definition.id) }, maxItems: ingredientDefinitions.length, uniqueItems: true, description: '必須含有的成分 ID；與排除條件取交集。' },
}

const menuExclusionProperties = {
  excludeItemIds: { type: 'array', items: { type: 'string' }, uniqueItems: true, description: '依完整需求排除的真實菜單品項 ID。先查 menu_get(display:false) 的分類、品名與成分依據，再傳入需要排除的全部品項；不可用虛構 ID、字詞比對或猜成分代替語意理解。與食材、素食和價格條件取交集。more:true 時累加並保留排除；放寬或改口須省略 more 並傳完整新條件。' },
}

export const toolDefinitions: MenuToolDefinition[] = [
  { name: 'kiosk_test_menu', description: '開發用頁面狀態模擬，只供測試者；省略參數讀取目前狀態。', inputSchema: { type: 'object', properties: { itemId: { type: 'string' }, state: { type: 'string', enum: [...menuPageStates] } }, additionalProperties: false } },
  { name: 'kiosk_customer_entry_start', description: 'Host 在新訂單開始前請求自願電話登記；已填寫、略過或開始訂購時不重新詢問。不供 Agent 使用。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'kiosk_customer_phone', description: '只供 Kiosk host 提交顧客手動輸入的電話；不供 Agent、ASR 或模型填寫。', inputSchema: { type: 'object', properties: { phone: { type: 'string', pattern: '^09[0-9]{8}$' } }, required: ['phone'], additionalProperties: false } },
  { name: 'kiosk_fast_path_clarify', description: '將已確認是服務需求的本輪提案轉成單一品名確認問題；只供 host 使用，不寫購物車。', inputSchema: { type: 'object', properties: { questionId: { type: 'string', maxLength: 120 } }, required: ['questionId'], additionalProperties: false } },
  { name: 'customer_skip_phone', description: '只有顧客明確選擇略過電話、不留電話，或明確要求跳過登記直接點餐，才略過自願電話登記並進入菜單。在電話頁單說「略過」也是這項選擇。否定或撤回餐點不是電話選擇；同句先點餐再說不要了，只表示先不點該餐點，必須保留電話頁，不呼叫本工具。不要為了開始對話或回應撤回而略過電話。不代表登入會員，也不新增餐點。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'menu_open', description: '回到菜單繼續點餐，保留購物車。只能在尚未結帳時使用；不取消結帳、不開始付款。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'menu_scroll', description: '查看一個畫面高度的較前段（UP，接近菜單開頭）或較後段（DOWN，接近菜單結尾）內容。方向表示要顯示的內容位置，不是手指移動方向。保留分類、推薦與購物車；到邊界時不再移動。', inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['UP', 'DOWN'] } }, required: ['direction'], additionalProperties: false } },
  { name: 'kiosk_query_scope', description: 'Host-only scope question transition; validates question authority before querying.', inputSchema: { type: 'object', properties: { questionId: { type: 'string' }, choice: { type: 'string', enum: ['ASK', 'SHOWN', 'CATALOG', 'NEW_REQUEST', 'IGNORE'] }, transcript: { type: 'string' } }, required: ['questionId', 'choice'], additionalProperties: false } },
  { name: 'kiosk_agent_task', description: 'Kiosk host 綁定或結束目前 Agent 任務的已解析限制；不是 Agent 可選工具。', inputSchema: { type: 'object', properties: { taskId: { type: 'string', minLength: 1 }, action: { type: 'string', enum: ['BEGIN', 'END'] }, transcript: { type: 'string', description: 'BEGIN 必須提供本次顧客原句，供程式驗證查詢對象來源；END 不使用。' }, expectedMenuRevision: { type: 'integer', minimum: 0 }, readOnly: { type: 'boolean' }, handoff: { type: 'object', properties: { intent: { type: 'string' }, status: { type: 'string', enum: ['resolved', 'ambiguous', 'unmatched', 'target-absent', 'unavailable', 'stale', 'unrepresentable'] }, itemIds: { type: 'array', items: { type: 'string' }, maxItems: 200 }, lineIds: { type: 'array', items: { type: 'string' }, maxItems: 200 } }, required: ['intent', 'status', 'itemIds', 'lineIds'], additionalProperties: false }, constraints: { type: 'object', properties: { ...ingredientFilterProperties, ...priceProperties, unresolvedPrice: { type: 'boolean' } }, additionalProperties: false } }, required: ['taskId', 'action'], additionalProperties: false } },
  { name: 'menu_get', description: '精確查詢具體品名。顧客明確要求全部菜單時，必須用 scope:catalog、display:true 更新完整菜單畫面，包含已看過餐點；不能只口述全部或當成三項推薦。display:false 僅讀內部資料。分類條件只供內部查詢；要展示某分類，用 menu_recommend action:update 並傳 category，讓程式保留其他查詢條件。query／queries 僅限具體餐點名稱，category 只能使用 POS 精確分類。顧客沒有指定具體品名／分類，而是在找餐點、換選擇、重新挑選或需要釐清時，使用 menu_recommend 的 action，不使用本工具把整句或其他品項當名稱。display:false 是資料讀取，不可把整份結果逐項介紹。一次提到多道餐點以 queries 一次查齊。質疑先前介紹是否存在時加 verifyClaim:true，查無就明確更正，不改查相近餐點。指定分類透過明確查詢動作後要直接列出並展示回傳品項，不只說有幾種或叫顧客自己看畫面，不能憑分類名猜庫存或價格。單份價格與飲食限制依工具結果驗證，不分配整筆預算。不確定查詢範圍時用 menu_recommend action:clarify，尚未釐清不得猜範圍或推薦。', inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['catalog'], description: '明確要求整份菜單時使用，解除單品瀏覽範圍並實際展示；不取消飲食限制。' }, ...menuExclusionProperties, ...ingredientFilterProperties, ...priceProperties, display: { type: 'boolean', description: '預設只展示 query／queries 指定的具體品名查證結果。沒有具體品名（包含只傳 category）且非 scope:catalog 時必須設 false，僅讀內部資料。展示分類或瀏覽餐點必須改用 menu_recommend 並明確提供 action。' }, category: { type: 'string', description: '僅 display:false 內部讀取可用的 POS 精確分類。展示分類用 menu_recommend({action:"update",category:分類名稱})；不可用本工具展示分類。' }, verifyClaim: { type: 'boolean', description: '顧客質疑先前介紹是否真的在菜單時設為 true，並以 query 或 queries 核對先前提到的具體品名；不改查其他餐點。查無品項時明確更正先前介紹。' }, query: { type: 'string', description: '僅限顧客明確指定的具體餐點名稱或名稱片段；即使查無此品名仍保留原名。沒有具體品名時省略。其他、別的、那些等相對指涉與泛指品項不是商品名稱，不可放入 query。' }, queries: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 4, uniqueItems: true, description: '顧客明確指定多道餐點時，每個元素是一道具體餐點名稱。沒有具體品名時省略；不填泛指詞、相對指涉、分類或整句需求。' } }, additionalProperties: false } },
  { name: 'menu_recommend', description: '由程式保存查詢條件的餐點探索與語音釐清工具。每次必須明確提供 action。continue：保留真正飲食及分類條件找其他餐點；先前精確單品 query 應釋放，不能永遠只查同一品項；update：只提供本句要變更的條件，取消條件用 clear，其餘程式保留；明確撤回「想吃魚」等正向偏好時，用 clear:["includeIngredients"]，保留 excludeIngredients／過敏與素食限制；不能只改分類就當作偏好已取消；reset：使用者明確重新挑選才重置價格、分類等瀏覽條件，飲食限制和已展示歷史保留；clarify：需求或範圍不明，只傳 {action:clarify}，問題由程式產生，不提供 customerMessage、question 或其他參數；工具回傳一個語音問題，不查新餐點、不展示、不改購物車。泛指其他項目、別的選擇或更正前句不是品名。前次已無其他符合結果且未明示新範圍時選 clarify；不能直接重置或重試相同條件。第一輪找餐點用 update。僅明確具體品名的精確查證使用 menu_get。每次最多三項，完全依真實售價、成分和 POS 標示篩選，不猜素食或過敏安全，不分配整筆預算；價格顯示於畫面，不必逐項朗讀。語音釐清的 customerMessage 直接問顧客即可，不再查詢。', inputSchema: { type: 'object', properties: { ...menuExclusionProperties, ...ingredientFilterProperties, ...priceProperties, category: { type: 'string' }, query: { type: 'string', description: '僅限顧客指定的具體餐點名稱；未指定時省略，不填其他品項或相對指涉。' }, queries: { type: 'array', items: { type: 'string' }, maxItems: 4, description: '每個元素必須是顧客指定的具體餐點名稱；沒有具體品名時省略。' }, action: { type: 'string', enum: ['continue', 'update', 'reset', 'clarify'], description: '必要。continue 沿用條件換批，不修改條件，只需 action 及可選 limit；若重填價格，必須與目前保存值完全一致，作一致性檢查，不能新增或改價；update 只修改本句明示的條件，其餘由程式保留；reset 重新挑選，清除價格與分類等瀏覽限制，保留飲食限制與已展示歷史；clarify 需求有歧義，只傳 action，不提供 customerMessage 或 question；問題由程式產生，不查詢或展示。原條件已無其他結果又只說其他品項，選 clarify，不能把泛指詞當 query。' }, excludeShown: { type: 'boolean', description: '僅 update 使用；只有本句同時修改條件並明確要求其他未介紹餐點時為 true；不得沿用前句要求其他餐點的意圖。單純改價位或分類、詢問新條件有哪些符合餐點時省略，即使前句曾要求換批或沒有更多結果，符合的已展示餐點也可列入。continue／reset 已內建排除歷史，不需此欄位。' }, clear: { type: 'array', items: { type: 'string', enum: ['price', 'category', 'query', 'needs', 'strategy', 'dietary', 'ingredients', 'includeIngredients', 'excludedItems'] }, uniqueItems: true, description: '僅 update 使用；明確取消哪組條件才列出。includeIngredients 只撤回必須含有的偏好，保留排除及素食；ingredients 會清整組食材，不能用來代替單純撤回喜好。提供新的價格欄位會整組替換原價格上下限，省略欄位保留原組。飲食限制不可因重新挑選而自行清除。' }, needs: { type: 'array', items: { type: 'string', enum: ['rice', 'fried'] }, minItems: 1, uniqueItems: true }, limit: { type: 'integer', minimum: 1, maximum: 3, description: '預設最多三項；顧客明確只要一或兩項時可縮小。' } }, required: ['action'], additionalProperties: false } },
  { name: 'menu_show_recommendations', description: '在菜單中非阻斷地展示 1 至 4 項推薦。只可在顧客明確表示想看推薦後使用。itemIds 必須全部來自先前 menu_get 或 menu_recommend 的回傳結果；不得自行猜測品項。可附簡短標題與理由，但不得加入未提供的健康、過敏或供應資訊。回覆時直接說出實際推薦品名，不要只叫顧客看畫面。', inputSchema: { type: 'object', properties: { itemIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4, uniqueItems: true, description: '必要。先前菜單工具回傳的 item.id。' }, reason: { type: 'string', maxLength: 90, description: '可選。給顧客看的簡短搭配理由。' }, title: { type: 'string', maxLength: 36, description: '可選。推薦列標題。' } }, required: ['itemIds'], additionalProperties: false } },
  { name: 'menu_select_item', description: '選擇一個餐點並建立可設定的選擇。呼叫前必須先使用 menu_get，並傳入其結果中完全相同的 item.id。', inputSchema: { type: 'object', properties: { itemId: { type: 'string', description: '必要。先前 menu_get 回傳的其中一個 item.id；不得猜測、翻譯或自行建立。' } }, required: ['itemId'], additionalProperties: false } },
  { name: 'menu_set_item_option', description: '設定目前餐點的口味、辣度、甜度或冰量。groupId 與 valueId 必須來自 menu_select_item 回傳的 item.optionGroups。', inputSchema: { type: 'object', properties: { groupId: { type: 'string', description: '必要。已選餐點 optionGroups 中的 group.id。' }, valueId: { type: 'string', description: '必要。該 group.values 中的 value.id。' } }, required: ['groupId', 'valueId'], additionalProperties: false } },
  { name: 'menu_set_quantity', description: '設定目前餐點的數量。只可在 menu_select_item 後、cart_add_item 前使用。', inputSchema: { type: 'object', properties: { quantity: { type: 'integer', minimum: 1, description: '必要。顧客指定的原始整數份數，不能自行減量；超量由執行端回傳上限說明。' } }, required: ['quantity'], additionalProperties: false } },
  { name: 'order_add_item', description: '一次完成一個已確認餐點的選擇、已知客製化、數量與加入購物車。顧客指定品項與所有必要客製化後，優先使用此工具，避免逐步呼叫 menu_select_item、menu_set_item_option、menu_set_quantity、cart_add_item。換餐時也使用本工具，帶 replaceLineId 一次更換原 cart line，不另外呼叫 cart_remove_item；失敗保留原餐點。itemId、options 的 groupId 與 valueId 必須來自 menu_get 的結果。', inputSchema: { type: 'object', properties: { replaceLineId: { type: 'string', description: '只有更換既有餐點時填寫。cart_get 回傳且顧客指定的原 cart line.id；一次替換整筆，未指定 quantity 時保留原份數，不能猜多筆同名餐點是哪一筆。' }, itemId: { type: 'string', description: '必要。menu_get 回傳的其中一個 item.id。' }, options: { type: 'array', description: '顧客明確指定的客製化；未指定的選項保留該品項預設值。', items: { type: 'object', properties: { groupId: { type: 'string' }, valueId: { type: 'string' } }, required: ['groupId', 'valueId'], additionalProperties: false } }, quantity: { type: 'integer', minimum: 1, description: '顧客指定的原始數量，不能自行減量或拆單；超量由執行端拒絕。未明說份數時不填。' } }, required: ['itemId'], additionalProperties: false } },
  { name: 'cart_add_item', description: '將目前已設定的餐點加入購物車。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cart_remove_item', description: '從購物車移除一個 cart line。先用 cart_get 取得正確的 lineId。單獨要求移除時，執行成功後才能告知已移除。更換餐點請改用 order_add_item 的 replaceLineId，一次替換並在失敗時保留原餐點，不以本工具拆開換餐。', inputSchema: { type: 'object', properties: { lineId: { type: 'string', description: '必要。cart_get 回傳的其中一個 cart.lines[].id。' } }, required: ['lineId'], additionalProperties: false } },
  { name: 'cart_set_line_quantity', description: '直接調整購物車中一個餐點的數量，不要先移除再重新加入。先用 cart_get 取得正確的 lineId；成功後依回傳 cart 確認數量與總額。', inputSchema: { type: 'object', properties: { lineId: { type: 'string', description: '必要。cart_get 回傳的其中一個 cart.lines[].id。' }, quantity: { type: 'integer', minimum: 1, description: '必要。顧客指定的原始正整數數量，不自行減量；超量由執行端拒絕。' } }, required: ['lineId', 'quantity'], additionalProperties: false } },
  { name: 'cart_set_line_option', description: '直接修改購物車中一個餐點的單一客製選項，不要先移除再重新加入。先用 cart_get 取得 lineId；groupId 和 valueId 必須來自該餐點先前由 menu_get 回傳的 optionGroups。若修改後與另一筆選項完全相同，系統會合併數量並回傳保留的 line。', inputSchema: { type: 'object', properties: { lineId: { type: 'string', description: '必要。cart_get 回傳的其中一個 cart.lines[].id。' }, groupId: { type: 'string', description: '必要。該餐點 optionGroups 中的 group.id。' }, valueId: { type: 'string', description: '必要。該 group.values 中的 value.id。' } }, required: ['lineId', 'groupId', 'valueId'], additionalProperties: false } },
  { name: 'cart_clear', description: '清空尚未送出的購物車。僅在顧客明確表示取消全部餐點、重新開始或等同語意時使用；先以 cart_get 確認目前內容。清空後原本的內用／自取選擇也會移除。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true, description: '必要。只有顧客已明確要求清空時才可設為 true。' } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'order_answer_confirmation', description: '顧客回答是否接受無客製的原版餐點時也使用本工具；confirmationId 使用當前 waitingFor.questionId，confirmedByUser 依本句是否接受原版。回答目前已呈現的操作確認問題。confirmationId 只能使用本輪 waitingFor.questionId；確認／好／可以依完整語意回答該操作，取消則傳 false。不得回答自己剛建立的問題，不選發票、不付款；過期或訂單已變更時重新釐清。', inputSchema: { type: 'object', properties: { confirmationId: { type: 'string', minLength: 1 }, confirmedByUser: { type: 'boolean' } }, required: ['confirmationId', 'confirmedByUser'], additionalProperties: false } },
  { name: 'cart_get', description: '取得購物車、品項數與總額。顧客要求打開／顯示購物車時，必須呼叫本工具並傳 display:true，實際展示訂單及 POS 用餐方式選項，不能只用文字附和。不取代正在進行的結帳畫面；只讀資料而不切換畫面時指定 display:false。', inputSchema: { type: 'object', properties: { display: { type: 'boolean', description: '預設展示訂單；false 僅讀取資料，不切換画面。' } }, additionalProperties: false }, readOnly: true },
  { name: 'order_set_fulfillment', description: '設定整筆訂單的用餐方式。只使用 menu_get 回傳的 fulfillmentModes 與 POS 選項名稱；尚未告知時以 order_ask_question 取得系統問題，不另行編寫。必須在 checkout_start 前完成。', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['dine-in', 'takeout'], description: '必要。必須為 POS fulfillmentModes 提供的 id，對顧客使用該選項的 label。' } }, required: ['mode'], additionalProperties: false } },
  { name: 'order_set_party_size', description: '設定內用人數（1 至 20 位），與餐點數量不同。修改人數會釋放原暫留桌位，再顯示目前可選桌位。', inputSchema: { type: 'object', properties: { partySize: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['partySize'], additionalProperties: false } },
  { name: 'seating_get', description: '查詢本次內用人數與目前真實可用桌位組合；不保留桌位。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, readOnly: true },
  { name: 'seating_reserve', description: '選擇 seating_get 回傳的真實 choiceId，並帶入同次回傳的 revision 作為 expectedRevision，暫留 10 分鐘。多桌需顧客明確同意分桌，才能傳 splitApproved: true。', inputSchema: { type: 'object', properties: { choiceId: { type: 'string' }, splitApproved: { type: 'boolean' }, expectedRevision: { type: 'integer', minimum: 0 } }, required: ['choiceId', 'splitApproved', 'expectedRevision'], additionalProperties: false } },
  { name: 'checkout_start', description: '顧客已明確同意目前購物車內容並表示要結帳時，依目前部署流程進入結帳。會員可能已在開始頁完成輸入；請依回傳 stage 引導。確認可以是自然語意，不要求固定字句。此工具只進入結帳，不會直接送 POS。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'checkout_skip_membership', description: '顧客明確表示略過、不使用會員或等同語意時，略過會員掃碼。不得代替顧客宣稱已掃描條碼。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'checkout_choose_invoice', description: '依顧客意思選擇手機載具或自然人憑證，顯示資料輸入；顧客說略過或捐贈發票時選 donation，不輸入捐贈碼，直接進入付款方式。這不代表已付款或已開立發票。顧客要統編時改用 checkout_request_tax_id。', inputSchema: { type: 'object', properties: { method: { type: 'string', enum: ['carrier', 'citizen', 'donation'] } }, required: ['method'], additionalProperties: false } },
  { name: 'checkout_request_tax_id', description: '顧客表示要填統編時，開啟統編輸入畫面。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'checkout_set_tax_id', description: '把顧客口說的完整 8 碼統編帶入畫面供顧客查看。只負責顯示，不會直接確認或前進付款。', inputSchema: { type: 'object', properties: { taxId: { type: 'string', pattern: '^\\d{8}$' } }, required: ['taxId'], additionalProperties: false } },
  { name: 'checkout_confirm_invoice', description: '顧客確認或送出畫面上已填妥且格式有效的發票載具資料，進入付款方式；不從模型填入或覆寫載具，不選擇付款或付款。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'checkout_confirm_tax_id', description: '顧客看過畫面上的 8 碼統編並以自然語意表示正確後確認；不要求逐字說出固定句子。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'checkout_select_payment', description: '依顧客意思選擇目前提供的付款方式，直接進入測試 QR Code 畫面，倒數5秒後自動請求模擬付款，不另問確認、不需實際掃碼或按鈕。status=selected 當下尚未付款，可更換方式；付款及訂單成功必須以後續模擬器與訂單回傳為準。', inputSchema: { type: 'object', properties: { method: { type: 'string', enum: ['card', 'mobile', 'linepay', 'jkopay'] } }, required: ['method'], additionalProperties: false } },
  { name: 'checkout_cancel', description: '顧客要求返回訂單、回到訂單頁面、離開結帳，或從發票入口返回上一頁時，返回訂單內容並保留購物車及用餐方式；不是清空訂單。不以 cart_get 或查閱對話歷史代替返回畫面。付款等待中或付款結果不明時不可取消，以免重複扣款。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'kiosk_interaction_state', description: '取得目前畫面的非敏感情境摘要，供 Kiosk host 傳給對話助手；不建立或消耗 System One 候選。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, readOnly: true },
  { name: 'kiosk_conversation_context', description: 'Host 取得本輪完整精簡菜單與最新訂單／問題；不提供給 Agent。', inputSchema: { type: 'object', properties: { includeCatalog: { type: 'boolean' } }, additionalProperties: false }, readOnly: true },
  { name: 'menu_confirm_item', description: '顧客使用未確認別稱時，提議真實菜單品項並請顧客確認原操作。餐點沒有客製選項，但顧客要求不要辣、不要蔥等製作調整時，使用 originalRecipe:true 簡短詢問是否接受原版；不可直接新增、承諾客製、解釋菜單資料或轉請店員。只建立確認問題，不新增或更換餐點；itemId 必須來自目前菜單。更換須帶顧客指定的 replaceLineId；不確定原項目先問清楚。', inputSchema: { type: 'object', properties: { itemId: { type: 'string' }, replaceLineId: { type: 'string' }, originalRecipe: { type: 'boolean' } }, required: ['itemId'], additionalProperties: false } },
  { name: 'kiosk_fast_path_context', description: '取得目前可由 Kiosk System One 選擇的語意點餐意圖。這是 Kiosk host 的內部決策資料，不提供給對話 Agent。', inputSchema: { type: 'object', properties: { transcript: { type: 'string' }, previousTranscript: { type: 'string', maxLength: 8000 }, newRequestQuestionId: { type: 'string', maxLength: 120 } }, additionalProperties: false }, readOnly: true },
  { name: 'kiosk_fast_path_execute', description: '執行目前語意候選對應的已驗證點餐操作。這是 Kiosk host 的內部決策資料，不提供給對話 Agent。', inputSchema: { type: 'object', properties: { priceChoiceId: { type: 'string' }, searchInterpretation: { type: 'string', enum: ['product', 'filter'] }, ingredientFilters: { type: 'object', properties: ingredientFilterProperties, additionalProperties: false }, candidateId: { type: 'string' } }, required: ['candidateId'], additionalProperties: false } },
  { name: 'kiosk_fast_path_continue', description: '執行一次已發出的唯讀後續步驟。僅供 Kiosk host 使用。', inputSchema: { type: 'object', properties: { candidateId: { type: 'string' } }, required: ['candidateId'], additionalProperties: false } },
  { name: 'order_ask_question', description: '取得目前流程的系統操作問題。只選 purpose，不編寫問題或選項；POS 與目前 state 決定內容，host 負責呈現一次。回傳的 questionId 由 host 在實際呈現後綁定，不可用此工具授權或執行操作。', inputSchema: { type: 'object', properties: { purpose: { type: 'string', enum: ['customer-entry', 'fulfillment', 'party-size', 'tables', 'checkout-entry', 'membership', 'invoice', 'tax-id', 'payment-method'] } }, required: ['purpose'], additionalProperties: false } },
  { name: 'order_cancel_request', description: '顧客明確撤回或改點別道時，撤回尚未入車的retainedRequests草稿。requestId必須來自當前context；不移除購物車餐點、不取消其他草稿。僅暫停／查看菜單不使用此工具。', inputSchema: { type: 'object', properties: { requestId: { type: 'string' } }, required: ['requestId'], additionalProperties: false } },
  { name: 'order_defer_question', description: '暫時擱置目前問題，保留訂單與設定。', inputSchema: { type: 'object', properties: { questionId: { type: 'string' } }, required: ['questionId'], additionalProperties: false } },
  { name: 'kiosk_dialogue_presented', description: '記錄實際呈現的回覆與問題 ID。僅供 Kiosk host 使用。', inputSchema: { type: 'object', properties: { content: { type: 'string' }, questionId: { type: 'string' }, interruptsQuestion: { type: 'boolean' } }, required: ['content'], additionalProperties: false } },
  { name: 'kiosk_question_validate', description: '呈現前驗證問題收據仍符合目前狀態。僅供 Kiosk host 使用。', inputSchema: { type: 'object', properties: { questionId: { type: 'string' } }, required: ['questionId'], additionalProperties: false } },
]
