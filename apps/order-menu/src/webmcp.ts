import type { RecommendationStrategy } from '../../order-menu-server/src/domain/recommendation'
import type { KioskScreen } from '../../server/src/services/domain/kiosk-interaction-decision/contracts'
import type { PriceConditions } from '../../server/src/services/domain/kiosk-interaction-decision/priceContracts'
import type { CheckoutSnapshot, InvoiceMethod } from './domain/checkout-flow'
import type { IngredientFilters } from './domain/composition'
import type { CartSnapshot, FulfillmentMode, MenuItem, PosOrderGateway, RecommendationTag, Selection, SubmittedOrder } from './domain/order-machine'
import type { SeatingContext } from './domain/seating'
import type { DecisionContext, DomainPlan, DomainReference, IntentCandidate, KioskRevisions, OperationPlan, PendingConfirmation, PendingQuestion } from './kiosk-intents'
import type { ScrollDirection, ScrollResult } from './menuScroll'

import { errorMessageFrom } from '@moeru/std'

import { ingredientDefinitions, vegetarianIngredients } from '../../order-menu-server/src/domain/composition'
import { currentRecommendationSignal } from '../../order-menu-server/src/domain/recommendation'
import { emptyFilterMessage, filterAvailability, filterIngredients, ingredientFilters } from './domain/composition'
import { catalogInfo, createOrderMachine } from './domain/order-machine'
import { filterPrices, intersectPrices, priceClarification, priceConditions, priceDescription, priceProperties } from './domain/pricing'
import { authorize, buildClarificationPrompt, compileOperationPlan, configurationQuestion, createConfirmation, createQuestion, deriveDecisionContext, questionIsCurrent, resolveClarificationReference, resolveIntent, targetReferenceLimit, validateConfirmation } from './kiosk-intents'

export type MenuToolName
  = | 'menu_get'
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
    | 'order_set_fulfillment'
    | 'order_set_party_size'
    | 'order_defer_question'
    | 'order_ask_question'
    | 'seating_get'
    | 'seating_reserve'
    | 'checkout_start'
    | 'checkout_skip_membership'
    | 'checkout_choose_invoice'
    | 'checkout_request_tax_id'
    | 'checkout_set_tax_id'
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

export type MenuPresentationToolName = 'menu_get' | 'menu_recommend' | 'menu_show_recommendations'

type KioskHostOnlyToolName = 'kiosk_interaction_state' | 'kiosk_fast_path_context' | 'kiosk_fast_path_execute' | 'kiosk_fast_path_continue' | 'kiosk_dialogue_presented' | 'kiosk_question_validate' | 'kiosk_agent_task'
const kioskHostOnlyToolNames = new Set<MenuToolName>(['kiosk_interaction_state', 'kiosk_fast_path_context', 'kiosk_fast_path_execute', 'kiosk_fast_path_continue', 'kiosk_dialogue_presented', 'kiosk_question_validate', 'kiosk_agent_task'])

function isKioskHostOnlyToolName(name: MenuToolName): name is KioskHostOnlyToolName {
  return kioskHostOnlyToolNames.has(name)
}

export interface MenuPresentationActivity {
  state: 'idle' | 'loading'
  toolName: MenuPresentationToolName
}

export interface AgentAction {
  controlId?: string
  expandCustomization?: boolean
  label: string
  targetId?: string
}

type FastPathRevisions = Partial<KioskRevisions>

interface IssuedFastPathContext {
  candidates: Map<string, IntentCandidate>
  context: DecisionContext
  expiresAt: number
  /** Correlates a new-request route with the retained question it interrupted. */
  interruptedQuestion?: { kind: 'configuration' | 'clarification', id: string }
}

interface PendingFastPathClarification {
  id: string
  candidate: IntentCandidate
  candidateRefs: string[]
  context: DecisionContext
  expectedRevisions: FastPathRevisions
  /** Short-lived answer authority, renewed only for a new customer utterance. */
  issued?: { id: string, expiresAt: number, transcript: string }
}

interface PendingFastPathConfirmation {
  cart: string
  operation: OperationPlan
  record: PendingConfirmation
}

interface PendingConfiguration {
  id: string
  plan: DomainPlan
  /** Only choices issued by the latest snapshot may complete this session. */
  issued?: { id: string, expiresAt: number, transcript: string, choices: Map<string, IntentCandidate> }
}

/** One customer-mentioned subject retained by a query-result presentation. */
export interface QueryPresentationSubject {
  id: string
  itemIds: string[]
  label: string
}

/** A customer-facing collection chosen from the current menu catalog. */
export interface RecommendationPresentation {
  kind: 'query-results' | 'recommendation'
  itemIds: string[]
  reason?: string
  /** Query-result subjects remain available even when the default grid is full. */
  subjects?: QueryPresentationSubject[]
  title?: string
}

const presentationToolNames = new Set<MenuPresentationToolName>([
  'menu_get',
  'menu_recommend',
  'menu_show_recommendations',
])

export function isMenuPresentationTool(name: MenuToolName): name is MenuPresentationToolName {
  return presentationToolNames.has(name as MenuPresentationToolName)
}

function menuPresentationToolFor(name: MenuToolName, input: Record<string, unknown>): MenuPresentationToolName | undefined {
  if (!isMenuPresentationTool(name))
    return undefined
  if (name !== 'menu_get')
    return name

  // A complete catalog read does not replace the menu grid. Reserve the
  // loading surface for filtered lookups that will visibly change it.
  const { category, queries } = getMenuQuery(input)
  return category || queries.length > 0 || input.display === true || input.excludeIngredients !== undefined || input.includeIngredients !== undefined ? name : undefined
}

/** Returns the DOM control identifier used to visually follow an AI option change. */
export function optionControlId(itemId: string, groupId: string, valueId: string) {
  return `${itemId}:option:${groupId}:${valueId}`
}

/** Returns the DOM control identifier used to visually follow an AI quantity change. */
export function quantityControlId(itemId: string) {
  return `${itemId}:quantity`
}

/** Returns the DOM control identifier used to visually follow a service-mode change. */
export function fulfillmentControlId(mode: FulfillmentMode) {
  return `order:fulfillment:${mode}`
}

/** Returns the DOM control identifier for the selected item's add action. */
export function addItemControlId(itemId: string) {
  return `${itemId}:add`
}

interface MenuToolDefinition {
  description: string
  inputSchema: Record<string, unknown>
  name: MenuToolName
  readOnly?: boolean
}

export interface CheckoutToolController {
  assertCanRestart: () => void
  cancel: () => unknown
  chooseInvoice: (method: Exclude<InvoiceMethod, 'tax-id'>) => CheckoutSnapshot
  confirmTaxId: () => CheckoutSnapshot
  requestTaxId: () => CheckoutSnapshot
  paymentStatus: () => 'pending' | 'uncertain' | undefined
  revision: () => number
  restart: () => void
  selectPayment: (method: 'card' | 'mobile') => Promise<{ customerMessage: string, status: string }>
  setTaxId: (taxId: string) => CheckoutSnapshot
  skipMembership: () => CheckoutSnapshot
  snapshot: () => CheckoutSnapshot | undefined
  start: () => CheckoutSnapshot
}

interface MenuToolRuntimeOptions {
  /** Read the same reactive state that owns the visible browser surface. */
  screen?: () => KioskScreen
  fulfillmentModes?: readonly { id: FulfillmentMode, label: string }[]
  /** Optional venue capability, backed by POS rather than browser-local seats. */
  seating?: {
    context: () => SeatingContext
    refresh: () => Promise<void>
    release: () => Promise<void>
    setPartySize: (value: number) => Promise<void>
    reserve: (choiceId: string, splitApproved: boolean, expectedRevision: number) => Promise<void>
    reset: () => Promise<void>
  }
  /** Routes Agent checkout actions through the same state transitions as visible controls. */
  checkout?: CheckoutToolController
  /** Submits confirmed carts to the current ordering environment. */
  gateway?: PosOrderGateway
  /** Initial POS catalog. The browser must not substitute a local menu on failure. */
  menu?: MenuItem[]
  onAction: (action: AgentAction) => Promise<void> | void
  onCartChange: (cart: CartSnapshot) => void
  /** Reveals review controls and waits for their DOM registration before cursor animation. */
  onReviewRequested?: () => Promise<void> | void
  /** Returns to ordering without cancelling checkout or clearing any cart line. */
  onMenuRequested?: () => Promise<void> | void
  onMenuSelection: (itemId: string | undefined) => void
  /** Browser-owned viewport movement; unavailable hosts do not advertise this tool. */
  onMenuScroll?: (direction: ScrollDirection) => ScrollResult
  /** Mirrors an order-level dine-in or self-pickup choice into the menu UI. */
  onFulfillmentChange?: (mode: FulfillmentMode | undefined) => void
  /** Mirrors the active tool selection into the menu UI. */
  onSelectionChange?: (selection: Selection) => void
  /** Notifies the embedding host after the first successfully confirmed order. */
  onOrderConfirmed?: (order: SubmittedOrder) => void
  /** Mirrors every final POS receipt into the visible customer flow. */
  onOrderSubmission?: (order: SubmittedOrder) => void
  /** Requests a non-blocking recommendation rail in the human menu UI. */
  onRecommendationsChange?: (presentation: RecommendationPresentation) => void
  /** Keeps visible loading feedback aligned with actual menu-rendering tools. */
  onMenuPresentationActivity?: (activity: MenuPresentationActivity) => Promise<void> | void
}

interface ModelContextLike {
  registerTool: (tool: {
    name: string
    description: string
    inputSchema: Record<string, unknown>
    annotations?: { readOnlyHint?: boolean }
    exposedTo?: string[]
    execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>
  }, options?: { exposedTo?: string[], signal?: AbortSignal }) => Promise<unknown>
}

/**
 * WebMCP names are scoped to the iframe document, not to one Vue runtime.
 * Keeping the active controller on that document lets a Vite replacement
 * release the preceding runtime's tools before it registers the same names.
 */
type WebMcpDocument = Document & {
  __webnaviorOrderMenuNativeWebMcpRegistration__?: AbortController
  modelContext?: ModelContextLike
}

const ingredientFilterProperties = {
  dietary: { type: 'string', enum: ['vegetarian'], description: '素食需求。需 POS 明確素食標示才列為符合；不能僅以缺少肉類成分推論。更嚴格或未支援的飲食條件不可省略或弱化。' },
  excludeIngredients: { type: 'array', items: { type: 'string', enum: ingredientDefinitions.map(definition => definition.id) }, maxItems: ingredientDefinitions.length, uniqueItems: true, description: '排除成分 ID。依成分表篩選；不代表過敏安全，也不自動移除食材。' },
  includeIngredients: { type: 'array', items: { type: 'string', enum: ingredientDefinitions.map(definition => definition.id) }, maxItems: ingredientDefinitions.length, uniqueItems: true, description: '必須含有的成分 ID；與排除條件取交集。' },
}

const toolDefinitions: MenuToolDefinition[] = [
  { name: 'menu_open', description: '回到菜單繼續點餐，保留購物車。只能在尚未結帳時使用；不取消結帳、不開始付款。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'menu_scroll', description: '向上或向下查看一個畫面高度的菜單。只移動畫面，不選餐點、不新增訂單、不換推薦批次。到邊界時不再移動。', inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['UP', 'DOWN'] } }, required: ['direction'], additionalProperties: false } },
  { name: 'kiosk_agent_task', description: 'Kiosk host 綁定或結束目前 Agent 任務的已解析限制；不是 Agent 可選工具。', inputSchema: { type: 'object', properties: { taskId: { type: 'string', minLength: 1 }, action: { type: 'string', enum: ['BEGIN', 'END'] }, expectedMenuRevision: { type: 'integer', minimum: 0 }, constraints: { type: 'object', properties: { ...ingredientFilterProperties, ...priceProperties, unresolvedPrice: { type: 'boolean' } }, additionalProperties: false } }, required: ['taskId', 'action'], additionalProperties: false } },
  { name: 'menu_get', description: '價格條件僅限單份基本售價，按真實價格篩選與排序，最多展示三項；不計算多份或整筆預算。左右、更便宜等未解析条件應先詢問明確單份價格，不得忽略。價格顯示在卡片，不必口頭朗讀。依分類、餐點名稱或食材／飲食條件精確查詢可點餐品項與 ID。顧客泛問有賣什麼、要求看全部或更多選擇時，不展開或朗讀完整菜單；無篩選的顧客查詢每次最多回傳三項推薦，有有效批次時保留原條件並換下一批。要直接推薦請使用 menu_recommend。display:false 僅供內部資料查詢，不得拿完整結果逐項介紹給顧客。帶 category、query 或 queries 的查詢會把最多四項相關餐點非阻斷地顯示在菜單上。顧客一次提到兩道以上餐點時，必須在同一次呼叫以 queries 傳入每一道名稱，讓畫面同時呈現所有符合品項；不可只查其中一道。顧客問某個分類有哪些品項時，先查詢後直接列出並口頭說明本次回傳、符合該分類的品項，不可只說「有幾種」或叫顧客自己看畫面。後續選擇餐點必須使用本工具結果中的 item.id。', inputSchema: { type: 'object', properties: { ...ingredientFilterProperties, ...priceProperties, display: { type: 'boolean', description: 'Agent 預設展示查詢結果；無篩選時最多三項推薦，有有效批次則換批。false 僅供內部讀取資料，不展開完整菜單給顧客。' }, category: { type: 'string', description: '要查詢的精確分類名稱；未知時省略。' }, query: { type: 'string', description: '顧客說出的一道餐點名稱或關鍵字；未知時省略。' }, queries: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 4, uniqueItems: true, description: '顧客一次提到多道餐點時使用；每個元素是一道餐點名稱或關鍵字。' } }, additionalProperties: false } },
  { name: 'menu_recommend', description: '價格條件僅限單份基本售價，按真實價格篩選與排序，最多展示三項；不計算多份或整筆預算。左右、更便宜等未解析条件應先詢問明確單份價格，不得忽略。價格顯示在卡片，不必口頭朗讀。依真實菜單與條件推薦最多三項不同餐點並展示；未指定 limit 時最多三項，符合不足時不硬湊。顧客追問其他推薦或換一批時使用 more:true：程式保留原條件、排除這次推薦歷程中已提供的餐點；不要改查完整菜單。新推薦需求省略 more，不繼承舊條件。needs 僅使用已明示的 rice 飯類、fried 炸物；食材使用 includeIngredients / excludeIngredients。依回傳品名回答，未知與需客製品項不可宣稱符合；不自行列出或猜測熱門度。', inputSchema: { type: 'object', properties: { ...ingredientFilterProperties, ...priceProperties, category: { type: 'string' }, query: { type: 'string' }, queries: { type: 'array', items: { type: 'string' }, maxItems: 4 }, more: { type: 'boolean', description: '換下一批推薦，保留條件並排除已推薦品項。需要尚有效的推薦歷程。' }, needs: { type: 'array', items: { type: 'string', enum: ['rice', 'fried'] }, minItems: 1, uniqueItems: true }, limit: { type: 'integer', minimum: 1, maximum: 3, description: '預設最多三項；顧客明確只要一或兩項時可縮小。' } }, additionalProperties: false } },
  { name: 'menu_show_recommendations', description: '在菜單中非阻斷地展示 1 至 4 項推薦。只可在顧客明確表示想看推薦後使用。itemIds 必須全部來自先前 menu_get 或 menu_recommend 的回傳結果；不得自行猜測品項。可附簡短標題與理由，但不得加入未提供的健康、過敏或供應資訊。回覆時直接說出實際推薦品名，不要只叫顧客看畫面。', inputSchema: { type: 'object', properties: { itemIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4, uniqueItems: true, description: '必要。先前菜單工具回傳的 item.id。' }, reason: { type: 'string', maxLength: 90, description: '可選。給顧客看的簡短搭配理由。' }, title: { type: 'string', maxLength: 36, description: '可選。推薦列標題。' } }, required: ['itemIds'], additionalProperties: false } },
  { name: 'menu_select_item', description: '選擇一個餐點並建立可設定的選擇。呼叫前必須先使用 menu_get，並傳入其結果中完全相同的 item.id。', inputSchema: { type: 'object', properties: { itemId: { type: 'string', description: '必要。先前 menu_get 回傳的其中一個 item.id；不得猜測、翻譯或自行建立。' } }, required: ['itemId'], additionalProperties: false } },
  { name: 'menu_set_item_option', description: '設定目前餐點的口味、辣度、甜度或冰量。groupId 與 valueId 必須來自 menu_select_item 回傳的 item.optionGroups。', inputSchema: { type: 'object', properties: { groupId: { type: 'string', description: '必要。已選餐點 optionGroups 中的 group.id。' }, valueId: { type: 'string', description: '必要。該 group.values 中的 value.id。' } }, required: ['groupId', 'valueId'], additionalProperties: false } },
  { name: 'menu_set_quantity', description: '設定目前餐點的數量。只可在 menu_select_item 後、cart_add_item 前使用。', inputSchema: { type: 'object', properties: { quantity: { type: 'integer', minimum: 1, maximum: 20, description: '必要。顧客指定的整數數量；未指定時使用 1。' } }, required: ['quantity'], additionalProperties: false } },
  { name: 'order_add_item', description: '一次完成一個已確認餐點的選擇、已知客製化、數量與加入購物車。顧客指定品項與所有必要客製化後，優先使用此工具，避免逐步呼叫 menu_select_item、menu_set_item_option、menu_set_quantity、cart_add_item。itemId、options 的 groupId 與 valueId 必須來自 menu_get 的結果。', inputSchema: { type: 'object', properties: { itemId: { type: 'string', description: '必要。menu_get 回傳的其中一個 item.id。' }, options: { type: 'array', description: '顧客明確指定的客製化；未指定的選項保留該品項預設值。', items: { type: 'object', properties: { groupId: { type: 'string' }, valueId: { type: 'string' } }, required: ['groupId', 'valueId'], additionalProperties: false } }, quantity: { type: 'integer', minimum: 1, maximum: 20, description: '顧客指定的數量；省略時為 1。' } }, required: ['itemId'], additionalProperties: false } },
  { name: 'cart_add_item', description: '將目前已設定的餐點加入購物車。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cart_remove_item', description: '從購物車移除一個 cart line。先用 cart_get 取得正確的 lineId。顧客要求移除時，必須先執行本工具並確認成功，才能告知顧客已移除；不得只說會移除。', inputSchema: { type: 'object', properties: { lineId: { type: 'string', description: '必要。cart_get 回傳的其中一個 cart.lines[].id。' } }, required: ['lineId'], additionalProperties: false } },
  { name: 'cart_set_line_quantity', description: '直接調整購物車中一個餐點的數量，不要先移除再重新加入。先用 cart_get 取得正確的 lineId；成功後依回傳 cart 確認數量與總額。', inputSchema: { type: 'object', properties: { lineId: { type: 'string', description: '必要。cart_get 回傳的其中一個 cart.lines[].id。' }, quantity: { type: 'integer', minimum: 1, description: '必要。調整後的正整數數量。' } }, required: ['lineId', 'quantity'], additionalProperties: false } },
  { name: 'cart_set_line_option', description: '直接修改購物車中一個餐點的單一客製選項，不要先移除再重新加入。先用 cart_get 取得 lineId；groupId 和 valueId 必須來自該餐點先前由 menu_get 回傳的 optionGroups。若修改後與另一筆選項完全相同，系統會合併數量並回傳保留的 line。', inputSchema: { type: 'object', properties: { lineId: { type: 'string', description: '必要。cart_get 回傳的其中一個 cart.lines[].id。' }, groupId: { type: 'string', description: '必要。該餐點 optionGroups 中的 group.id。' }, valueId: { type: 'string', description: '必要。該 group.values 中的 value.id。' } }, required: ['lineId', 'groupId', 'valueId'], additionalProperties: false } },
  { name: 'cart_clear', description: '清空尚未送出的購物車。僅在顧客明確表示取消全部餐點、重新開始或等同語意時使用；先以 cart_get 確認目前內容。清空後原本的內用／自取選擇也會移除。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true, description: '必要。只有顧客已明確要求清空時才可設為 true。' } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'cart_get', description: '取得購物車、品項數與總額，預設展示訂單及 POS 用餐方式選項。不取代正在進行的結帳畫面；只讀資料而不切換畫面時指定 display:false。', inputSchema: { type: 'object', properties: { display: { type: 'boolean', description: '預設展示訂單；false 僅讀取資料，不切換画面。' } }, additionalProperties: false }, readOnly: true },
  { name: 'order_set_fulfillment', description: '設定整筆訂單的用餐方式。只使用 menu_get 回傳的 fulfillmentModes 與 POS 選項名稱；尚未告知時以 order_ask_question 取得系統問題，不另行編寫。必須在 checkout_start 前完成。', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['dine-in', 'takeout'], description: '必要。必須為 POS fulfillmentModes 提供的 id，對顧客使用該選項的 label。' } }, required: ['mode'], additionalProperties: false } },
  { name: 'order_set_party_size', description: '設定內用人數（1 至 20 位），與餐點數量不同。修改人數會釋放原暫留桌位，再顯示目前可選桌位。', inputSchema: { type: 'object', properties: { partySize: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['partySize'], additionalProperties: false } },
  { name: 'seating_get', description: '查詢本次內用人數與目前真實可用桌位組合；不保留桌位。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, readOnly: true },
  { name: 'seating_reserve', description: '選擇 seating_get 回傳的真實 choiceId，並帶入同次回傳的 revision 作為 expectedRevision，暫留 10 分鐘。多桌需顧客明確同意分桌，才能傳 splitApproved: true。', inputSchema: { type: 'object', properties: { choiceId: { type: 'string' }, splitApproved: { type: 'boolean' }, expectedRevision: { type: 'integer', minimum: 0 } }, required: ['choiceId', 'splitApproved', 'expectedRevision'], additionalProperties: false } },
  { name: 'checkout_start', description: '顧客已明確同意目前購物車內容並表示要結帳時，開啟會員掃碼步驟。確認可以是自然語意，不要求固定字句。此工具只進入結帳，不會直接送 POS。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'checkout_skip_membership', description: '顧客明確表示略過、不使用會員或等同語意時，略過會員掃碼。不得代替顧客宣稱已掃描條碼。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'checkout_choose_invoice', description: '依顧客意思選擇已掃描的雲端發票載具或捐贈。未實際掃描或帶入載具時不可選 carrier；顧客要統編時改用 checkout_request_tax_id。', inputSchema: { type: 'object', properties: { method: { type: 'string', enum: ['carrier', 'donation'] } }, required: ['method'], additionalProperties: false } },
  { name: 'checkout_request_tax_id', description: '顧客表示要填統編時，開啟統編輸入畫面。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'checkout_set_tax_id', description: '把顧客口說的完整 8 碼統編帶入畫面供顧客查看。只負責顯示，不會直接確認或前進付款。', inputSchema: { type: 'object', properties: { taxId: { type: 'string', pattern: '^\\d{8}$' } }, required: ['taxId'], additionalProperties: false } },
  { name: 'checkout_confirm_tax_id', description: '顧客看過畫面上的 8 碼統編並以自然語意表示正確後確認；不要求逐字說出固定句子。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'checkout_select_payment', description: '依顧客選擇啟動信用卡或行動支付終端。這只選擇方式並等待終端；不得宣稱付款成功，實際刷卡、掃碼與授權必須由顧客及支付終端完成。', inputSchema: { type: 'object', properties: { method: { type: 'string', enum: ['card', 'mobile'] } }, required: ['method'], additionalProperties: false } },
  { name: 'checkout_cancel', description: '顧客明確表示取消本次結帳時返回訂單內容並保留購物車。付款等待中或付款結果不明時不可取消，以免重複扣款。', inputSchema: { type: 'object', properties: { confirmedByUser: { type: 'boolean', const: true } }, required: ['confirmedByUser'], additionalProperties: false } },
  { name: 'kiosk_interaction_state', description: '取得目前畫面的非敏感情境摘要，供 Kiosk host 傳給對話助手；不建立或消耗 System One 候選。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, readOnly: true },
  { name: 'kiosk_fast_path_context', description: '取得目前可由 Kiosk System One 選擇的語意點餐意圖。這是 Kiosk host 的內部決策資料，不提供給對話 Agent。', inputSchema: { type: 'object', properties: { transcript: { type: 'string' }, previousTranscript: { type: 'string', maxLength: 8000 }, newRequestQuestionId: { type: 'string', maxLength: 120 } }, additionalProperties: false }, readOnly: true },
  { name: 'kiosk_fast_path_execute', description: '執行目前語意候選對應的已驗證點餐操作。這是 Kiosk host 的內部決策資料，不提供給對話 Agent。', inputSchema: { type: 'object', properties: { priceChoiceId: { type: 'string' }, searchInterpretation: { type: 'string', enum: ['product', 'filter'] }, ingredientFilters: { type: 'object', properties: ingredientFilterProperties, additionalProperties: false }, candidateId: { type: 'string' } }, required: ['candidateId'], additionalProperties: false } },
  { name: 'kiosk_fast_path_continue', description: '執行一次已發出的唯讀後續步驟。僅供 Kiosk host 使用。', inputSchema: { type: 'object', properties: { candidateId: { type: 'string' } }, required: ['candidateId'], additionalProperties: false } },
  { name: 'order_ask_question', description: '取得目前流程的系統操作問題。只選 purpose，不編寫問題或選項；POS 與目前 state 決定內容，host 負責呈現一次。回傳的 questionId 由 host 在實際呈現後綁定，不可用此工具授權或執行操作。', inputSchema: { type: 'object', properties: { purpose: { type: 'string', enum: ['fulfillment', 'party-size', 'tables', 'checkout-entry', 'membership', 'invoice', 'tax-id', 'payment-method'] } }, required: ['purpose'], additionalProperties: false } },
  { name: 'order_defer_question', description: '暫時擱置目前問題，保留訂單與設定。', inputSchema: { type: 'object', properties: { questionId: { type: 'string' } }, required: ['questionId'], additionalProperties: false } },
  { name: 'kiosk_dialogue_presented', description: '記錄實際呈現的回覆與問題 ID。僅供 Kiosk host 使用。', inputSchema: { type: 'object', properties: { content: { type: 'string' }, questionId: { type: 'string' } }, required: ['content'], additionalProperties: false } },
  { name: 'kiosk_question_validate', description: '呈現前驗證問題收據仍符合目前狀態。僅供 Kiosk host 使用。', inputSchema: { type: 'object', properties: { questionId: { type: 'string' } }, required: ['questionId'], additionalProperties: false } },
]

function requiredString(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${key} is required.`)
  return value
}

function requiredNumber(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (typeof value !== 'number')
    throw new Error(`${key} is required.`)
  return value
}

function checkoutControllerOrThrow(controller: CheckoutToolController | undefined) {
  if (!controller)
    throw new Error('Checkout controls are unavailable in this environment.')
  return controller
}

function requiredInvoiceMethod(input: Record<string, unknown>) {
  if (input.method !== 'carrier' && input.method !== 'donation')
    throw new Error('method must be carrier or donation.')
  return input.method
}

function requiredPaymentMethod(input: Record<string, unknown>) {
  if (input.method !== 'card' && input.method !== 'mobile')
    throw new Error('method must be card or mobile.')
  return input.method
}

function requiredFulfillmentMode(input: Record<string, unknown>): FulfillmentMode {
  const mode = requiredString(input, 'mode')
  if (mode === 'dine-in' || mode === 'takeout')
    return mode
  throw new Error('mode must be dine-in or takeout.')
}

interface ItemOptionInput {
  groupId: string
  valueId: string
}

function itemOptionInputs(input: Record<string, unknown>): ItemOptionInput[] {
  if (input.options === undefined)
    return []
  if (!Array.isArray(input.options))
    throw new Error('options must be an array.')

  const seenGroupIds = new Set<string>()
  return input.options.map((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option))
      throw new Error('Each option must include groupId and valueId.')

    const optionInput = option as Record<string, unknown>
    const groupId = requiredString(optionInput, 'groupId')
    const valueId = requiredString(optionInput, 'valueId')
    if (seenGroupIds.has(groupId))
      throw new Error(`options must not repeat groupId ${groupId}.`)
    seenGroupIds.add(groupId)
    return { groupId, valueId }
  })
}

function cartNextStep(cart: CartSnapshot) {
  return cart.fulfillmentMode
    ? 'Confirm the cart with the customer. Call checkout_start only after explicit customer consent.'
    : 'The customer still needs to choose dine-in or self-pickup before order confirmation. Ask when appropriate, but continue adding requested items first.'
}

/**
 * Removes presentational image URLs from model-facing menu results.
 *
 * Before:
 * - a browser menu item with an image URL and all UI-only fields
 *
 * After:
 * - the stable ordering data needed to answer one customer request
 */
function menuItemForAgent(item: MenuItem) {
  return {
    composition: item.composition,
    available: item.available !== false,
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category,
    price: item.price,
    recommendationTags: item.recommendationTags,
    optionGroups: item.optionGroups,
  }
}

function getMenuQuery(input: Record<string, unknown>) {
  const category = typeof input.category === 'string' ? input.category.trim() : ''
  const additionalQueries = input.queries
  if (additionalQueries !== undefined && !Array.isArray(additionalQueries))
    throw new Error('queries must be an array of one to four non-empty strings.')

  if (additionalQueries && (additionalQueries.length === 0 || additionalQueries.length > 4))
    throw new Error('queries must be an array of one to four non-empty strings.')

  const rawQueries: string[] = typeof input.query === 'string' ? [input.query] : []
  for (const query of additionalQueries ?? []) {
    if (typeof query !== 'string' || !query.trim())
      throw new Error('queries must be an array of one to four non-empty strings.')
    rawQueries.push(query)
  }

  const queries = [...new Set(rawQueries
    .map(query => query.trim().toLocaleLowerCase())
    .filter(Boolean))]
  if (queries.length > 4)
    throw new Error('queries must include at most four values.')

  return { category, queries }
}

function itemMatchesQuery(item: MenuItem, query: string) {
  return [item.id, item.name, item.description, item.category]
    .some(value => value.toLocaleLowerCase().includes(query))
}

/**
 * Chooses a compact first view without letting one broad subject hide another.
 * Every subject is offered one distinct result before extra slots are filled in
 * round-robin order. Subjects themselves retain all matched IDs for expansion.
 */
function coverageItemIds(subjects: QueryPresentationSubject[], maximum = 4) {
  const selected: string[] = []
  const selectedIds = new Set<string>()
  const add = (itemId: string | undefined) => {
    if (!itemId || selectedIds.has(itemId) || selected.length >= maximum)
      return false
    selectedIds.add(itemId)
    selected.push(itemId)
    return true
  }

  for (const subject of subjects)
    add(subject.itemIds.find(itemId => !selectedIds.has(itemId)))

  for (let itemIndex = 1; selected.length < maximum; itemIndex++) {
    let added = false
    for (const subject of subjects)
      added = add(subject.itemIds[itemIndex]) || added
    if (!added)
      break
  }
  return selected
}

function recommendationNeeds(input: Record<string, unknown>): RecommendationTag[] {
  const needs = input.needs
  const validTags: RecommendationTag[] = ['rice', 'fried']
  if (needs === undefined)
    return []
  if (!Array.isArray(needs) || needs.length === 0 || !needs.every(tag => typeof tag === 'string' && validTags.includes(tag as RecommendationTag)))
    throw new Error('needs must contain one or more supported recommendation tags.')

  return [...new Set(needs)] as RecommendationTag[]
}

function ingredientFilterDescription(filters: IngredientFilters) {
  const label = (ids: string[]) => ids.map(id => ingredientDefinitions.find(definition => definition.id === id)!.label).join('、')
  return [filters.dietary ? '素食條件' : '', filters.excludeIngredients.length ? `排除${label(filters.excludeIngredients)}` : '', filters.includeIngredients.length ? `含${label(filters.includeIngredients)}` : ''].filter(Boolean).join('；')
}

function recommendationPresentation(input: Record<string, unknown>): RecommendationPresentation {
  const itemIds = input.itemIds
  if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 4 || !itemIds.every(itemId => typeof itemId === 'string' && itemId.trim()))
    throw new Error('itemIds must contain one to four menu item IDs.')

  const normalizedItemIds = itemIds.map(itemId => itemId.trim())
  if (new Set(normalizedItemIds).size !== normalizedItemIds.length)
    throw new Error('itemIds must not repeat an item ID.')

  const title = typeof input.title === 'string' ? input.title.trim() : undefined
  const reason = typeof input.reason === 'string' ? input.reason.trim() : undefined
  if (title && title.length > 36)
    throw new Error('title must be 36 characters or fewer.')
  if (reason && reason.length > 90)
    throw new Error('reason must be 90 characters or fewer.')

  return {
    kind: 'recommendation',
    itemIds: normalizedItemIds,
    ...(reason ? { reason } : {}),
    ...(title ? { title } : {}),
  }
}

/** Builds an LLM-readable retry result instead of allowing browser mediation to hide the validation error. */
function nativeInvocationFailure(name: MenuToolName, error: unknown) {
  const message = errorMessageFrom(error) ?? 'The requested menu operation could not be completed.'
  const recovery = name === 'menu_select_item' && message === 'itemId is required.'
    ? 'First call menu_get. Then call menu_select_item again with itemId set to exactly one item.id returned by menu_get.'
    : name === 'checkout_start' && message.includes('Choose dine-in or self-pickup before starting checkout.')
      ? 'Ask the customer whether this order is dine-in or self-pickup. Then call order_set_fulfillment before retrying checkout_start.'
      : 'Check this tool\'s required arguments and the latest menu or cart result, then retry only with valid values.'

  return { ok: false, error: message, recovery }
}

/**
 * Presents one domain interface to native WebMCP and human UI controls. Each
 * mutation announces itself before updating state.
 */
export function createMenuToolRuntime(options: MenuToolRuntimeOptions) {
  const machine = createOrderMachine({ gateway: options.gateway, menu: options.menu })
  let nativeRegistration: AbortController | undefined
  let completedOrderId: string | undefined
  let presentationItemIds: string[] | undefined
  let presentationFocus: { menuRevision: number } | undefined
  let pendingFastPathConfirmation: PendingFastPathConfirmation | undefined
  let pendingFastPathClarification: PendingFastPathClarification | undefined
  let pendingConfiguration: PendingConfiguration | undefined
  let issuedFastPathContext: IssuedFastPathContext | undefined
  // Host-owned, per Agent turn. A new task replaces this record; END from an
  // interrupted older turn cannot clear its successor's verified conditions.
  let agentTask: { taskId: string, filters: IngredientFilters, prices: PriceConditions, unresolvedPrice: boolean, menuRevision: number, expiresAt: number } | undefined
  let waitingFor: PendingQuestion | undefined
  let offeredQuestion: typeof waitingFor
  // Records belong to this order, not a model turn. Completed/superseded
  // questions stay recorded until reset; only the pending pointer grants context.
  const questionHistory = new Map<string, { question: PendingQuestion, status: 'offered' | 'pending' | 'deferred' | 'answered' | 'superseded' }>()
  let fulfillmentModes = options.fulfillmentModes ?? [{ id: 'dine-in' as const, label: '內用' }, { id: 'takeout' as const, label: '自取' }]
  let pendingReadContinuation: { candidateId: string, expiresAt: number, operation: OperationPlan, result: Record<string, unknown> } | undefined
  // Conditions and delivered items belong to this order, not an idle timer.
  // An explicit fresh recommendation replaces the batch; reset clears it.
  let recommendationRevision = 0
  let recommendationBatch: { seenIds: Set<string>, filters: IngredientFilters, needs: RecommendationTag[], prices: PriceConditions, category: string, queries: string[], strategy?: RecommendationStrategy, menuRevision: number | undefined } | undefined

  // Native WebMCP and embedded-host discovery must expose the same POS
  // capabilities, not a static enum containing unavailable service modes.
  function availableToolDefinitions(): MenuToolDefinition[] {
    return toolDefinitions.flatMap((definition) => {
      if (definition.name === 'menu_open' && !options.onMenuRequested)
        return []
      if (definition.name === 'menu_scroll' && !options.onMenuScroll)
        return []
      if (definition.name === 'menu_recommend') {
        const strategies = (['POPULAR', 'NEW_ARRIVAL', 'CHEF_SPECIAL'] as const).filter(strategy => machine.getMenu().some(item => item.available !== false && currentRecommendationSignal(item.recommendationSignals, strategy, Date.now())))
        return [{ ...definition, inputSchema: { ...definition.inputSchema, required: [], properties: {
          ...(definition.inputSchema.properties as Record<string, unknown>),
          ...(strategies.length ? { strategy: { type: 'string', enum: strategies, description: '只可使用 POS 有當前排序資料的策略；不得把菜單順序當熱銷。' } } : {}),
        } } }]
      }
      if (definition.name !== 'order_set_fulfillment')
        return [definition]
      if (!fulfillmentModes.length)
        return []
      return [{
        ...definition,
        description: `${definition.description} 目前 POS 選項：${fulfillmentModes.map(mode => `${mode.id}=${mode.label}`).join('、')}。`,
        inputSchema: { ...definition.inputSchema, properties: { mode: { type: 'string', enum: fulfillmentModes.map(mode => mode.id), description: '只可選擇目前 POS 提供的方式。' } } },
      }]
    })
  }
  /**
   * Revisions come from the state owners at write time. Snapshot comparison
   * here would miss an edit followed by an undo before the next read.
   */
  function currentFastPathRevisions() {
    return { ...machine.getRevisions(), recommendation: recommendationRevision, checkout: options.checkout?.revision() ?? 0, ...(options.seating ? { seating: options.seating.context().revision } : {}) }
  }

  function currentFastPathContext(transcript = '', previousTranscript?: string, renewQuestion = false) {
    const revisions = currentFastPathRevisions()
    let context = deriveDecisionContext({
      waitingFor: waitingFor && questionIsCurrent(waitingFor, revisions, Date.now()) ? waitingFor : undefined,
      fulfillmentModes,
      cart: machine.getCart(),
      checkout: options.checkout?.snapshot(),
      menu: machine.getMenu(),
      menuScrollSupported: Boolean(options.onMenuScroll),
      menuReturnSupported: Boolean(options.onMenuRequested),
      paymentStatus: options.checkout?.paymentStatus(),
      presentationItemIds: presentationFocus?.menuRevision === revisions.menu ? presentationItemIds : undefined,
      recommendationConditions: recommendationBatch && recommendationBatch.menuRevision === revisions.menu ? [ingredientFilterDescription(recommendationBatch.filters), priceDescription(recommendationBatch.prices), recommendationBatch.category, ...recommendationBatch.queries, ...recommendationBatch.needs].filter(Boolean).join('、') || '原本條件' : undefined,
      recentAddedLineId: machine.getLastAddedLineId(),
      revisions,
      selectedItem: machine.getSelection(),
      transcript,
      previousTranscript,
      seating: options.seating?.context(),
    })
    if (waitingFor && (!questionIsCurrent(waitingFor, revisions, Date.now()) || waitingFor.phase !== context.phase)) {
      // Revisions invalidate an execution ticket, not the unanswered need.
      // Rebase only if the current domain still asks the same question; a
      // completed phase must never revive an old membership/payment answer.
      const next = createQuestion({ ...context, waitingFor: undefined }, crypto.randomUUID(), Date.now())
      if (!next || next.purpose !== waitingFor.purpose || next.phase !== waitingFor.phase) {
        finishQuestion('superseded')
      }
      else if (renewQuestion) {
        const status = questionHistory.get(waitingFor.questionId)?.status === 'deferred' ? 'deferred' : 'pending'
        finishQuestion('superseded')
        waitingFor = rememberQuestion(next, status)
        context = deriveDecisionContext({ ...context, waitingFor })
      }
    }
    return { ...context, interactionState: { ...context.interactionState, ...(options.screen ? { screen: options.screen() } : {}) } }
  }

  function rememberQuestion(question: PendingQuestion, status: 'offered' | 'pending' | 'deferred') {
    questionHistory.set(question.questionId, { question, status })
    return question
  }

  function finishQuestion(status: 'answered' | 'superseded') {
    if (waitingFor)
      questionHistory.set(waitingFor.questionId, { question: waitingFor, status })
    waitingFor = undefined
  }

  function revisionsMatch(expected: FastPathRevisions, actual: KioskRevisions) {
    return (expected.cart === undefined || expected.cart === actual.cart)
      && (expected.checkout === undefined || expected.checkout === actual.checkout)
      && (expected.menu === undefined || expected.menu === actual.menu)
      && (expected.selectedItem === undefined || expected.selectedItem === actual.selectedItem)
      && (expected.seating === undefined || expected.seating === actual.seating)
      && (expected.recommendation === undefined || expected.recommendation === actual.recommendation)
  }

  function configurationSnapshot(context: DecisionContext, transcript = '', issueAnswer = false) {
    const pending = pendingConfiguration
    if (!pending)
      return undefined
    if (context.phase !== 'ordering' || !revisionsMatch(pending.plan.expectedRevisions, context.revisions)) {
      pendingConfiguration = undefined
      return undefined
    }
    // A query may need its own target question while the unadded meal waits.
    // Answer that foreground clarification first, then resume the retained meal.
    if (pendingFastPathClarification && pendingFastPathClarification.context.phase === context.phase && revisionsMatch(pendingFastPathClarification.expectedRevisions, context.revisions))
      return undefined
    // The unadded meal lives until cancellation, reset or relevant state edits.
    // A fresh turn gets a distinct short-lived ticket, so late model answers
    // cannot overwrite this turn; read-only host snapshots never replace it.
    const questionId = issueAnswer ? crypto.randomUUID() : pending.issued?.id ?? pending.id
    const question = configurationQuestion(pending.plan, context.menu, questionId, transcript)
    if (!question)
      return undefined
    if (issueAnswer)
      pending.issued = { id: questionId, expiresAt: Date.now() + 30_000, transcript, choices: new Map(question.choices.map(choice => [choice.id, choice])) }
    const cancel = { id: `configure:${questionId}:cancel`, description: '取消這筆尚未加入的餐點需求，保留購物車。' }
    const choices = [...question.choices.map(({ id, description }) => ({ id, description, requiresHighConfidence: true })), cancel]
    const item = context.menu.find(item => item.id === pending.plan.slots.itemId)!
    // An unissued host snapshot describes the question but grants no answer
    // authority. The expiry belongs to the ticket, never to the retained meal.
    const expiresAt = pending.issued?.expiresAt ?? 0
    return { phase: 'configuration', paymentState: 'idle', candidates: choices, catalogEvidence: context.catalogEvidence, interactionState: { ...context.interactionState, pendingIntent: 'ADD_ITEM' }, references: [{ refId: 'CONFIGURING_ITEM', label: item.name }], waitingFor: { questionId, purpose: 'item-configuration', question: question.prompt, expiresAt, choices } }
  }

  function clarificationRevisions(refs: readonly string[], context: DecisionContext): FastPathRevisions {
    return {
      ...(refs.some(ref => ref.startsWith('cart:')) ? { cart: context.revisions.cart } : {}),
      ...(context.phase !== 'ordering' ? { checkout: context.revisions.checkout } : {}),
      ...(refs.some(ref => ref.startsWith('item:') || ref.startsWith('selected:') || ref.startsWith('cart:')) ? { menu: context.revisions.menu } : {}),
      ...(refs.some(ref => ref.startsWith('selected:')) ? { selectedItem: context.revisions.selectedItem } : {}),
    }
  }

  function publicReferences(references: readonly DomainReference[]): DomainReference[] {
    const counts: Record<string, number> = {}
    return references.map((reference) => {
      // Jev receives only per-turn ordinals. The issued context retains the
      // actual item/line mapping, and revisions invalidate that mapping.
      let prefix = 'CATEGORY'
      if (reference.refId.startsWith('cart:'))
        prefix = 'CART_LINE'
      else if (reference.refId.startsWith('selected:'))
        prefix = 'SELECTED_ITEM'
      else if (reference.refId.startsWith('item:'))
        prefix = 'ITEM'
      else if (reference.refId.startsWith('table:'))
        prefix = 'TABLE_CHOICE'
      counts[prefix] = (counts[prefix] ?? 0) + 1
      return { label: reference.label, refId: `${prefix}_${counts[prefix]}` }
    })
  }

  function confirmationIsValid(pending: PendingFastPathConfirmation, context: DecisionContext) {
    const validation = validateConfirmation(pending.record, {
      action: pending.operation.intent as PendingConfirmation['action'],
      cartRevision: context.revisions.cart,
      checkoutRevision: context.revisions.checkout,
      now: Date.now(),
      payload: pending.operation.slots,
      selectedItemRevision: context.revisions.selectedItem,
    })

    return validation.kind === 'VALID'
      && pending.cart === cartFingerprint(machine.getCart())
      && authorize(pending.operation, context).kind !== 'BLOCKED'
  }

  async function announce(
    label: string,
    targetId?: string,
    actionOptions: Pick<AgentAction, 'controlId' | 'expandCustomization'> = {},
    onAction = options.onAction,
  ) {
    await onAction({
      label,
      targetId,
      ...actionOptions,
    })
  }

  async function invoke(name: MenuToolName, input: Record<string, unknown> = {}, onAction = options.onAction): Promise<unknown> {
    if (name === 'menu_get' && input.display === true) {
      const { category, queries } = getMenuQuery(input)
      const filters = ingredientFilters(input)
      if (!category && !queries.length && !filters.dietary && !filters.excludeIngredients.length && !filters.includeIngredients.length && !Object.keys(priceConditions(input)).length) {
        if (currentFastPathContext().phase !== 'ordering')
          throw new Error('Menu exploration is unavailable in the current phase.')
        // Customer-facing broad browsing shares the same batches as semantic
        // exploration. Explicit data-only reads still return the catalog.
        name = 'menu_recommend'
        input = recommendationBatch && recommendationBatch.menuRevision === machine.getRevisions().menu ? { more: true } : {}
      }
    }
    const result = await invokeOperation(name, input, onAction)
    if (!isKioskHostOnlyToolName(name) && result && typeof result === 'object') {
      if ((result as Record<string, unknown>).presentation)
        presentationFocus = { menuRevision: currentFastPathRevisions().menu }
      if (name === 'order_ask_question')
        return result
      const asksNext = ['order_add_item', 'cart_add_item', 'cart_get', 'cart_remove_item', 'cart_set_line_quantity', 'cart_set_line_option', 'order_set_fulfillment', 'order_set_party_size', 'seating_reserve', 'checkout_start', 'checkout_skip_membership', 'checkout_choose_invoice', 'checkout_request_tax_id', 'checkout_set_tax_id', 'checkout_confirm_tax_id', 'checkout_cancel'].includes(name)
      if (asksNext) {
        offeredQuestion = createQuestion(currentFastPathContext(), crypto.randomUUID(), Date.now())
        if (offeredQuestion)
          rememberQuestion(offeredQuestion, 'offered')
        // A cart read/edit or reaffirmed fulfillment does not answer an
        // unrelated question. Actual domain progress retires it in context.
        const payload = result as Record<string, unknown>
        delete payload.pendingCustomerChoice
        if (offeredQuestion)
          payload.pendingCustomerChoice = offeredQuestion
      }
    }
    return result
  }

  async function invokeOperation(name: MenuToolName, input: Record<string, unknown>, onAction: MenuToolRuntimeOptions['onAction']): Promise<unknown> {
    const presentationToolName = menuPresentationToolFor(name, input)
    if (presentationToolName)
      await options.onMenuPresentationActivity?.({ state: 'loading', toolName: presentationToolName })

    try {
      switch (name) {
        case 'menu_open': {
          if (!options.onMenuRequested || currentFastPathContext().phase !== 'ordering')
            throw new Error('Returning to the menu is unavailable in this phase.')
          await options.onMenuRequested()
          await announce('回到菜單繼續點餐', undefined, {}, onAction)
          return { customerMessage: '已回到菜單，購物車的餐點仍保留。', cart: machine.getCart() }
        }
        case 'menu_scroll': {
          if (input.direction !== 'UP' && input.direction !== 'DOWN')
            throw new Error('direction must be UP or DOWN.')
          if (!options.onMenuScroll || currentFastPathContext().phase !== 'ordering')
            throw new Error('Menu scrolling is unavailable in the current phase.')
          const result = options.onMenuScroll(input.direction)
          return { ...result, customerMessage: result.status === 'BOUNDARY' ? '已經到菜單邊界。' : result.status === 'MOVED' ? '已移動菜單畫面。' : '目前無法移動菜單畫面。' }
        }
        case 'kiosk_dialogue_presented': {
          requiredString(input, 'content')
          if (offeredQuestion && offeredQuestion.phase === currentFastPathContext().phase && questionIsCurrent(offeredQuestion, currentFastPathRevisions(), Date.now()) && input.questionId === offeredQuestion.questionId) {
            finishQuestion('superseded')
            waitingFor = rememberQuestion({ ...offeredQuestion }, 'pending')
            offeredQuestion = undefined
          }
          // Plain read/acknowledgement prose is not a question transition.
          // It neither activates an unpresented offer nor forgets a pending one.
          return { recorded: true }
        }
        case 'kiosk_question_validate': {
          const current = currentFastPathContext()
          return offeredQuestion && offeredQuestion.questionId === input.questionId && offeredQuestion.phase === current.phase && questionIsCurrent(offeredQuestion, current.revisions, Date.now())
            ? { pendingCustomerChoice: publicQuestion(offeredQuestion) }
            : {}
        }
        case 'order_ask_question': {
          const offered = createQuestion(currentFastPathContext(), crypto.randomUUID(), Date.now())
          if (!offered || offered.purpose !== input.purpose)
            throw new Error('This question is not legal in the current phase.')
          if ('question' in input)
            throw new Error('Question wording is application-owned; supply only purpose.')
          offeredQuestion = offered
          rememberQuestion(offered, 'offered')
          return { pendingCustomerChoice: offeredQuestion }
        }
        case 'order_defer_question': {
          if (currentFastPathContext().waitingFor?.questionId !== input.questionId)
            throw new Error('STALE_PLAN: the question is no longer current.')
          rememberQuestion(waitingFor!, 'deferred')
          return { customerMessage: '好的，保留目前訂單，你可以繼續提出需求。' }
        }
        case 'menu_get':
        {
          const { category, queries } = getMenuQuery(input)
          const prices = priceConditions(input)
          // Price-qualified customer reads share the recommendation batch owner:
          // ranking precedes the three-item cap and later alternatives keep scope.
          if (Object.keys(prices).length && input.display !== false)
            return await invoke('menu_recommend', { ...input, ...prices })
          const categories = [...new Set(machine.getMenu().map(item => item.category))]
          const appliedFilters = ingredientFilters(input)
          const scope = machine.getMenu(category || undefined).filter(item => queries.length === 0 || queries.some(query => itemMatchesQuery(item, query)))
          const filtered = filterIngredients(filterPrices(scope, prices), appliedFilters)
          const hasIngredientFilters = appliedFilters.excludeIngredients.length > 0 || appliedFilters.includeIngredients.length > 0
          const filterDescription = ingredientFilterDescription(appliedFilters)
          const searchScope = filtered.matches
          const subjects: QueryPresentationSubject[] = queries.length > 0
            ? queries.map(query => ({
                id: `query:${query}`,
                itemIds: searchScope.filter(item => itemMatchesQuery(item, query)).map(item => item.id),
                label: query,
              })).filter(subject => subject.itemIds.length > 0)
            : category
              ? [{ id: `category:${category}`, itemIds: searchScope.map(item => item.id), label: category }]
              : []
          const matchedItemIds = new Set(subjects.flatMap(subject => subject.itemIds))
          const items = searchScope
            .filter(item => queries.length === 0 || matchedItemIds.has(item.id))
            .map(menuItemForAgent)

          // A filtered lookup reflects what the customer is discussing. Keep
          // the visible menu synchronized with that result without depending
          // on the model to remember a second presentation-only tool call.
          const visibleSubjects = subjects.length ? subjects : categories.map(category => ({ id: `category:${category}`, label: category, itemIds: items.filter(item => item.category === category).map(item => item.id) }))
          const presentation = (category || queries.length > 0 || input.display === true || hasIngredientFilters)
            ? {
                kind: 'query-results' as const,
                itemIds: coverageItemIds(visibleSubjects),
                subjects: visibleSubjects,
                title: hasIngredientFilters ? `成分篩選：${filterDescription}` : queries.length === 1 ? `與「${queries[0]}」相關的餐點` : queries.length > 1 ? '顧客提到的餐點' : category ? `${category}餐點` : '目前販售餐點',
              }
            : undefined
          if (presentation) {
            presentationItemIds = presentation.itemIds
            options.onRecommendationsChange?.(presentation)
          }
          return {
            catalog: catalogInfo,
            categories,
            ingredientDefinitions,
            fulfillmentModes,
            items,
            appliedFilters,
            appliedPriceConditions: prices,
            availability: filterAvailability(filtered, items.length),
            customizable: filtered.customizable.map(({ item, requiredOptions }) => ({ item: menuItemForAgent(item), requiredOptions })),
            unknownCompositionItems: filtered.unknown.map(menuItemForAgent),
            ...(category || queries.length > 0 || input.display === true || hasIngredientFilters
              ? { customerMessage: `${hasIngredientFilters ? `${filterDescription}：` : ''}${items.length ? `我找到：${items.map(item => item.name).join('、')}。` : emptyFilterMessage(filterAvailability(filtered, items.length))}${items.length && filtered.customizable.length ? '另有餐點需要客製，尚未修改或加入。' : ''}${items.length && filtered.unknown.length ? '部分餐點資料不足，未列為符合。' : ''}` }
              : {}),
            ...(presentation ? { presentation } : {}),
          }
        }
        case 'menu_recommend': {
          const previous = input.more === true ? recommendationBatch : undefined
          if (input.more === true && (!previous || previous.menuRevision !== machine.getRevisions().menu))
            throw new Error('Recommendation context is absent or the catalog changed; start a new recommendation.')
          const needs = input.needs === undefined && previous ? previous.needs : recommendationNeeds(input)
          const strategy = input.strategy === undefined ? previous?.strategy : input.strategy
          if (strategy !== undefined && strategy !== 'POPULAR' && strategy !== 'NEW_ARRIVAL' && strategy !== 'CHEF_SPECIAL')
            throw new Error('Unsupported recommendation strategy.')
          if (previous && input.strategy !== undefined && strategy !== previous.strategy)
            throw new Error('Strategy changed; start a new recommendation without more.')
          const now = Date.now()
          if (strategy && !machine.getMenu().some(item => item.available !== false && currentRecommendationSignal(item.recommendationSignals, strategy, now)))
            throw new Error('Unsupported recommendation strategy: POS ranking evidence is absent or expired.')
          const suppliedPrices = priceConditions(input)
          if (previous && Object.entries(suppliedPrices).some(([key, value]) => previous.prices[key as keyof PriceConditions] !== value))
            throw new Error('Price conditions changed; start a new recommendation without more.')
          const prices = previous?.prices ?? suppliedPrices
          const suppliedScope = getMenuQuery(input)
          if (previous && ((suppliedScope.category && suppliedScope.category !== previous.category) || (suppliedScope.queries.length && JSON.stringify(suppliedScope.queries) !== JSON.stringify(previous.queries))))
            throw new Error('Menu scope changed; start a new recommendation without more.')
          const { category, queries } = previous ?? suppliedScope
          const limit = input.limit === undefined ? 3 : requiredNumber(input, 'limit')
          if (!Number.isInteger(limit) || limit < 1 || limit > 3)
            throw new Error('limit must be an integer from 1 to 3.')

          const filters = ingredientFilters(input)
          const appliedFilters = previous
            ? {
                excludeIngredients: [...new Set([...previous.filters.excludeIngredients, ...filters.excludeIngredients])],
                includeIngredients: [...new Set([...previous.filters.includeIngredients, ...filters.includeIngredients])],
                ...(filters.dietary || previous.filters.dietary ? { dietary: filters.dietary ?? previous.filters.dietary } : {}),
              }
            : filters
          // Budget refers to one dish's base price, not the whole order or
          // customized price. Scope all result classes before composition
          // checks so an over-budget unknown dish cannot mask a known absence.
          const scope = machine.getMenu(category || undefined).filter(item => (!queries.length || queries.some(query => itemMatchesQuery(item, query))) && needs.every(need => item.recommendationTags.includes(need)) && (!strategy || currentRecommendationSignal(item.recommendationSignals, strategy, now)))
          const filtered = filterIngredients(filterPrices(scope, prices), appliedFilters)
          const hasIngredientFilters = appliedFilters.excludeIngredients.length > 0 || appliedFilters.includeIngredients.length > 0
          const ranked = strategy && !prices.priceOrder
            ? filtered.matches.filter(item => currentRecommendationSignal(item.recommendationSignals, strategy, now)).sort((a, b) => currentRecommendationSignal(a.recommendationSignals, strategy, now)!.rank - currentRecommendationSignal(b.recommendationSignals, strategy, now)!.rank)
            : filtered.matches
          const items = ranked
            .filter(item => item.available !== false)
            .filter(item => needs.every(need => item.recommendationTags.includes(need)))
            .filter(item => !previous?.seenIds.has(item.id))
            .slice(0, limit)
            .map(menuItemForAgent)
          recommendationBatch = { seenIds: new Set([...(previous?.seenIds ?? []), ...items.map(item => item.id)]), filters: appliedFilters, needs, prices, category, queries, ...(strategy ? { strategy } : {}), menuRevision: machine.getRevisions().menu }
          recommendationRevision++
          const title = [category, ...queries, ingredientFilterDescription(appliedFilters), priceDescription(prices)].filter(Boolean).join('、')
          const presentation = items.length > 0 || hasIngredientFilters || Object.keys(prices).length > 0 || input.more === true
            ? {
                kind: 'recommendation' as const,
                itemIds: items.map(item => item.id),
                ...(title
                  ? { title }
                  : needs.length === 0
                    ? { reason: '從目前供應的餐點中提供幾個選擇。', title: '為你推薦' }
                    : { title: '為你推薦' }),
              }
            : undefined
          if (presentation) {
            presentationItemIds = presentation.itemIds
            options.onRecommendationsChange?.(presentation)
          }
          return {
            customerMessage: `${hasIngredientFilters ? `${ingredientFilterDescription(appliedFilters)}：` : ''}${items.length > 0
              ? `推薦${items.length === 1 ? '一項' : `${items.length} 項`}：${items.map(item => item.name).join('、')}。`
              : input.more === true && filterAvailability(filtered, items.length) === 'NONE' ? '目前沒有其他符合原條件且尚未推薦的餐點。' : emptyFilterMessage(filterAvailability(filtered, items.length))}${items.length && filtered.customizable.length ? '另有餐點需要客製，尚未修改或加入。' : ''}${items.length && filtered.unknown.length ? '部分餐點資料不足，未列為符合。' : ''}`,
            items,
            needs,
            ...(prices.maxPrice !== undefined ? { maxPrice: prices.maxPrice } : {}),
            appliedPriceConditions: prices,
            ...(strategy ? { strategy } : {}),
            appliedFilters,
            availability: filterAvailability(filtered, items.length),
            customizable: filtered.customizable.map(({ item, requiredOptions }) => ({ item: menuItemForAgent(item), requiredOptions })),
            unknownCompositionItems: filtered.unknown.map(menuItemForAgent),
            ...(presentation ? { presentation } : {}),
          }
        }
        case 'menu_show_recommendations': {
          const presentation = recommendationPresentation(input)
          const items = presentation.itemIds.map((itemId) => {
            const item = machine.getMenu().find(candidate => candidate.id === itemId)
            if (!item)
              throw new Error(`Menu item ${itemId} was not found.`)
            return item
          })

          presentationItemIds = presentation.itemIds
          options.onRecommendationsChange?.(presentation)
          return {
            customerMessage: `我推薦：${items.map(item => item.name).join('、')}。`,
            items: items.map(menuItemForAgent),
            presentation,
          }
        }
        case 'menu_select_item': {
          const itemId = requiredString(input, 'itemId')
          const item = machine.getMenu().find(candidate => candidate.id === itemId) as MenuItem | undefined
          await announce(`正在選擇${item?.name ?? '餐點'}`, itemId, {}, onAction)
          options.onMenuSelection(itemId)
          const selection = machine.selectMenuItem(itemId)
          options.onSelectionChange?.(selection)
          return {
            item: item ? menuItemForAgent(item) : undefined,
            selection,
            ...(item ? { customerMessage: `已選擇${item.name}，請確認需要的餐點設定。` } : {}),
          }
        }
        case 'menu_set_item_option': {
          const groupId = requiredString(input, 'groupId')
          const valueId = requiredString(input, 'valueId')
          const selection = machine.getSelection()
          const item = selection && machine.getMenu().find(candidate => candidate.id === selection.itemId)
          const value = item?.optionGroups.find(group => group.id === groupId)?.values.find(candidate => candidate.id === valueId)
          await announce(`設定為${value?.label ?? '指定選項'}`, item?.id, {
            controlId: item ? optionControlId(item.id, groupId, valueId) : undefined,
            expandCustomization: true,
          }, onAction)
          const nextSelection = machine.setItemOption(groupId, valueId)
          options.onSelectionChange?.(nextSelection)
          return { customerMessage: `已設定為${value?.label ?? '指定選項'}。`, selection: nextSelection }
        }
        case 'menu_set_quantity': {
          const quantity = requiredNumber(input, 'quantity')
          const itemId = machine.getSelection()?.itemId
          await announce(`設定數量為 ${quantity}`, itemId, {
            controlId: itemId ? quantityControlId(itemId) : undefined,
          }, onAction)
          const nextSelection = machine.setQuantity(quantity)
          options.onSelectionChange?.(nextSelection)
          return { customerMessage: `已設定為 ${quantity} 份。`, selection: nextSelection }
        }
        case 'order_add_item': {
          const itemId = requiredString(input, 'itemId')
          const item = machine.getMenu().find(candidate => candidate.id === itemId)
          if (!item)
            throw new Error(`Menu item ${itemId} was not found.`)

          const itemOptions = itemOptionInputs(input)
          const optionGroupIds = new Set(itemOptions.map(option => option.groupId))
          const missingRequiredGroup = item.optionGroups.find(group => group.required && !optionGroupIds.has(group.id))
          if (missingRequiredGroup)
            throw new Error(`A required option for ${missingRequiredGroup.label} is missing.`)

          for (const option of itemOptions) {
            const group = item.optionGroups.find(candidate => candidate.id === option.groupId)
            if (!group)
              throw new Error(`Option group ${option.groupId} is not available for ${item.name}.`)
            if (!group.values.some(value => value.id === option.valueId))
              throw new Error(`Option ${option.valueId} is not available for ${group.label}.`)
          }

          const quantity = input.quantity === undefined ? undefined : requiredNumber(input, 'quantity')
          if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1 || quantity > 20))
            throw new Error('quantity must be an integer from 1 to 20.')

          await announce(`正在選擇${item.name}`, item.id, {}, onAction)
          options.onMenuSelection(item.id)
          let selection = machine.selectMenuItem(item.id)
          options.onSelectionChange?.(selection)

          for (const option of itemOptions) {
            const value = item.optionGroups.find(group => group.id === option.groupId)?.values.find(candidate => candidate.id === option.valueId)
            await announce(`設定為${value?.label ?? '指定選項'}`, item.id, {
              controlId: optionControlId(item.id, option.groupId, option.valueId),
              expandCustomization: true,
            }, onAction)
            selection = machine.setItemOption(option.groupId, option.valueId)
            options.onSelectionChange?.(selection)
          }

          if (quantity !== undefined) {
            await announce(`設定數量為 ${quantity}`, item.id, {
              controlId: quantityControlId(item.id),
            }, onAction)
            selection = machine.setQuantity(quantity)
            options.onSelectionChange?.(selection)
          }

          await announce('加入購物車', item.id, { controlId: addItemControlId(item.id) }, onAction)
          const { cart, line } = machine.addToCart()
          options.onCartChange(cart)
          options.onMenuSelection(undefined)
          return {
            item: menuItemForAgent(item),
            line,
            cart,
            customerMessage: `已將${line.name}加入購物車，共 ${line.quantity} 份。`,
            nextStep: cartNextStep(cart),
          }
        }
        case 'cart_add_item': {
          const itemId = machine.getSelection()?.itemId
          await announce('加入購物車', itemId, { controlId: itemId ? addItemControlId(itemId) : undefined }, onAction)
          const result = machine.addToCart()
          options.onCartChange(result.cart)
          options.onMenuSelection(undefined)
          return {
            ...result,
            customerMessage: `已將${result.line.name}加入購物車，共 ${result.line.quantity} 份。`,
            nextStep: cartNextStep(result.cart),
          }
        }
        case 'cart_remove_item': {
          const lineId = requiredString(input, 'lineId')
          const line = machine.getCart().lines.find(candidate => candidate.id === lineId)
          await announce('從購物車移除餐點', 'cart', {}, onAction)
          const cart = machine.removeFromCart(lineId)
          options.onCartChange(cart)
          return {
            cart,
            customerMessage: line ? `已從購物車移除${line.name}。` : '已從購物車移除餐點。',
            nextStep: cartNextStep(cart),
          }
        }
        case 'cart_set_line_quantity': {
          const lineId = requiredString(input, 'lineId')
          const quantity = requiredNumber(input, 'quantity')
          const line = machine.getCart().lines.find(candidate => candidate.id === lineId)
          await announce(`設定購物車數量為 ${quantity}`, 'cart', {}, onAction)
          const cart = machine.setCartLineQuantity(lineId, quantity)
          options.onCartChange(cart)
          return {
            cart,
            customerMessage: line ? `已將${line.name}調整為 ${quantity} 份。` : '已更新餐點數量。',
            nextStep: cartNextStep(cart),
          }
        }
        case 'cart_set_line_option': {
          const lineId = requiredString(input, 'lineId')
          const groupId = requiredString(input, 'groupId')
          const valueId = requiredString(input, 'valueId')
          const line = machine.getCart().lines.find(candidate => candidate.id === lineId)
          const item = line && machine.getMenu().find(candidate => candidate.id === line.itemId)
          const value = item?.optionGroups.find(group => group.id === groupId)?.values.find(candidate => candidate.id === valueId)
          await announce(`設定購物車餐點為${value?.label ?? '指定選項'}`, 'cart', {}, onAction)
          const result = machine.setCartLineOption(lineId, groupId, valueId)
          options.onCartChange(result.cart)
          return {
            cart: result.cart,
            line: result.line,
            customerMessage: `已將${result.line.name}設定為${value?.label ?? '指定選項'}。`,
            nextStep: cartNextStep(result.cart),
          }
        }
        case 'cart_clear': {
          if (input.confirmedByUser !== true)
            throw new Error('Clearing the cart requires confirmedByUser: true.')
          options.checkout?.assertCanRestart()
          await options.seating?.reset()
          await announce('清空購物車', 'cart', {}, onAction)
          const cart = machine.clearCart()
          options.checkout?.restart()
          options.onCartChange(cart)
          options.onMenuSelection(undefined)
          options.onFulfillmentChange?.(undefined)
          return {
            cart,
            customerMessage: '已清空購物車。',
            nextStep: 'The customer can now begin a new order.',
          }
        }
        case 'cart_get': {
          if (input.display !== false) {
            await announce('查看訂單', 'cart', { controlId: 'order:view' }, onAction)
            await options.onReviewRequested?.()
          }
          const cart = machine.getCart()
          return {
            cart,
            nextStep: cartNextStep(cart),
          }
        }
        case 'order_set_fulfillment': {
          const mode = requiredFulfillmentMode(input)
          if (!fulfillmentModes.some(choice => choice.id === mode))
            throw new Error('This fulfillment mode is not offered by the POS.')
          if (machine.getCart().fulfillmentMode === mode) {
            // Reaffirmation is not a mode change: do not release seats, edit
            // cart revisions or discard the unanswered party/table question.
            return { cart: machine.getCart(), fulfillmentMode: mode, customerMessage: `目前已是${fulfillmentModes.find(choice => choice.id === mode)!.label}，保留原訂單設定。` }
          }
          if (mode === 'takeout')
            await options.seating?.reset()
          else
            await options.seating?.refresh()
          const label = fulfillmentModes.find(choice => choice.id === mode)!.label
          await options.onReviewRequested?.()
          await announce(`設定為${label}`, 'cart', {
            controlId: fulfillmentControlId(mode),
          }, onAction)
          const cart = machine.setFulfillmentMode(mode)
          options.onFulfillmentChange?.(mode)
          options.onCartChange(cart)
          return {
            cart,
            customerMessage: `已設為${label}。`,
            fulfillmentMode: mode,
            nextStep: mode === 'dine-in' && options.seating ? 'Ask party size, then present real available table choices; do not start checkout without a table hold.' : cartNextStep(cart),
          }
        }
        case 'seating_get': {
          if (!options.seating)
            throw new Error('This venue does not provide table selection.')
          await options.seating.refresh()
          return { seating: options.seating.context() }
        }
        case 'order_set_party_size': {
          if (!options.seating || machine.getCart().fulfillmentMode !== 'dine-in' || options.checkout?.snapshot())
            throw new Error('Choose dine-in before setting party size, outside checkout.')
          const partySize = requiredNumber(input, 'partySize')
          if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20)
            throw new Error('Party size must be an integer from 1 to 20.')
          await options.onReviewRequested?.()
          await announce(`設定內用人數為 ${partySize} 位`, 'cart', { controlId: 'seating:party-size' }, onAction)
          await options.seating.setPartySize(partySize)
          const seating = options.seating.context()
          const question = seating.choices.length === 0 ? '目前沒有足夠空桌，請洽門市人員或改為自取。' : seating.choices.some(choice => choice.splitRequired) ? `需要分桌；你同意分桌並選擇哪組桌位？${seating.choices.map(choice => choice.label).join('；')}。` : `請選擇桌位：${seating.choices.map(choice => choice.label).join('、')}。`
          return { seating, customerMessage: `已設為 ${seating.partySize} 位內用。${seating.choices.length ? '' : question}` }
        }
        case 'seating_reserve': {
          if (!options.seating || machine.getCart().fulfillmentMode !== 'dine-in' || options.checkout?.snapshot())
            throw new Error('Table selection is only allowed before dine-in checkout.')
          if (typeof input.splitApproved !== 'boolean')
            throw new Error('Explicit split approval is required.')
          await options.seating.reserve(requiredString(input, 'choiceId'), input.splitApproved, requiredNumber(input, 'expectedRevision'))
          return { seating: options.seating.context(), customerMessage: '已暫留選定桌位 10 分鐘，尚未付款；你可以繼續點餐或進入結帳。' }
        }
        case 'checkout_start': {
          if (input.confirmedByUser !== true)
            throw new Error('Starting checkout requires confirmedByUser: true.')
          await announce('進入結帳', 'cart', {}, onAction)
          const checkout = checkoutControllerOrThrow(options.checkout).start()
          return {
            checkout,
            customerMessage: '已進入結帳，請顧客掃描會員條碼或選擇略過。',
            nextStep: 'Wait for the customer to scan their membership barcode, or call checkout_skip_membership only when the customer asks to skip it.',
          }
        }
        case 'checkout_skip_membership': {
          if (input.confirmedByUser !== true)
            throw new Error('Skipping membership requires confirmedByUser: true.')
          await announce('略過會員', undefined, {}, onAction)
          const checkout = checkoutControllerOrThrow(options.checkout).skipMembership()
          return { checkout, customerMessage: '已略過會員，請選擇發票方式。' }
        }
        case 'checkout_choose_invoice': {
          const method = requiredInvoiceMethod(input)
          await announce(method === 'carrier' ? '使用雲端載具' : '捐贈發票', undefined, {}, onAction)
          const checkout = checkoutControllerOrThrow(options.checkout).chooseInvoice(method)
          return {
            checkout,
            customerMessage: method === 'carrier' ? '已選擇畫面上的雲端載具。' : '已選擇捐贈發票。',
          }
        }
        case 'checkout_request_tax_id': {
          await announce('輸入統編', undefined, {}, onAction)
          const checkout = checkoutControllerOrThrow(options.checkout).requestTaxId()
          return { checkout, customerMessage: '已開啟統編輸入畫面。' }
        }
        case 'checkout_set_tax_id': {
          const taxId = requiredString(input, 'taxId')
          if (!/^\d{8}$/.test(taxId))
            throw new Error('taxId must contain exactly eight digits.')
          await announce('帶入統編', undefined, {}, onAction)
          const checkout = checkoutControllerOrThrow(options.checkout).setTaxId(taxId)
          return {
            checkout,
            customerMessage: `已帶入統編 ${taxId.split('').join(' ')}，請顧客確認畫面。`,
            nextStep: 'Do not confirm automatically. Call checkout_confirm_tax_id only after the customer says the displayed number is correct.',
          }
        }
        case 'checkout_confirm_tax_id': {
          if (input.confirmedByUser !== true)
            throw new Error('Confirming a tax ID requires confirmedByUser: true.')
          await announce('確認統編', undefined, {}, onAction)
          const checkout = checkoutControllerOrThrow(options.checkout).confirmTaxId()
          return { checkout, customerMessage: '已確認統編，請選擇付款方式。' }
        }
        case 'checkout_select_payment': {
          const method = requiredPaymentMethod(input)
          await announce(method === 'card' ? '選擇信用卡' : '選擇行動支付', undefined, {}, onAction)
          const payment = await checkoutControllerOrThrow(options.checkout).selectPayment(method)
          return {
            customerMessage: payment.customerMessage,
            payment: { method, status: payment.status },
            nextStep: payment.status === 'uncertain'
              ? 'The transaction is locked for staff reconciliation. Do not select another payment method or claim success.'
              : payment.status === 'authorized'
                ? 'The verified payment has already advanced to automatic POS submission. Do not retry payment or submit the order again.'
                : payment.status === 'rejected'
                  ? 'Explain that payment was not completed and ask the customer whether to choose another method.'
                  : 'Wait for the physical payment terminal. Only its verified result may complete the order.',
          }
        }
        case 'checkout_cancel': {
          if (input.confirmedByUser !== true)
            throw new Error('Cancelling checkout requires confirmedByUser: true.')
          await announce('取消結帳', 'cart', {}, onAction)
          await checkoutControllerOrThrow(options.checkout).cancel()
          return {
            cart: machine.getCart(),
            customerMessage: '已返回訂單內容，購物車仍保留。',
          }
        }
        case 'kiosk_agent_task': {
          const taskId = requiredString(input, 'taskId')
          if (input.action === 'END') {
            if (agentTask?.taskId === taskId)
              agentTask = undefined
            return { ok: true }
          }
          if (input.action !== 'BEGIN')
            throw new Error('Invalid Agent task transition.')
          const revision = machine.getRevisions().menu
          if (input.expectedMenuRevision !== revision)
            throw new Error('STALE_PLAN: Agent task menu changed before handoff.')
          const constraints = input.constraints
          if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints))
            throw new Error('Agent task requires explicit bounded constraints.')
          const bounded = constraints as Record<string, unknown>
          agentTask = { taskId, filters: ingredientFilters(bounded), prices: priceConditions(bounded), unresolvedPrice: bounded.unresolvedPrice === true, menuRevision: revision, expiresAt: Date.now() + 300_000 }
          return { ok: true }
        }
        case 'kiosk_interaction_state': {
          const context = currentFastPathContext()
          const configuration = configurationSnapshot(context)
          if (configuration)
            return { menuRevision: context.revisions.menu, questionHistory: [...questionHistory.values()], ...configuration }
          const pendingConfirmationValid = pendingFastPathConfirmation && confirmationIsValid(pendingFastPathConfirmation, context)
          const pendingClarificationValid = pendingFastPathClarification
            && pendingFastPathClarification.context.phase === context.phase
            && revisionsMatch(pendingFastPathClarification.expectedRevisions, context.revisions)
          // Reading host state keeps the presented question visible, even when
          // its last answer ticket expired; only a decision turn renews it.
          const presentedQuestion = waitingFor?.phase === context.phase ? waitingFor : undefined
          return {
            menuRevision: context.revisions.menu,
            questionHistory: [...questionHistory.values()],
            productResolution: { ...context.productResolution, references: publicReferences(context.productResolution.references) },
            fulfillmentModes,
            ...(presentedQuestion ? { waitingFor: publicQuestion(presentedQuestion) } : {}),
            phase: pendingConfirmationValid ? 'pending_confirmation' : pendingClarificationValid ? 'clarification' : context.phase,
            paymentState: options.checkout?.paymentStatus() ?? 'idle',
            allowedPaymentMethods: context.allowedPaymentMethods,
            interactionState: {
              ...context.interactionState,
              ...(pendingConfirmationValid ? { pendingAction: pendingFastPathConfirmation!.record.action } : {}),
              ...(pendingClarificationValid ? { pendingIntent: pendingFastPathClarification!.candidate.intent } : {}),
            },
          }
        }
        case 'kiosk_fast_path_context': {
          if (machine.getCart().fulfillmentMode === 'dine-in')
            await options.seating?.refresh()
          // A new utterance supersedes any unclaimed read continuation from
          // the previous turn, even if the cart revisions did not change.
          pendingReadContinuation = undefined
          const transcript = typeof input.transcript === 'string' ? input.transcript : ''
          let context = currentFastPathContext(transcript, typeof input.previousTranscript === 'string' ? input.previousTranscript : undefined, true)
          issuedFastPathContext = undefined
          let interruptedQuestion: IssuedFastPathContext['interruptedQuestion']
          if (input.newRequestQuestionId !== undefined) {
            // Only the host may reroute the same utterance after the finite
            // topic-change route. This read neither cancels nor authorizes a meal.
            const configuration = pendingConfiguration
            const clarification = pendingFastPathClarification
            if (configuration?.issued?.id === input.newRequestQuestionId && configuration.issued.expiresAt > Date.now() && configuration.issued.transcript === transcript && context.phase === 'ordering' && revisionsMatch(configuration.plan.expectedRevisions, context.revisions)) {
              interruptedQuestion = { kind: 'configuration', id: configuration.id }
              configuration.issued = undefined
            }
            else if (clarification?.issued?.id === input.newRequestQuestionId && clarification.issued.expiresAt > Date.now() && clarification.issued.transcript === transcript && clarification.context.phase === context.phase && revisionsMatch(clarification.expectedRevisions, context.revisions)) {
              interruptedQuestion = { kind: 'clarification', id: clarification.id }
              clarification.issued = undefined
            }
            else {
              throw new Error('STALE_PLAN: The new request does not match the current question turn.')
            }
            // A topic change cannot inherit a draft's target, quantity or slots.
            const fresh = deriveDecisionContext({ ...context, waitingFor: undefined, previousTranscript: undefined, selectedItem: undefined, recentAddedLineId: undefined, presentationItemIds: undefined })
            context = { ...fresh, interactionState: { ...fresh.interactionState, ...(options.screen ? { screen: options.screen() } : {}) } }
          }
          const configuration = interruptedQuestion ? undefined : configurationSnapshot(context, transcript, true)
          if (configuration)
            return configuration
          if (pendingFastPathConfirmation) {
            if (!confirmationIsValid(pendingFastPathConfirmation, context)) {
              pendingFastPathConfirmation = undefined
            }
            else {
              return {
                candidates: [
                  { description: `確認剛才顯示的${pendingFastPathConfirmation.record.action}操作。`, id: `intent:confirm:${pendingFastPathConfirmation.record.confirmationId}` },
                  { description: '取消剛才待確認的操作，保留目前訂單。', id: `intent:cancel-confirmation:${pendingFastPathConfirmation.record.confirmationId}` },
                ],
                interactionState: { ...context.interactionState, pendingAction: pendingFastPathConfirmation.record.action },
                phase: 'pending_confirmation',
                paymentState: options.checkout?.paymentStatus() ?? 'idle',
              }
            }
          }
          if (!interruptedQuestion && pendingFastPathClarification) {
            const pending = pendingFastPathClarification
            if (pending.context.phase !== context.phase || !revisionsMatch(pending.expectedRevisions, context.revisions)) {
              pendingFastPathClarification = undefined
            }
            else {
              const issued = { id: crypto.randomUUID(), expiresAt: Date.now() + 15_000, transcript }
              pending.issued = issued
              const pendingReferences = pending.context.references.filter(reference => pending.candidateRefs.includes(reference.refId))
              const resolvedRef = resolveClarificationReference(transcript, pendingReferences)
              const choices = [...pending.candidateRefs.map((ref, index) => ({ description: `顧客指的是${pending.context.references.find(reference => reference.refId === ref)?.label ?? '指定餐點'}。`, id: `clarify:${issued.id}:${index}`, requiresHighConfidence: true })), { id: `clarify:${issued.id}:cancel`, description: '顧客取消這次待釐清的需求；保留購物車。' }]
              return {
                candidates: choices,
                waitingFor: { questionId: issued.id, purpose: 'item-clarification', question: buildClarificationPrompt(pendingReferences), choices, expiresAt: issued.expiresAt },
                catalogEvidence: context.catalogEvidence,
                interactionState: { ...context.interactionState, pendingIntent: pending.candidate.intent },
                phase: 'clarification',
                paymentState: options.checkout?.paymentStatus() ?? 'idle',
                references: publicReferences(pendingReferences),
                revisions: context.revisions,
                ...(resolvedRef ? { resolvedCandidateId: `clarify:${issued.id}:${pending.candidateRefs.indexOf(resolvedRef)}` } : {}),
              }
            }
          }
          issuedFastPathContext = {
            candidates: new Map(context.candidates.map(candidate => [candidate.id, candidate])),
            context,
            expiresAt: Date.now() + 15_000,
            interruptedQuestion,
          }
          return {
            candidates: context.candidates.map(candidate => ({ description: candidate.description, id: candidate.id, requiresHighConfidence: !['RECOMMEND', 'SEARCH_MENU', 'SELECT_ITEM', 'SHOW_RECOMMENDATIONS', 'VIEW_CART'].includes(candidate.intent) })),
            revisions: context.revisions,
            fulfillmentModes,
            ...(context.waitingFor ? { waitingFor: publicQuestion(context.waitingFor, context.candidates) } : {}),
            checkoutSnapshot: context.checkout,
            menuRevision: context.revisions.menu,
            productResolution: { ...context.productResolution, references: publicReferences(context.productResolution.references) },
            catalogEvidence: context.catalogEvidence,
            ...(context.priceEvidence ? { priceEvidence: context.priceEvidence } : {}),
            constraints: context.constraints,
            ingredientReferences: context.ingredientReferences,
            dietaryReferences: context.dietaryReferences,
            unavailableConditionReferences: context.unavailableConditionReferences,
            interactionState: context.interactionState,
            phase: context.phase,
            paymentState: options.checkout?.paymentStatus() ?? 'idle',
            allowedPaymentMethods: context.allowedPaymentMethods,
            references: publicReferences(context.modelReferences),
          }
        }
        case 'kiosk_fast_path_execute': {
          if (machine.getCart().fulfillmentMode === 'dine-in')
            await options.seating?.refresh()
          const candidateId = requiredString(input, 'candidateId')
          const currentContext = currentFastPathContext()
          if (candidateId.startsWith('configure:')) {
            const pending = pendingConfiguration
            if (!pending || currentContext.phase !== 'ordering' || !revisionsMatch(pending.plan.expectedRevisions, currentContext.revisions)) {
              pendingConfiguration = undefined
              throw new Error('STALE_PLAN: The pending meal configuration is no longer valid.')
            }
            const issued = pending.issued
            if (!issued || issued.expiresAt <= Date.now() || !candidateId.startsWith(`configure:${issued.id}:`))
              throw new Error('STALE_PLAN: The configuration answer has expired or belongs to an earlier turn.')
            if (candidateId === `configure:${issued.id}:cancel`) {
              pendingConfiguration = undefined
              return { customerMessage: '已取消這筆尚未加入的餐點需求，購物車仍保留。' }
            }
            const choice = issued.choices.get(candidateId)
            if (!choice?.slots)
              throw new Error('The configuration answer was not offered by this session.')
            pending.issued = undefined
            pending.plan = { ...pending.plan, slots: { ...choice.slots } }
            const question = configurationQuestion(pending.plan, currentContext.menu, pending.id)
            if (question) {
              options.onMenuSelection(String(pending.plan.slots.itemId))
              return { customerMessage: question.prompt, pendingConfiguration: { id: pending.id }, decisionTrace: { resolveIntent: { kind: 'CONFIGURATION', plan: pending.plan }, operationPlan: null, authorize: null } }
            }
            const operation = compileOperationPlan(pending.plan)
            const authorization = authorize(operation, currentContext)
            pendingConfiguration = undefined
            if (authorization.kind !== 'EXECUTE')
              throw new Error('The completed meal configuration is not authorized.')
            const result = await invoke(operation.toolName, operation.input, onAction)
            return { ...(result && typeof result === 'object' ? result : { result }), decisionTrace: { resolveIntent: { kind: 'PLAN', plan: pending.plan }, operationPlan: operation, authorize: authorization } }
          }
          if (pendingFastPathConfirmation) {
            const confirmation = pendingFastPathConfirmation
            const confirmId = `intent:confirm:${confirmation.record.confirmationId}`
            const cancelId = `intent:cancel-confirmation:${confirmation.record.confirmationId}`
            if (candidateId === cancelId) {
              pendingFastPathConfirmation = undefined
              return { customerMessage: '已取消剛才的操作。' }
            }
            if (candidateId !== confirmId)
              throw new Error('The confirmation does not match the pending action.')
            if (!confirmationIsValid(confirmation, currentContext)) {
              pendingFastPathConfirmation = undefined
              throw new Error('The confirmation has expired or the cart changed.')
            }
            confirmation.record.consumedAt = Date.now()
            pendingFastPathConfirmation = undefined
            const result = await invoke(confirmation.operation.toolName, confirmation.operation.input, onAction)
            return {
              ...(result && typeof result === 'object' ? result : { result }),
              decisionTrace: { authorize: { kind: 'EXECUTE', confirmationId: confirmation.record.confirmationId }, operationPlan: confirmation.operation },
            }
          }
          let decision: IntentCandidate | undefined
          let resolutionContext: DecisionContext | undefined
          let chosenRef: string | undefined
          if (candidateId.startsWith('clarify:') && pendingFastPathClarification) {
            const pending = pendingFastPathClarification
            if (pending.context.phase !== currentContext.phase || !revisionsMatch(pending.expectedRevisions, currentContext.revisions)) {
              pendingFastPathClarification = undefined
              throw new Error('The clarification is stale or no longer matches the available targets.')
            }
            const issued = pending.issued
            if (!issued || issued.expiresAt <= Date.now())
              throw new Error('The clarification answer is stale. Resolve the retained demand again.')
            if (!candidateId.startsWith(`clarify:${issued.id}:`))
              throw new Error('The clarification belongs to an earlier turn.')
            if (candidateId === `clarify:${issued.id}:cancel`) {
              pendingFastPathClarification = undefined
              return { customerMessage: '已取消這次待釐清的需求，購物車仍保留。' }
            }
            const index = Number(candidateId.slice(`clarify:${issued.id}:`.length))
            if (!Number.isInteger(index) || !pending.candidateRefs[index]) {
              throw new Error('The clarification is stale or no longer matches the available targets.')
            }
            decision = pending.candidate
            resolutionContext = pending.context
            chosenRef = pending.candidateRefs[index]
            pendingFastPathClarification = undefined
          }
          else {
            decision = issuedFastPathContext?.candidates.get(candidateId)
            resolutionContext = issuedFastPathContext?.context
          }
          if (!decision || !resolutionContext || (!chosenRef && (!issuedFastPathContext || Date.now() > issuedFastPathContext.expiresAt)))
            throw new Error('The selected Kiosk intent has expired. Resolve the latest customer state again.')
          const interrupted = issuedFastPathContext?.interruptedQuestion
          if (interrupted && (interrupted.kind === 'configuration' ? pendingConfiguration?.id : pendingFastPathClarification?.id) !== interrupted.id)
            throw new Error('STALE_PLAN: The interrupted question was replaced before this decision.')
          issuedFastPathContext = undefined
          if (!chosenRef && resolutionContext.priceEvidence) {
            const choice = resolutionContext.priceEvidence.choices.find(choice => choice.id === input.priceChoiceId)
            if (!choice || choice.kind === 'unsupported')
              throw new Error('Price evidence requires an issued, resolved price choice.')
            if (!['SEARCH_MENU', 'RECOMMEND'].includes(decision.intent) && choice.kind !== 'none')
              throw new Error('A price request cannot authorize a partial mutation.')
            resolutionContext = { ...resolutionContext, constraints: { ...resolutionContext.constraints, unresolvedPrice: false, ...(choice.conditions ? { price: choice.conditions } : {}) } }
          }
          if (!chosenRef && decision.intent === 'SEARCH_MENU' && input.searchInterpretation !== undefined) {
            if (input.searchInterpretation !== 'product' && input.searchInterpretation !== 'filter')
              throw new Error('Invalid bounded search interpretation.')
            if (input.searchInterpretation === 'product' && (!resolutionContext.productResolution.references.length || resolutionContext.productResolution.status === 'overflow'))
              throw new Error('Product interpretation requires issued finite catalog evidence.')
            resolutionContext = {
              ...resolutionContext,
              searchInterpretation: input.searchInterpretation,
              references: [...new Map([...resolutionContext.references, ...(input.searchInterpretation === 'product' ? resolutionContext.productResolution.references : [])].map(reference => [reference.refId, reference])).values()],
            }
          }
          if (!chosenRef && ['SEARCH_MENU', 'RECOMMEND'].includes(decision.intent) && (resolutionContext.ingredientReferences.length || resolutionContext.dietaryReferences.length)) {
            if (!input.ingredientFilters || typeof input.ingredientFilters !== 'object')
              throw new Error('Ingredient references require a bounded condition decision.')
            const filters = ingredientFilters(input.ingredientFilters as Record<string, unknown>)
            if (filters.dietary && !resolutionContext.dietaryReferences.some(reference => reference.id === filters.dietary))
              throw new Error('The dietary decision contains an unoffered reference.')
            const offeredIngredientIds = new Set([...resolutionContext.ingredientReferences.map(reference => reference.id), ...(filters.dietary ? vegetarianIngredients : [])])
            if ([...filters.excludeIngredients, ...filters.includeIngredients].some(id => !offeredIngredientIds.has(id)))
              throw new Error('The ingredient decision contains an unoffered reference.')
            resolutionContext = { ...resolutionContext, constraints: { ...resolutionContext.constraints, exclude: filters.excludeIngredients, include: filters.includeIngredients, ...(filters.dietary ? { dietary: filters.dietary } : {}) } }
          }
          const resolution = resolveIntent(decision, resolutionContext, chosenRef)
          if (resolution.kind === 'CONFIGURATION') {
            if (!revisionsMatch(resolution.plan.expectedRevisions, currentContext.revisions) || currentContext.phase !== 'ordering')
              throw new Error('STALE_PLAN: The meal changed before requesting its options.')
            pendingConfiguration = { id: crypto.randomUUID(), plan: resolution.plan }
            pendingFastPathClarification = undefined
            // The meal question takes foreground priority; the ordinary
            // question remains remembered while this unadded meal is pending.
            const itemId = resolution.plan.slots.itemId
            if (typeof itemId !== 'string')
              throw new Error('A pending meal configuration must identify its menu item.')
            // The plan remains the authorization source; this only makes the
            // already-resolved item visible before asking for its missing slots.
            options.onMenuSelection(itemId)
            const question = configurationQuestion(resolution.plan, currentContext.menu, pendingConfiguration.id)!
            return { customerMessage: question.prompt, pendingConfiguration: { id: pendingConfiguration.id }, decisionTrace: { resolveIntent: resolution, operationPlan: null, authorize: null } }
          }
          if (resolution.kind === 'CLARIFICATION') {
            const expectedRevisions = clarificationRevisions(resolution.candidateRefs, resolutionContext)
            if (!revisionsMatch(expectedRevisions, currentContext.revisions))
              throw new Error('The selected Kiosk intent is stale. Resolve the latest customer state again.')
            pendingFastPathClarification = {
              id: crypto.randomUUID(),
              candidate: decision,
              candidateRefs: resolution.candidateRefs,
              context: resolutionContext,
              expectedRevisions,
            }
            if (decision.intent === 'ADD_ITEM' || decision.intent === 'SELECT_ITEM')
              pendingConfiguration = undefined
            const itemIds = resolution.candidateRefs.filter(ref => ref.startsWith('item:')).map(ref => ref.slice(5))
            if (itemIds.length) {
              // Show exactly the eligible, revision-bound targets in this question,
              // not the previous search or an arbitrarily selected first meal.
              const presentation: RecommendationPresentation = { kind: 'query-results', itemIds, title: '請選擇餐點' }
              presentationItemIds = itemIds
              options.onRecommendationsChange?.(presentation)
            }
            return { customerMessage: resolution.prompt, decisionTrace: { authorize: null, operationPlan: null, resolveIntent: resolution }, pendingClarification: { candidateRefs: resolution.candidateRefs, intent: resolution.intent } }
          }
          if (resolution.kind !== 'PLAN')
            return { decisionTrace: { authorize: null, operationPlan: null, resolveIntent: resolution }, needsAssistant: true }
          const operation = compileOperationPlan(resolution.plan)
          const authorization = authorize(operation, currentContext)
          if (authorization.kind === 'BLOCKED')
            throw new Error(`The selected Kiosk intent is blocked: ${authorization.reason}.`)
          if (authorization.kind === 'REQUIRE_CONFIRMATION') {
            const confirmationId = crypto.randomUUID()
            const createdAt = Date.now()
            pendingFastPathConfirmation = {
              cart: cartFingerprint(machine.getCart()),
              operation: { ...operation, questionId: undefined },
              record: createConfirmation({
                action: operation.intent as PendingConfirmation['action'],
                cartRevision: operation.expectedRevisions.cart,
                checkoutRevision: operation.expectedRevisions.checkout,
                confirmationId,
                createdAt,
                expiresAt: createdAt + 15_000,
                payload: operation.slots,
                selectedItemRevision: operation.expectedRevisions.selectedItem,
              }),
            }
            // The ordinary question has been answered. The new one-use
            // confirmation record now owns authority for the exact operation.
            finishQuestion('answered')
            offeredQuestion = undefined
            return { customerMessage: confirmationMessage(operation), decisionTrace: { authorize: authorization, operationPlan: operation, resolveIntent: resolution }, pendingConfirmation: { action: operation.intent, confirmationId } }
          }
          if (interrupted && (operation.intent === 'ADD_ITEM' || operation.intent === 'SELECT_ITEM')) {
            pendingConfiguration = undefined
            pendingFastPathClarification = undefined
          }
          const result = await invoke(operation.toolName, operation.input, onAction)
          const payload = result && typeof result === 'object' ? result as Record<string, unknown> : { result }
          if (operation.toolName === 'menu_get' && operation.intent === 'SEARCH_MENU' && resolution.plan.slots.scope === 'all' && Array.isArray(payload.items) && payload.items.length > 0) {
            const recommend = compileOperationPlan({ intent: 'RECOMMEND', slots: { ...resolution.plan.slots }, expectedRevisions: { ...operation.expectedRevisions, checkout: currentContext.revisions.checkout } })
            const candidateId = `continuation:recommend:${crypto.randomUUID()}`
            pendingReadContinuation = { candidateId, expiresAt: Date.now() + 15_000, operation: recommend, result: payload }
            const items = Array.isArray(payload.items) ? payload.items : []
            // Full results stay on screen. Review sees a labelled preview, not
            // a truncated catalog presented as the complete available set.
            const observation = JSON.stringify({ categories: payload.categories, itemCount: items.length, previewOnly: items.length > targetReferenceLimit, itemsPreview: items.slice(0, targetReferenceLimit).map(item => ({ name: item.name, price: item.price })) }).slice(0, 4_000)
            return { ...payload, continuation: { answer: String(payload.customerMessage ?? ''), candidates: [{ id: candidateId, description: '顧客同時要求推薦，從已查得的菜單補充簡單推薦；只查詢展示，不新增訂單。' }], observation }, decisionTrace: { authorize: authorization, operationPlan: operation, resolveIntent: resolution } }
          }
          return { ...payload, decisionTrace: { authorize: authorization, operationPlan: operation, resolveIntent: resolution } }
        }
        case 'kiosk_fast_path_continue': {
          const pending = pendingReadContinuation
          pendingReadContinuation = undefined
          if (!pending || pending.candidateId !== input.candidateId || pending.expiresAt <= Date.now())
            throw new Error('The read continuation has expired or was already consumed.')
          const authorization = authorize(pending.operation, currentFastPathContext())
          if (authorization.kind !== 'EXECUTE')
            throw new Error('The read continuation no longer matches the current state.')
          const result = await invoke(pending.operation.toolName, pending.operation.input, onAction)
          const payload = result && typeof result === 'object' ? result as Record<string, unknown> : {}
          return { ...payload, customerMessage: `${pending.result.customerMessage ?? ''} ${payload.customerMessage ?? ''}`.trim(), decisionTrace: { authorize: authorization, operationPlan: pending.operation } }
        }
      }
    }
    finally {
      if (presentationToolName)
        await options.onMenuPresentationActivity?.({ state: 'idle', toolName: presentationToolName })
    }
  }

  /** Applies the browser-owned state policy before a conversational Agent's WebMCP call. */
  async function invokeForAgent(name: MenuToolName, input: Record<string, unknown> = {}) {
    if (isKioskHostOnlyToolName(name))
      throw new Error('Kiosk host decision tools are unavailable to the Agent.')
    // Missing price semantics cannot be bypassed by guessing a known item ID
    // and going straight to an order/cart tool without a qualified menu read.
    if (agentTask?.unresolvedPrice && !['cart_get', 'seating_get'].includes(name)) {
      if (agentTask.expiresAt <= Date.now() || agentTask.menuRevision !== machine.getRevisions().menu)
        throw new Error('STALE_PLAN: Agent task constraints expired or catalog changed.')
      return { items: [], customerMessage: priceClarification }
    }
    if (agentTask && ['menu_get', 'menu_recommend', 'menu_show_recommendations'].includes(name)) {
      if (agentTask.expiresAt <= Date.now() || agentTask.menuRevision !== machine.getRevisions().menu)
        throw new Error('STALE_PLAN: Agent task constraints expired or catalog changed.')
      const prices = intersectPrices(agentTask.prices, priceConditions(input))
      const supplied = ingredientFilters(input)
      const filters: IngredientFilters = {
        excludeIngredients: [...new Set([...agentTask.filters.excludeIngredients, ...supplied.excludeIngredients])],
        includeIngredients: [...new Set([...agentTask.filters.includeIngredients, ...supplied.includeIngredients])],
        ...(agentTask.filters.dietary || supplied.dietary ? { dietary: agentTask.filters.dietary ?? supplied.dietary } : {}),
      }
      if (filters.includeIngredients.some(id => filters.excludeIngredients.includes(id)))
        throw new Error('Task constraint conflict: start a new customer task to change conditions.')
      if (name === 'menu_show_recommendations') {
        const presentation = recommendationPresentation(input)
        const validIds = new Set(filterIngredients(filterPrices(machine.getMenu(), prices), filters).matches.map(item => item.id))
        if (presentation.itemIds.some(id => !validIds.has(id)))
          throw new Error('Recommendations violate the current task constraints.')
      }
      else {
        input = { ...input, ...filters, ...prices }
      }
    }
    // Agent menu browsing uses the same venue policy unless it explicitly
    // requests a data-only read for its own lookup work.
    if (name === 'menu_get')
      return await invoke(name, { ...input, display: input.display ?? true })
    if (name === 'cart_get' || name === 'seating_get' || name === 'order_ask_question' || name === 'order_defer_question')
      return await invoke(name, input)
    if (machine.getCart().fulfillmentMode === 'dine-in')
      await options.seating?.refresh()

    const context = currentFastPathContext()
    if (agentTask && Object.keys(agentTask.prices).length && ['menu_select_item', 'order_add_item', 'cart_add_item'].includes(name)) {
      const itemId = name === 'cart_add_item' ? machine.getSelection()?.itemId : input.itemId
      const item = machine.getMenu().find(item => item.id === itemId)
      if (!item || !filterPrices([item], agentTask.prices).length)
        throw new Error('Selected item violates the current task price conditions.')
    }
    if (name === 'checkout_start' && context.cart.lines.length > 0 && !context.cart.fulfillmentMode)
      throw new Error('Choose dine-in or self-pickup before starting checkout.')
    if ((name === 'cart_remove_item' || name === 'cart_set_line_quantity' || name === 'cart_set_line_option') && context.phase === 'ordering') {
      const lineId = requiredString(input, 'lineId')
      const line = context.cart.lines.find(candidate => candidate.id === lineId)
      const sameItemLines = context.cart.lines.filter(candidate => candidate.itemId === line?.itemId)
      if (line && sameItemLines.length > 1) {
        if (pendingFastPathConfirmation || pendingFastPathClarification)
          throw new Error('Another customer clarification or confirmation is already pending.')
        const intent = name === 'cart_remove_item' ? 'REMOVE_ITEM' : name === 'cart_set_line_quantity' ? 'SET_QUANTITY' : 'SET_OPTION'
        const slots: Record<string, string | number> = {}
        if (name === 'cart_set_line_quantity')
          slots.quantity = requiredNumber(input, 'quantity')
        if (name === 'cart_set_line_option') {
          slots.groupId = requiredString(input, 'groupId')
          slots.valueId = requiredString(input, 'valueId')
        }
        const originalCandidate = context.candidates.find(candidate => candidate.intent === intent)!
        const candidate = { ...originalCandidate, slots }
        const resolutionContext = { ...context, candidates: context.candidates.map(existing => existing.id === candidate.id ? candidate : existing) }
        const candidateRefs = sameItemLines.map(candidate => `cart:${candidate.id}`)
        const references = context.references.filter(reference => candidateRefs.includes(reference.refId))
        pendingFastPathClarification = {
          id: crypto.randomUUID(),
          candidate,
          candidateRefs,
          context: resolutionContext,
          expectedRevisions: clarificationRevisions(candidateRefs, context),
        }
        return { customerMessage: buildClarificationPrompt(references), pendingClarification: { candidateRefs, intent } }
      }
    }
    const selected = context.selectedItem
    const slots: OperationPlan['slots'] = {}
    let targetRef: string | undefined
    let intent: OperationPlan['intent']
    switch (name) {
      case 'menu_open':
        intent = 'RETURN_MENU'
        break
      case 'menu_scroll':
        intent = 'SCROLL_MENU'
        slots.direction = requiredString(input, 'direction')
        break
      case 'menu_recommend':
        intent = 'RECOMMEND'
        break
      case 'menu_show_recommendations':
        intent = 'SHOW_RECOMMENDATIONS'
        break
      case 'menu_select_item':
        intent = 'SELECT_ITEM'
        slots.itemId = requiredString(input, 'itemId')
        targetRef = `item:${slots.itemId}`
        break
      case 'menu_set_item_option':
        intent = 'SET_OPTION'
        targetRef = `selected:${selected?.itemId ?? ''}`
        slots.groupId = String(input.groupId ?? '')
        slots.valueId = String(input.valueId ?? '')
        break
      case 'menu_set_quantity':
        intent = 'SET_QUANTITY'
        targetRef = `selected:${selected?.itemId ?? ''}`
        slots.quantity = Number(input.quantity)
        break
      case 'order_add_item':
        intent = 'ADD_ITEM'
        slots.itemId = String(input.itemId ?? '')
        slots.quantity = Number(input.quantity ?? 1)
        targetRef = `item:${slots.itemId}`
        break
      case 'cart_add_item':
        intent = 'ADD_ITEM'
        slots.itemId = selected?.itemId ?? ''
        slots.quantity = selected?.quantity ?? 0
        targetRef = `selected:${slots.itemId}`
        break
      case 'cart_remove_item':
        intent = 'REMOVE_ITEM'
        targetRef = `cart:${String(input.lineId ?? '')}`
        break
      case 'cart_set_line_quantity':
        intent = 'SET_QUANTITY'
        targetRef = `cart:${String(input.lineId ?? '')}`
        slots.quantity = Number(input.quantity)
        break
      case 'cart_set_line_option':
        intent = 'SET_OPTION'
        targetRef = `cart:${String(input.lineId ?? '')}`
        slots.groupId = String(input.groupId ?? '')
        slots.valueId = String(input.valueId ?? '')
        break
      case 'cart_clear':
        intent = 'CLEAR_CART'
        break
      case 'order_set_fulfillment':
        intent = 'SET_FULFILLMENT'
        slots.mode = String(input.mode ?? '')
        break
      case 'order_set_party_size':
        intent = 'SET_PARTY_SIZE'
        slots.partySize = requiredNumber(input, 'partySize')
        break
      case 'seating_reserve':
        intent = 'RESERVE_TABLES'
        slots.choiceId = requiredString(input, 'choiceId')
        slots.splitApproved = input.splitApproved === true ? 'yes' : 'no'
        targetRef = `table:${slots.choiceId}`
        break
      case 'checkout_start':
        intent = 'START_CHECKOUT'
        break
      case 'checkout_skip_membership':
        intent = 'SKIP_MEMBERSHIP'
        break
      case 'checkout_choose_invoice':
        intent = 'CHOOSE_INVOICE'
        slots.method = String(input.method ?? '')
        break
      case 'checkout_request_tax_id':
        intent = 'REQUEST_TAX_ID'
        break
      case 'checkout_set_tax_id':
        intent = 'SET_TAX_ID'
        slots.taxId = String(input.taxId ?? '')
        break
      case 'checkout_confirm_tax_id':
        intent = 'CONFIRM_TAX_ID'
        slots.taxId = context.checkout?.taxId ?? ''
        break
      case 'checkout_select_payment':
        intent = 'SELECT_PAYMENT'
        slots.method = String(input.method ?? '')
        break
      case 'checkout_cancel':
        intent = 'CANCEL_CHECKOUT'
        break
    }
    const operation: OperationPlan = {
      expectedRevisions: { ...context.revisions, ...(intent === 'RESERVE_TABLES' ? { seating: requiredNumber(input, 'expectedRevision') } : {}) },
      input: { ...input, ...(['cart_clear', 'checkout_start', 'checkout_skip_membership', 'checkout_confirm_tax_id', 'checkout_cancel'].includes(name) ? { confirmedByUser: true } : {}) },
      intent,
      slots,
      ...(targetRef ? { targetRef } : {}),
      toolName: name,
    }
    const authorization = authorize(operation, context)
    if (authorization.kind === 'BLOCKED')
      throw new Error(`The Agent WebMCP operation is blocked: ${authorization.reason}.`)
    if (authorization.kind === 'REQUIRE_CONFIRMATION') {
      if (pendingFastPathConfirmation && confirmationIsValid(pendingFastPathConfirmation, context))
        throw new Error('Another customer confirmation is already pending.')
      const createdAt = Date.now()
      const confirmationId = crypto.randomUUID()
      pendingFastPathConfirmation = {
        cart: cartFingerprint(context.cart),
        operation,
        record: createConfirmation({
          action: operation.intent as PendingConfirmation['action'],
          cartRevision: context.revisions.cart,
          checkoutRevision: context.revisions.checkout,
          confirmationId,
          createdAt,
          expiresAt: createdAt + 15_000,
          payload: slots,
          selectedItemRevision: context.revisions.selectedItem,
        }),
      }
      return { customerMessage: confirmationMessage(operation), pendingConfirmation: { action: operation.intent, confirmationId } }
    }
    if (authorize(operation, currentFastPathContext()).kind !== 'EXECUTE')
      throw new Error('The Agent WebMCP operation became stale before execution.')
    return await invoke(name, operation.input)
  }

  async function reset() {
    options.checkout?.assertCanRestart()
    await options.seating?.reset()
    recommendationBatch = undefined
    agentTask = undefined
    recommendationRevision++
    pendingFastPathConfirmation = undefined
    pendingFastPathClarification = undefined
    pendingConfiguration = undefined
    waitingFor = undefined
    offeredQuestion = undefined
    questionHistory.clear()
    pendingReadContinuation = undefined
    issuedFastPathContext = undefined
    const cart = machine.reset()
    completedOrderId = undefined
    presentationItemIds = undefined
    presentationFocus = undefined
    options.onCartChange(cart)
    options.onMenuSelection(undefined)
    options.onFulfillmentChange?.(undefined)
    return { cart }
  }

  /** Submits only after the customer-facing payment terminal returns its verified transaction ID. */
  async function confirmPaidOrder(paymentId: string) {
    machine.setPaymentId(paymentId)
    const order = await machine.confirmOrder()
    const { receipt } = order
    options.onOrderSubmission?.(order)
    if (receipt.status === 'accepted' && completedOrderId !== order.id) {
      completedOrderId = order.id
      options.onOrderConfirmed?.(order)
    }
    return order
  }

  /**
   * Registers the runtime's current tools and returns the matching cleanup.
   *
   * A menu page can be remounted by Vite HMR or by an embedding host. Each
   * registration owns an AbortController so stale tool names are removed before
   * a replacement runtime registers the same names.
   */
  async function registerNativeWebMcp(options: { exposedTo?: string[] } = {}) {
    const registrationDocument = document as WebMcpDocument
    const modelContext = registrationDocument.modelContext
    if (!modelContext?.registerTool)
      return undefined

    nativeRegistration?.abort()
    registrationDocument.__webnaviorOrderMenuNativeWebMcpRegistration__?.abort()
    const controller = new AbortController()
    nativeRegistration = controller
    registrationDocument.__webnaviorOrderMenuNativeWebMcpRegistration__ = controller

    try {
      await Promise.all(availableToolDefinitions().map(async (definition) => {
        const { readOnly, ...tool } = definition
        await modelContext.registerTool({
          ...tool,
          annotations: readOnly ? { readOnlyHint: true } : undefined,
          execute: async (input, { signal } = {}) => {
            if (signal?.aborted)
              throw signal.reason ?? new DOMException('Tool execution aborted.', 'AbortError')
            try {
              // Native WebMCP carries both host-only decision tools and Agent
              // tools. The host-only tools must use the browser-owned runtime;
              // invokeForAgent intentionally refuses them.
              return isKioskHostOnlyToolName(definition.name)
                ? await invoke(definition.name, input)
                : await invokeForAgent(definition.name, input)
            }
            catch (error) {
              return nativeInvocationFailure(definition.name, error)
            }
          },
        }, { exposedTo: options.exposedTo, signal: controller.signal })
      }))
    }
    catch (error) {
      if (nativeRegistration === controller)
        nativeRegistration = undefined
      if (registrationDocument.__webnaviorOrderMenuNativeWebMcpRegistration__ === controller)
        registrationDocument.__webnaviorOrderMenuNativeWebMcpRegistration__ = undefined
      controller.abort()
      throw error
    }

    return () => {
      disposeNativeWebMcp(controller)
    }
  }

  /** Releases the active native registration when its document is unmounted. */
  function disposeNativeWebMcp(expectedRegistration = nativeRegistration) {
    if (!expectedRegistration)
      return

    if (nativeRegistration === expectedRegistration)
      nativeRegistration = undefined
    const registrationDocument = document as WebMcpDocument
    if (registrationDocument.__webnaviorOrderMenuNativeWebMcpRegistration__ === expectedRegistration)
      registrationDocument.__webnaviorOrderMenuNativeWebMcpRegistration__ = undefined
    expectedRegistration.abort()
  }

  return {
    confirmPaidOrder,
    disposeNativeWebMcp,
    invoke,
    invokeForAgent,
    registerNativeWebMcp,
    reset,
    setMenu: machine.setMenu,
    setFulfillmentModes: (modes: typeof fulfillmentModes) => {
      fulfillmentModes = [...modes]
      // Updated capabilities invalidate issued plans, not retained needs.
      // The next decision derives fresh choices from the current POS modes.
      if (waitingFor)
        waitingFor = { ...waitingFor, expiresAt: 0 }
      if (offeredQuestion)
        offeredQuestion = { ...offeredQuestion, expiresAt: 0 }
      issuedFastPathContext = undefined
    },
    get toolDefinitions() { return availableToolDefinitions() },
  }
}

function publicQuestion(question: PendingQuestion, candidates = question.choices) {
  const intents = new Set(question.choices.map(choice => choice.intent))
  if (question.purpose === 'party-size')
    intents.add('SET_PARTY_SIZE')
  if (question.purpose === 'tax-id') {
    intents.add('SET_TAX_ID')
    intents.add('CONFIRM_TAX_ID')
  }
  return { questionId: question.questionId, purpose: question.purpose, question: question.question, expiresAt: question.expiresAt, choices: candidates.filter(choice => intents.has(choice.intent) || choice.intent === 'DEFER_QUESTION').map(choice => ({ id: choice.id, description: choice.description })) }
}

function confirmationMessage(operation: OperationPlan) {
  switch (operation.intent) {
    case 'CLEAR_CART': return '要清空目前購物車嗎？請回答確認或取消。'
    case 'CONFIRM_TAX_ID': return `要確認畫面上的統編 ${operation.slots.taxId} 並繼續嗎？請回答確認或取消。`
    case 'SELECT_PAYMENT': return `要啟動${operation.slots.method === 'card' ? '信用卡' : '行動支付'}付款嗎？請回答確認或取消。`
    case 'CANCEL_CHECKOUT': return '要取消目前結帳並回到訂單嗎？請回答確認或取消。'
    default: return '請確認這項操作。'
  }
}

function cartFingerprint(cart: CartSnapshot) {
  return JSON.stringify({ fulfillmentMode: cart.fulfillmentMode, lines: cart.lines, paymentId: cart.paymentId })
}
