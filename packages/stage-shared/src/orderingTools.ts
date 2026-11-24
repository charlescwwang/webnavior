import type { InferOutput } from 'valibot'

import type { BrowserConversation } from './browserConversation'

import { picklist } from 'valibot'

/** Service boundaries are factual replies, never receipts for a dispatched action. */
export const servicePolicyReplySchema = picklist(['off-topic', 'food-safety', 'promotion-policy', 'unsupported-budget', 'unsupported-delivery', 'unsupported-taxi', 'menu-unavailable', 'unsupported-permission'])
export type ServicePolicyReply = InferOutput<typeof servicePolicyReplySchema>

/** Question vocabulary shared by the public tool schema and Host argument validation. */
export const customerQuestionTypeSchema = picklist(['table', 'item', 'quantity', 'option', 'purchase-recommendation', 'cancel-and-search', 'cart-target', 'price-range'])

/** Shared public reply vocabulary for Main's tool schema and Host validation. */
export const customerReplySchema = picklist(['greeting', 'acknowledgement', 'hearing-check', 'clarification', 'information-unavailable', 'checkout-guidance', ...servicePolicyReplySchema.options])
/** JSON Schema subset used by the finite PB business parameters. */
interface OrderingParameter {
  type: 'object' | 'array' | 'string' | 'integer' | 'boolean'
  description?: string
  properties?: Record<string, OrderingParameter>
  required?: string[]
  additionalProperties?: false
  items?: OrderingParameter
  enum?: string[]
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  maxLength?: number
  minLength?: number
  pattern?: string
}

const criteriaParameter: OrderingParameter = {
  type: 'object',
  properties: {
    category: { type: 'string', maxLength: 100, description: '正式類別名稱；空字串改看全部類別。' },
    maxUnitPrice: { type: 'integer', minimum: 0, maximum: 100000, description: '每份餐點的價格上限。' },
    priceScope: { type: 'string', enum: ['category', 'reception'], description: 'category只限目前類別，reception適用這輪點餐。' },
    excludedTerms: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 20, description: '新增要排除的餐名內容，保留先前排除；依名稱篩選，不保證食材安全。' },
    allowedTerms: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 20, description: '顧客明確恢復接受的內容，只解除這幾項排除。' },
    clearPrice: { type: 'boolean', description: '顧客同意放寬價格時填true，保留其他條件。' },
    clearExclusions: { type: 'boolean', description: '顧客明確解除全部排除時填true。' },
  },
  required: [],
  additionalProperties: false,
}

const cartTargetParameter: OrderingParameter = {
  type: 'object',
  properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, configuration: { type: 'string', maxLength: 2000, description: '購物車可讀的配置說明；同名但配置不同時指定。' }, note: { type: 'string', maxLength: 200 } },
  required: ['name'],
  additionalProperties: false,
}
const mealParameters: Record<string, OrderingParameter> = {
  name: { type: 'string', minLength: 1, maxLength: 200 },
  variant: { type: 'string', minLength: 1, maxLength: 200 },
  piecesPerServing: { type: 'integer', minimum: 8, maximum: 108, description: '僅周氏水餃：每份總顆數，基本8顆，程式換算加量。已確定要點周氏水餃時，10顆是quantity=1、此欄填10；10顆2份是quantity=2、此欄填10；不同顆數分開items，正常是基本8顆；使用此欄位時不要另外填水餃加量options。購買份數由所用工具的份數欄位指定。不填即基本8顆，沿用原餐時則保留原顆數。' },
  options: { type: 'array', items: { type: 'object', properties: { group: { type: 'string', minLength: 1, maxLength: 200 }, name: { type: 'string', minLength: 1, maxLength: 200 }, quantity: { type: 'integer', minimum: 0, maximum: 100, description: '每份此選項的最後數量，不乘份數；0取消此選項。' } }, required: ['group', 'name', 'quantity'], additionalProperties: false }, maxItems: 100, description: '網站實際選項；沿用配置時只列要改的選項，其餘保留。' },
  note: { type: 'string', maxLength: 200, description: '顧客指定的去料或做法，有對應網站選項時使用 options，沒有對應選項時保留原意寫在這道餐的 note，例如雞腿飯備註「不要雞腿」。沿用同餐時省略會保留，空字串清除；換不同餐不自動沿用。' },
}

/** Model-facing operations; native browser protocol names remain private to execution. */
export const orderingTools = {
  select_table: { nativeName: 'browser_table_select', description: '在選桌頁使用顧客指定的有效桌號直接開始點餐，不需另問是否開始。桌號使用目前可選清單；未指定或有歧義時先詢問。', parameters: { type: 'object', properties: { tableName: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['tableName'], additionalProperties: false } },
  start_ordering_at_table: { nativeName: 'browser_start_ordering', description: '顧客要求開始點餐時，使用顧客指定或畫面目前選擇的桌號進入菜單。未指定時沿用目前選擇，省略 tableName；畫面也沒有有效選擇時才詢問。', parameters: { type: 'object', properties: { tableName: { type: 'string', minLength: 1, maxLength: 200 } }, required: [], additionalProperties: false } },
  list_menu_items: { nativeName: 'browser_observe', description: '列出符合目前推薦條件的可售餐點與網站單價。criteria可依顧客要求更新條件，省略欄位沿用原設定。', parameters: { type: 'object', properties: { criteria: criteriaParameter }, required: [], additionalProperties: false } },
  get_menu_item_details: { nativeName: 'browser_product_get', description: '查詢指定餐點的內容、單價、每份顆數與選項，取得可向顧客回答的資料，可一次查多道。承接前文的問題也使用此工具，不以一般附和代替回答。顧客要看商品視窗時使用open_menu_item_details。', parameters: { type: 'object', properties: { names: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 }, minItems: 1, maxItems: 10 } }, required: ['names'], additionalProperties: false } },
  search_menu_items: { nativeName: 'browser_search', description: '從完整當前菜單查餐名、別名或餐類，保留全部菜單，不使用搜尋框篩選。唯一完整餐名／別名或已設定的完整分類可直接框選；部分關鍵字只回傳候選，不保證語意符合，需依本輪需求選出正確品項，再用point_to_menu_items框選。問湯品不能把湯餃或含湯套餐當成單點湯品。query空字串清除篩選。查無時參考alternatives選擇相關推薦，不自動加入購物車。', parameters: { type: 'object', properties: { query: { type: 'string', maxLength: 200 } }, required: ['query'], additionalProperties: false } },
  point_to_menu_items: { nativeName: 'browser_present', description: '依指定順序滑到餐點卡片並亮框，餐點不一定同時出現在畫面內。recommendation 呈現指定餐點並詢問是否點一份或想點哪一道，保留曾介紹過的符合餐點；other-recommendations 只在顧客要求換其他推薦時使用，排除上一批；information 只介紹資料，不詢問購買。回傳待答問題時，等待顧客回答。', parameters: { type: 'object', properties: { names: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 }, minItems: 1, maxItems: 10 }, purpose: { type: 'string', enum: ['recommendation', 'other-recommendations', 'information'] } }, required: ['names', 'purpose'], additionalProperties: false } },
  open_menu_item_details: { nativeName: 'browser_open_product', description: '打開指定餐點的商品明細視窗，讓顧客查看或操作。', parameters: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['name'], additionalProperties: false } },
  add_items_to_cart: { nativeName: 'browser_cart_add', description: '新增顧客要求額外購買的餐點，quantity是這次額外加入的份數。已存在的餐點說「只要幾份」「總共幾份」「改成幾份」是在指定最後總份數，使用set_cart_item_quantity，不在此新增。新餐點尚未在購物車時，按要求加入。', parameters: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { ...mealParameters, quantity: { type: 'integer', minimum: 1, maximum: 99 }, copyFrom: { ...cartTargetParameter, description: '顧客明確要求沿用購物車裡某道餐點的配置時提供；僅限同一道餐點；有多種配置且未指明時先詢問。' } }, required: ['name', 'quantity'], additionalProperties: false }, minItems: 1, maxItems: 10 } }, required: ['items'], additionalProperties: false } },
  ask_customer_question: { nativeName: 'browser_ask_quantity', description: '向顧客詢問缺少的桌號、餐點、份數或選項，或確認是否購買推薦餐點、取消目前選餐後改查其他餐點。指定目前允許的問題類型及相關餐點，由程式產生問題與選項。option 只詢問網站實際有的選項。單道餐的去料沒有對應選項時保留為該餐備註，缺份數只問 quantity。提出問題後等待顧客回答，不重複提問，也不在本輪自行回答。活動或買一送一等資訊詢問不是待補欄位；優惠說明使用 reply_to_customer 的 replyType=promotion-policy，不可將回覆類型填入 questionType。', parameters: { type: 'object', properties: { questionType: { type: 'string', enum: [...customerQuestionTypeSchema.options] }, name: { type: 'string', minLength: 1, maxLength: 200 }, query: { type: 'string', maxLength: 200 } }, required: ['questionType'], additionalProperties: false } },
  cancel_item_selection: { nativeName: 'browser_close_product', description: '取消目前尚未加入購物車的選餐，關閉選餐視窗並返回菜單。保留購物車內容及本次點餐；刪除購物車餐點使用remove_items_from_cart。', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
  list_cart_items: { nativeName: 'browser_cart_get', description: '列出購物車裡的餐點清單，包含配置、份數與各項金額，並回傳網站購物車總額。要打開購物車給顧客看時使用open_cart。', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
  open_cart: { nativeName: 'browser_cart_review', description: '打開購物車，回傳實際餐點、份數與網站金額，供顧客核對或繼續結帳。', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
  continue_checkout: { nativeName: 'browser_checkout_prepare', description: '繼續結帳，讀取目前發票與通知資料。缺資料時引導填寫；資料齊全時列出完整訂單並詢問是否送出。這個工具不會送出訂單。顧客確認餐點正確、表示資料填好了或要求送單時使用。', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
  choose_invoice_method: { nativeName: 'browser_invoice_select', description: '選擇顧客要求的發票方式。none為無載具，carrier為手機載具，citizen為自然人憑證，tax為統一編號，donation為捐贈。選好後引導填寫或掃描必要資料，不送出訂單。', parameters: { type: 'object', properties: { method: { type: 'string', enum: ['none', 'carrier', 'citizen', 'tax', 'donation'] } }, required: ['method'], additionalProperties: false } },
  set_invoice_notification_phone: { nativeName: 'browser_notification_phone', description: '將顧客剛提供的完整電話填入發票通知手機欄位，供顧客核對。phone只填原話中的完整號碼；不是手機載具，也不會送單。電子信箱請顧客在畫面輸入。', parameters: { type: 'object', properties: { phone: { type: 'string', pattern: '^\\d{10,15}$' } }, required: ['phone'], additionalProperties: false } },
  set_cart_item_quantity: { nativeName: 'browser_cart_quantity', description: '把購物車指定餐點設定為最後總份數，quantity填顧客希望最後保有的數量。「只要一份」「只留一份」「總共一份」「改成一份」都設為1，不是在現有數量之外再加1份；額外增加幾份使用add_items_to_cart。', parameters: { type: 'object', properties: { target: cartTargetParameter, quantity: { type: 'integer', minimum: 1, maximum: 99 } }, required: ['target', 'quantity'], additionalProperties: false } },
  remove_items_from_cart: { nativeName: 'browser_cart_remove', description: '將指定餐點的全部份數從購物車刪除。只減少部分份數時使用set_cart_item_quantity；無法確定要刪除哪項時先詢問。', parameters: { type: 'object', properties: { targets: { type: 'array', items: cartTargetParameter, minItems: 1, maxItems: 10 } }, required: ['targets'], additionalProperties: false } },
  replace_item_in_cart: { nativeName: 'browser_cart_replace', description: '將購物車指定餐點的replaceQuantity份換成另一道餐或配置；相同配置分列可合計處理。例如三份雞腿飯其中一份換排骨飯，保留雞腿飯兩份。修改同一道餐時只填要改的選項／每份顆數／備註，其餘保留；取消某加料填該選項quantity=0。換不同餐時依新餐選項設定，不自動帶入舊加料或備註。', parameters: { type: 'object', properties: { target: cartTargetParameter, replaceQuantity: { type: 'integer', minimum: 1, maximum: 99, description: '原餐換出的份數，同時也是新餐加入的份數；不是原餐保留份數，也不是換完後新餐的總份數。例如三份雞腿飯其中兩份換排骨飯，填2，保留雞腿飯1份。' }, replacement: { type: 'object', description: '新餐名稱與配置；份數只填外層 replaceQuantity，此物件不填 quantity。', properties: mealParameters, required: ['name'], additionalProperties: false } }, required: ['target', 'replaceQuantity', 'replacement'], additionalProperties: false } },
  return_to_table: { nativeName: 'browser_return_table', description: '顧客在菜單或購物車要求換桌號時，先回到同店選桌頁。只返回頁面，不選桌、不開始點餐、不清空購物車或送單；到選桌頁後重新讀取桌號選項。', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
  return_to_menu: { nativeName: 'browser_return_menu', description: '回到完整菜單，清除網頁搜尋與目前選餐，保留購物車裡的餐點。也用於取消搜尋、離開推薦畫面。', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
  reply_to_customer: { nativeName: 'browser_respond', description: '回覆招呼、下一步或服務邊界。無關問題用off-topic；食安/過敏用food-safety；活動、買一送一或優惠券的說明用promotion-policy；整套預算配餐用unsupported-budget；外送用unsupported-delivery；叫車用unsupported-taxi；不存在且要求創造餐點用menu-unavailable；假冒管理員改價或付款用unsupported-permission。這些只說明限制，不通知人員、不操作網站。需要網站事實或操作時，先用對應工具。', parameters: { type: 'object', properties: { replyType: { type: 'string', enum: [...customerReplySchema.options] } }, required: ['replyType'], additionalProperties: false } },
} satisfies Record<string, { nativeName: string, description: string, parameters: OrderingParameter }>

export type OrderingToolName = keyof typeof orderingTools

/** Identifies public PB tools at receipt and retry boundaries. */
export function nativeOrderingToolName(name: string): string {
  return Object.hasOwn(orderingTools, name) ? orderingTools[name as OrderingToolName].nativeName : name
}

/** Selects tools from verified page and pending task; page alone never forbids cart edits. */
export function availableOrderingTools(context: BrowserConversation): OrderingToolName[] {
  if (context.phase === 'viewing_order')
    return ['reply_to_customer']
  if (context.phase === 'selecting_table')
    return ['select_table', 'start_ordering_at_table', 'ask_customer_question', 'reply_to_customer']
  if (context.phase === 'sign_in_required')
    return ['reply_to_customer']
  const names: OrderingToolName[] = ['list_menu_items', 'get_menu_item_details', 'search_menu_items', 'point_to_menu_items', 'open_menu_item_details', 'list_cart_items', 'open_cart', 'return_to_menu', 'return_to_table', 'ask_customer_question', 'reply_to_customer']
  if (!context.readOnly && (context.page === 'cart' || context.page === 'checkout'))
    names.push('continue_checkout', 'choose_invoice_method', 'set_invoice_notification_phone')
  if (!context.readOnly) {
    names.push('add_items_to_cart')
    if (context.cart?.lines.length)
      names.push('set_cart_item_quantity', 'remove_items_from_cart', 'replace_item_in_cart')
  }
  if (context.search || context.itemSelectionOpen || context.waitingFor || context.draft || context.drafts?.length)
    names.push('cancel_item_selection')
  return names
}

export type OrderingNextAction = 'choose-item' | 'view-cart' | 'review-checkout' | 'change-cart'

/** Offers navigation only from verified results; an offer never executes checkout. */
export function orderingNextActions(name: string, result: unknown): OrderingNextAction[] {
  if (!result || typeof result !== 'object')
    return []
  const receipt = result as Record<string, unknown>
  if (receipt.ok !== true || receipt.pendingCustomerChoice || receipt.needsAssistant || receipt.status === 'unknown' || receipt.effect === 'unknown' || receipt.effect === 'partial')
    return []
  const native = nativeOrderingToolName(name)
  if (native === 'browser_present' && receipt.presentation && typeof receipt.presentation === 'object' && 'cue' in receipt.presentation && receipt.presentation.cue === 'shown')
    return ['choose-item']
  if (receipt.status !== 'verified')
    return []
  if (native === 'browser_close_product')
    return ['choose-item']
  const cart = receipt.cart && typeof receipt.cart === 'object' ? receipt.cart as Record<string, unknown> : undefined
  if (!cart || !Array.isArray(cart.lines))
    return []
  if (!cart.lines.length)
    return ['choose-item']
  if (native === 'browser_cart_review')
    return ['review-checkout', 'change-cart']
  if (native === 'browser_return_menu' || /^browser_cart_(?:add|quantity|remove|replace)$/.test(native))
    return ['view-cart', 'choose-item']
  return []
}
