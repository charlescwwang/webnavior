import { browserToolResult } from '@proj-airi/stage-shared/browser-conversation'
import { nativeOrderingToolName } from '@proj-airi/stage-shared/ordering-tools'

/** Stable, customer-safe failure categories shared by the reply stream and host. */
export type KioskReplyFailureReason = 'timeout' | 'provider-error'

export type KioskAgentInteractionMode = 'active' | 'decision_guidance' | 'touch_preferred'

export interface KioskAgentMenuSubject {
  id: string
  name: string
}

export interface KioskAgentCartSummary {
  fulfillmentMode?: 'dine-in' | 'takeout'
  itemCount: number
  lines: Array<{
    itemId: string
    lineId: string
    name: string
    options: Record<string, string>
    quantity: number
  }>
  total: number
}

/**
 * Per-visitor, short-lived context used to keep an ordering conversation
 * coherent. This deliberately stores compact references and the latest
 * successful cart summary; the order-menu remains the source of truth.
 */
export interface KioskAgentInteractionState {
  cartSummary?: KioskAgentCartSummary
  dismissedSubjectIds: string[]
  mode: KioskAgentInteractionMode
  noProgressCount: number
  recentAgentAction?: { name: string, subjectIds?: string[] }
  recentMenuSubjects?: KioskAgentMenuSubject[]
  recentUserIntent?: 'browse' | 'request_alternatives' | 'unknown'
  suggestedSubjectIds: string[]
}

export interface KioskConversationTextEntry {
  content: string
  kind: 'assistant_text' | 'user_text'
}

export interface KioskConversationMessage {
  content: string
  role: 'assistant' | 'user'
}

export const defaultKioskAgentInteractionState: KioskAgentInteractionState = {
  dismissedSubjectIds: [],
  mode: 'active',
  noProgressCount: 0,
  recentMenuSubjects: [],
  suggestedSubjectIds: [],
}

const maximumRememberedSubjects = 24
const maximumRecentMenuSubjects = 8
const maximumConversationCharacters = 6_000
const maximumConversationMessages = 12
const maximumModelToolResultCharacters = 8_000
const renderedMenuToolNames = new Set(['menu_get', 'menu_recommend', 'menu_show_recommendations'])

/** A factual menu task is complete only after a customer-facing read receipt. */
export function hasMenuReply(results: readonly { name: string, content: string }[]) {
  return results.some((result) => {
    if (!renderedMenuToolNames.has(result.name))
      return false
    const payload = parseToolPayload(result.content)
    // Internal catalog evidence helps the model choose a presentation; it is
    // not itself a presented batch. Rejected reads cannot release this gate.
    return Boolean(payload && payload.dataOnly !== true && payload.ok !== false && !payload.error && Array.isArray(payload.items))
  })
}

/** Actual commerce receipts require host presentation; offering tools does not make a greeting a commerce draft. */
export function requiresPresentedReply(results: readonly { name: string, content: string }[]) {
  // Even a rejected or malformed commerce receipt makes generated success
  // prose untrusted. Only the paged text-history tool leaves dialogue natural.
  return results.some(result => result.name !== 'kiosk_session_history')
}

/** A browser-owned query clarification ends the turn without another model decision. */
export function queryClarification(results: readonly { name: string, content: string }[]) {
  // Only the single non-mutating query receipt owns this spoken question.
  // Mixed results, named lookups and arbitrary model prose cannot settle it.
  if (results.length !== 1 || results[0]!.name !== 'menu_recommend')
    return undefined
  const payload = parseToolPayload(results[0]!.content)
  if (payload?.queryAction !== 'clarify' || !Array.isArray(payload.items) || payload.items.length !== 0 || typeof payload.customerMessage !== 'string' || !payload.customerMessage.trim() || payload.presentation || payload.pendingCustomerChoice)
    return undefined
  return payload.customerMessage
}

/**
 * Keeps the latest complete conversational turns within a provider-independent
 * character ceiling. The newest single turn is truncated only when that turn
 * alone exceeds the entire budget. Checkout retains only the latest customer
 * turn and its following exchange; the durable transcript is never modified.
 */
export function selectBoundedConversationText(entries: KioskConversationTextEntry[], scope: 'ordering' | 'checkout' = 'ordering'): KioskConversationMessage[] {
  // Checkout carries the current utterance and its own tool exchange. Earlier
  // chat remains in the durable transcript and is not reused as authorization.
  if (scope === 'checkout') {
    const lastUser = entries.findLastIndex(entry => entry.kind === 'user_text')
    entries = lastUser < 0 ? [] : entries.slice(lastUser)
  }
  const selected: KioskConversationMessage[] = []
  let usedCharacters = 0
  const truncationNotice = '【較早內容已省略】\n'

  for (let index = entries.length - 1; index >= 0 && selected.length < maximumConversationMessages; index--) {
    const entry = entries[index]
    const remainingCharacters = maximumConversationCharacters - usedCharacters
    if (remainingCharacters <= 0)
      break

    if (entry.content.length <= remainingCharacters) {
      selected.push({
        content: entry.content,
        role: entry.kind === 'user_text' ? 'user' : 'assistant',
      })
      usedCharacters += entry.content.length
      continue
    }

    // A partially retained older turn is more misleading than omitting it. A
    // single oversized newest turn is the exception because dropping the
    // customer's current context would leave the model with no conversation.
    if (selected.length === 0 && remainingCharacters > truncationNotice.length) {
      selected.push({
        content: `${truncationNotice}${entry.content.slice(-(remainingCharacters - truncationNotice.length))}`,
        role: entry.kind === 'user_text' ? 'user' : 'assistant',
      })
    }
    break
  }

  return selected.reverse()
}

/**
 * Produces a bounded model-only representation of one browser tool result.
 * The caller must persist the original result before applying this policy.
 */
export function compactToolResultForModel(name: string, content: string, catalogItemIds?: ReadonlySet<string>) {
  // Persisted receipts retain environment/provenance. The model only needs
  // actual ingredients and operation status, not deployment labels to narrate.
  let parsed = parseToolPayload(content)
  const browser = nativeOrderingToolName(name).startsWith('browser_') && (parsed?.source === 'browser' || parsed?.source === 'host')
  if (browser && parsed) {
    // Project only at the model boundary. The Host and durable transcript keep
    // the original ok/status envelope and all confirmation/write evidence.
    const receipt = browserToolResult(name, parsed)
    const serialized = JSON.stringify(receipt)
    return serialized.length <= maximumModelToolResultCharacters ? serialized : compactBrowserResult(receipt, name)
  }
  if (parsed && catalogItemIds && !browser) {
    // The latest context already owns full cart/selection state. Retain this
    // receipt's changed line/outcome, rather than replaying older snapshots.
    const { cart: _cart, selection: _selection, ...receipt } = parsed
    parsed = receipt
  }
  if (parsed && catalogItemIds && renderedMenuToolNames.has(name)) {
    // The complete current catalog is already in the system context. Preserve
    // this read's result/conditions/presentation, not duplicate catalog metadata.
    const { catalog: _catalog, categories: _categories, ingredientDefinitions: _definitions, fulfillmentModes: _modes, customizable: _customizable, ...receipt } = parsed
    for (const key of ['items', 'possibleItems']) {
      if (!Array.isArray(receipt[key]))
        continue
      receipt[key] = receipt[key].map((item) => {
        if (isRecord(item) && typeof item.id === 'string' && catalogItemIds.has(item.id))
          return { id: item.id }
        return compactMenuItem(item, false)
      })
    }
    parsed = receipt
  }
  if (parsed)
    content = JSON.stringify(parsed, (key, value) => key === 'environment' || key === 'simulated' || (key === 'source' && (value === 'simulation' || value === 'merchant')) ? undefined : value)
  if (content.length <= maximumModelToolResultCharacters)
    return content

  const payload = parseToolPayload(content)
  if (!payload)
    return boundedToolPreview(name, content.length, content)

  const compacted = {
    ...compactTopLevelPayload(payload),
    modelContextCompacted: true,
    originalCharacterCount: content.length,
    toolName: name,
  }
  const serialized = JSON.stringify(compacted)
  if (serialized.length <= maximumModelToolResultCharacters)
    return serialized

  // Known ordering identifiers and state take precedence over descriptive
  // fields when an unusually large result still exceeds the first reduction.
  const essential = JSON.stringify({
    customerMessage: compactString(payload.customerMessage, 500),
    presentation: compactPresentation(payload.presentation),
    items: Array.isArray(payload.items) ? payload.items.slice(0, 8).map(item => compactMenuItem(item, false)).filter(Boolean) : undefined,
    item: compactMenuItem(payload.item, false),
    line: compactLine(payload.line),
    cart: compactCartForModel(payload.cart),
    queryState: compactJsonValue(payload.queryState, 0, 50),
    checkout: compactJsonValue(payload.checkout, 0, 120),
    modelContextCompacted: true,
    originalCharacterCount: content.length,
    toolName: name,
  })
  if (essential.length <= maximumModelToolResultCharacters)
    return essential

  return boundedToolPreview(name, content.length, essential)
}

/** Builds the small system-only note that accompanies the bounded transcript. */
export function createInteractionInstructions(state: KioskAgentInteractionState, scope: 'ordering' | 'checkout' = 'ordering') {
  const instructions = [
    '這是單一訪客、僅在本次點餐有效的互動摘要；不可向顧客提及摘要、session 或內部規則。',
    '購物車、金額、選項與取餐方式不是此摘要的真實來源；回答前如有需要，以本輪最新完整情境或點餐工具查詢為準。',
    '只有本輪成功的修改工具回執，才能確認已新增、移除或更換餐點。cart_get 是唯讀查詢，不會修改訂單；購物車為空只代表目前沒有餐點，不代表本輪執行了移除。顧客撤回尚未加入的訂購時，回覆先不點或尚未加入，不能說已移除或已刪除。',
    '先理解完整原句最後仍成立的需求。顧客同句提出後又撤回的訂購，不是仍要點餐，也不是詢問有沒有賣；尚未加入就簡短確認先不點，不先新增再刪除、不為撤回的餐點查菜單。若是在取消已存在的購物車項目，先核對目前實際項目再依明確需求移除；「不要了」的對象不明時先釐清，不能自行清空整筆訂單。',
    '顧客明確要求更換已加入購物車的餐點時，必須完成更換，不可把需求改成詢價或只介紹兩道餐點。先以本輪完整情境核對原 lineId、份數、替代品項與必要選項；缺少完整情境時才用 cart_get(display:false) 與 menu_get 核對。資料齊全時用 order_add_item 並帶 replaceLineId 一次更換，未另指定份數就保留原份數。不要另外呼叫 cart_remove_item，也不要逐步選餐。原餐點不唯一、替代品項不存在或資料未齊時，只問一個必要問題，保留原購物車。只有成功回執含 replacedLine 才可說已更換。',
    '分類瀏覽不是具體品名查證。顧客詢問某分類有哪些、種類或款式時，直接用 menu_recommend({action:"update",category:"POS 精確分類"}) 展示該分類，不先用 menu_get 展示。menu_get 的 category 只限 display:false 內部資料讀取；只有具體品名的精確查證才可用 menu_get 展示。兩者都是唯讀查詢，不新增訂單。',
    '開放式餐點需求由你讀完整原句與相關對話，理解否定、條件組合與最後的改口，不要求顧客改說固定句型。歧義可能不是查餐點時先釐清；確定需要查詢時，先使用本輪完整菜單；沒有完整菜單才用 menu_get(display:false) 取得真實品項、分類與成分資料；能用支援的 dietary、食材與價格條件表達時，交給工具依完整成分與店家標示驗證；分類或指定品項的排除則將真實品項 ID 傳給 menu_recommend 的 excludeItemIds，所有條件同時套用。無法由菜單資料確認食物範圍時先釐清，不猜品項歸屬。不能以品名文字猜素食或食材安全。單說不想吃飯可能是不想用餐，無法由上下文確定時先釐清，不自行指定替代品。偏好不是取消訂單；除非明確要求修改已點餐點，保留購物車。條件不變換批用 menu_recommend action:continue；補充排除且原正向查詢範圍仍適用時，可同時傳 excludeItemIds；若原範圍已不適用，或改口要放寬或替換原條件，用 action:update 只傳明示變更或 clear 取消的條件組；重新挑選使用 action:reset，不能用省略參數暗示重置。',
    '查詢與推薦必須完整保留顧客條件，不能因沒有符合結果而改查全部或放寬條件。工具 availability=NONE 就回答沒有；UNKNOWN 表示無法確認，CUSTOMIZATION_REQUIRED 不代表已符合。未支援或有歧義的條件先說明或澄清，不使用無條件查詢代替。素食只採用 POS 明確標示，不從缺少肉類成分自行推論；換一批沿用原條件，只有顧客明確修改需求才可變更。',
    '每一則顧客需求最多展示一批三項推薦。這一輪已取得推薦工具結果後，直接依結果簡短回覆，不能再次推薦、用 action:continue 自行換批，或用泛 menu_get 繼續擴充。recommendationAlreadyPresented=true 表示本輪推薦已完成，不是查無餐點或工具失敗。只有下一則顧客主動追問其他選擇，才可換下一批。顧客同句指定的餐點查詢、比較或訂單操作仍須依完整需求處理；內部 display:false 查詢不算展示推薦。',
  ]
  if (scope === 'checkout')
    instructions.push('目前使用獨立結帳上下文。依本輪畫面狀態、有效問題與工具結果操作；插話後的附和不代表同意付款，必要時重新詢問。')
  if (scope === 'ordering' && state.suggestedSubjectIds.length > 0)
    instructions.push(`已展示但尚未選擇的餐點 ID：${state.suggestedSubjectIds.join(', ')}。除非顧客主動提起，不可再次推薦這些餐點。`)
  if (scope === 'ordering' && state.dismissedSubjectIds.length > 0)
    instructions.push(`顧客已拒絕或要求替換的餐點 ID：${state.dismissedSubjectIds.join(', ')}。不可再次推薦。`)
  if (scope === 'ordering' && state.recentMenuSubjects?.length)
    instructions.push(`最近顯示或操作的餐點：${state.recentMenuSubjects.map(item => `${item.name}（${item.id}）`).join('、')}。可用於理解「剛剛那個」等指涉。`)
  if (state.cartSummary) {
    const serviceMode = state.cartSummary.fulfillmentMode ?? '尚未選擇'
    const lines = state.cartSummary.lines.length > 0
      ? state.cartSummary.lines.map(line => `${line.name}（lineId=${line.lineId}，${line.quantity} 份${formatOptions(line.options)}）`).join('、')
      : '空購物車'
    instructions.push(`最近一次成功工具結果的購物車快照：${lines}；共 ${state.cartSummary.itemCount} 份，總額 ${state.cartSummary.total} 元，用餐方式 ID：${serviceMode}（對顧客使用最新 POS fulfillmentModes 的 label，不自行翻譯 ID）。此快照用於延續對話；修改或結帳前仍以點餐工具的最新結果為準。`)
  }
  if (scope === 'ordering' && state.mode === 'decision_guidance') {
    instructions.push('顧客尚未做出決定。請停止重複開放式提問；若本輪尚未展示推薦，可簡短介紹 2 至 3 個尚未介紹的餐點，或只問一個可用語音回答的二選一問題。本輪已展示推薦就等待顧客回答，不自行再換一批，不要求改用點選。')
  }
  if (state.mode === 'touch_preferred') {
    // This persisted/wire mode is the final no-progress stage. It pauses
    // unsolicited prompts, without revoking the customer's voice interaction.
    instructions.push('暫停主動推薦與重複追問，等待顧客提出明確需求。顧客向本機說話時仍正常理解完整語音並簡短協助，不要求改用螢幕點選。背景對話或無法確認對象的聲音仍依說話對象規則處理，不主動追問。')
  }
  return instructions.join('\n')
}

/** Updates intent before the model responds, so "還有別的嗎" expands exploration instead of looking like a loop. */
export function recordCustomerInput(state: KioskAgentInteractionState, text: string): KioskAgentInteractionState {
  if (!requestsAlternatives(text))
    return { ...state, recentUserIntent: 'browse' }

  return {
    ...state,
    dismissedSubjectIds: mergeSubjectIds(state.dismissedSubjectIds, state.suggestedSubjectIds),
    recentUserIntent: 'request_alternatives',
    suggestedSubjectIds: [],
  }
}

/** Records actual rendered recommendation IDs rather than trusting model prose. */
export function recordToolResults(state: KioskAgentInteractionState, toolResults: Array<{ content: string, name: string }>): KioskAgentInteractionState {
  let next = state
  for (const toolResult of toolResults) {
    const payload = parseToolPayload(toolResult.content)
    const recentMenuSubjects = menuSubjects(payload)
    const cartSummary = compactCart(payload)
    if (recentMenuSubjects.length > 0 || cartSummary) {
      next = {
        ...next,
        ...(recentMenuSubjects.length > 0
          ? { recentMenuSubjects: mergeMenuSubjects(next.recentMenuSubjects ?? [], recentMenuSubjects) }
          : {}),
        ...(cartSummary ? { cartSummary } : {}),
      }
    }
    if (!renderedMenuToolNames.has(toolResult.name))
      continue
    const itemIds = recommendationIds(payload)
    if (itemIds.length === 0)
      continue

    const newIds = itemIds.filter(id => !next.dismissedSubjectIds.includes(id) && !next.suggestedSubjectIds.includes(id))
    if (newIds.length > 0) {
      next = {
        ...next,
        mode: 'active',
        noProgressCount: 0,
        recentAgentAction: { name: toolResult.name, subjectIds: itemIds },
        suggestedSubjectIds: mergeSubjectIds(next.suggestedSubjectIds, itemIds),
      }
      continue
    }

    const noProgressCount = next.noProgressCount + 1
    next = {
      ...next,
      mode: next.mode === 'decision_guidance' ? 'touch_preferred' : noProgressCount >= 2 ? 'decision_guidance' : next.mode,
      noProgressCount,
      recentAgentAction: { name: toolResult.name, subjectIds: itemIds },
    }
  }
  return next
}

/** Records the requested browser action even before its later tool result arrives. */
export function recordAssistantActions(state: KioskAgentInteractionState, toolCalls: Array<{ function: { name: string } }>): KioskAgentInteractionState {
  const latest = toolCalls.at(-1)
  return latest ? { ...state, recentAgentAction: { name: latest.function.name } } : state
}

function requestsAlternatives(text: string) {
  return /其他|別的|換(?:一批|一些|個|種)|不要這(?:些|個)|都不想要|重新推薦/.test(text)
}

function compactTopLevelPayload(payload: Record<string, unknown>) {
  const compacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'items' && Array.isArray(value)) {
      compacted.items = value.slice(0, 24).map(item => compactMenuItem(item, true)).filter(Boolean)
      continue
    }
    if (key === 'item') {
      compacted.item = compactMenuItem(value, true)
      continue
    }
    if (key === 'line') {
      compacted.line = compactLine(value)
      continue
    }
    if (key === 'cart') {
      compacted.cart = compactCartForModel(value)
      continue
    }
    if (key === 'presentation') {
      compacted.presentation = compactPresentation(value)
      continue
    }
    compacted[key] = compactJsonValue(value)
  }
  return compacted
}

/** Keep complete cart identities and questions; never clip a selectable option tree. */
function compactBrowserResult(payload: Record<string, unknown>, toolName: string) {
  // The whole index remains available, but none of its configuration trees is
  // partially truncated. Ask for one exact current product's full configuration.
  const detailTool = nativeOrderingToolName(toolName) === toolName ? 'browser_product_get' : 'get_menu_item_details'
  const index = Array.isArray(payload.products) ? payload.products.map(product => isRecord(product) ? { ref: product.ref, name: product.name, aliases: product.aliases, category: product.category, price: product.price, customizationAvailability: 'not_verified' } : product) : undefined
  const serialized = JSON.stringify({ ...payload, products: index, configurationLookupRequired: true, nextStep: `使用 ${detailTool} 查指定完整品名的最新規格，不猜測選項或版本。` })
  if (serialized.length <= maximumModelToolResultCharacters)
    return serialized
  // No partial configuration or partial cart may be mistaken for a complete
  // observation. A single-product lookup can still resolve a large index.
  return JSON.stringify({ outcome: 'action_result_requires_review', cartEffect: payload.cartEffect, customerMessage: compactString(payload.customerMessage, 1000), reason: '完整資料超出模型容量，未提供局部購物車或規格；不可推測購物車沒有餐點或重送操作。', nextStep: `指定完整品名時可用 ${detailTool} 查單一商品；購物車請在畫面上核對。` })
}

function compactMenuItem(value: unknown, includeDescription: boolean) {
  if (!isRecord(value))
    return undefined
  return {
    id: value.id,
    name: value.name,
    category: value.category,
    price: value.price,
    available: value.available,
    ...(includeDescription ? { description: compactString(value.description, 240) } : {}),
    // Preserve composition facts intact: truncating ingredients while keeping
    // complete=true would falsely imply that omitted ingredients are absent.
    composition: value.composition,
    recommendationTags: compactJsonValue(value.recommendationTags),
    optionGroups: compactJsonValue(value.optionGroups),
  }
}

function compactPresentation(value: unknown) {
  if (!isRecord(value))
    return undefined
  return {
    kind: value.kind,
    itemIds: Array.isArray(value.itemIds) ? value.itemIds.slice(0, 24) : undefined,
    reason: compactString(value.reason, 240),
    title: compactString(value.title, 120),
  }
}

function compactLine(value: unknown) {
  if (!isRecord(value))
    return undefined
  return {
    id: value.id,
    itemId: value.itemId,
    name: value.name,
    options: compactJsonValue(value.options),
    quantity: value.quantity,
    unitPrice: value.unitPrice,
    total: value.total,
  }
}

function compactCartForModel(value: unknown) {
  if (!isRecord(value))
    return undefined
  return {
    fulfillmentMode: value.fulfillmentMode,
    itemCount: value.itemCount,
    lines: Array.isArray(value.lines) ? value.lines.slice(0, 24).map(compactLine).filter(Boolean) : undefined,
    total: value.total,
  }
}

function compactString(value: unknown, maximumLength: number) {
  return typeof value === 'string' ? value.slice(0, maximumLength) : undefined
}

function boundedToolPreview(name: string, originalCharacterCount: number, source: string) {
  let previewLength = Math.min(2_000, source.length)
  let serialized = ''
  do {
    serialized = JSON.stringify({
      contentPreview: source.slice(0, previewLength),
      modelContextCompacted: true,
      originalCharacterCount,
      toolName: name,
    })
    previewLength = Math.floor(previewLength / 2)
  } while (serialized.length > maximumModelToolResultCharacters && previewLength > 0)
  return serialized
}

function compactJsonValue(value: unknown, depth = 0, maximumStringLength = 240): unknown {
  if (typeof value === 'string')
    return value.slice(0, maximumStringLength)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null)
    return value
  if (depth >= 4)
    return undefined
  if (Array.isArray(value))
    return value.slice(0, 24).map(item => compactJsonValue(item, depth + 1, maximumStringLength))
  if (!isRecord(value))
    return undefined
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 32)
      .map(([key, nestedValue]) => [key, compactJsonValue(nestedValue, depth + 1, maximumStringLength)]),
  )
}

function parseToolPayload(content: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(content)
    return isRecord(parsed) ? parsed : undefined
  }
  catch {
    return undefined
  }
}

function recommendationIds(payload: Record<string, unknown> | undefined) {
  if (!payload || !isRecord(payload.presentation))
    return []
  const itemIds = Array.isArray(payload.presentation.itemIds)
    ? payload.presentation.itemIds.filter((itemId): itemId is string => typeof itemId === 'string' && itemId.length > 0)
    : []
  const subjectItemIds = Array.isArray(payload.presentation.subjects)
    ? payload.presentation.subjects.flatMap((subject) => {
        if (!isRecord(subject) || !Array.isArray(subject.itemIds))
          return []
        return subject.itemIds.filter((itemId): itemId is string => typeof itemId === 'string' && itemId.length > 0)
      })
    : []
  return [...new Set([...itemIds, ...subjectItemIds])]
}

function menuSubjects(payload: Record<string, unknown> | undefined): KioskAgentMenuSubject[] {
  if (!payload)
    return []
  const presentedIds = new Set(recommendationIds(payload))
  const subjects: KioskAgentMenuSubject[] = []
  if (presentedIds.size > 0 && Array.isArray(payload.items)) {
    for (const item of payload.items) {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string')
        continue
      if (!presentedIds.has(item.id))
        continue
      subjects.push({ id: item.id, name: item.name })
    }
  }
  if (isRecord(payload.item) && typeof payload.item.id === 'string' && typeof payload.item.name === 'string')
    subjects.push({ id: payload.item.id, name: payload.item.name })
  if (isRecord(payload.line) && typeof payload.line.itemId === 'string' && typeof payload.line.name === 'string')
    subjects.push({ id: payload.line.itemId, name: payload.line.name })
  return subjects
}

function compactCart(payload: Record<string, unknown> | undefined): KioskAgentCartSummary | undefined {
  const cart = payload?.cart
  if (!isRecord(cart) || !Array.isArray(cart.lines))
    return undefined
  const cartLines = cart.lines
  if (typeof cart.itemCount !== 'number' || typeof cart.total !== 'number')
    return undefined
  const lines: KioskAgentCartSummary['lines'] = []
  for (const line of cartLines) {
    if (!isRecord(line) || typeof line.id !== 'string' || typeof line.itemId !== 'string' || typeof line.name !== 'string' || typeof line.quantity !== 'number')
      continue
    lines.push({
      itemId: line.itemId,
      lineId: line.id,
      name: line.name,
      options: stringRecord(line.options),
      quantity: line.quantity,
    })
  }
  const fulfillmentMode = cart.fulfillmentMode === 'dine-in' || cart.fulfillmentMode === 'takeout'
    ? cart.fulfillmentMode
    : undefined
  return {
    ...(fulfillmentMode ? { fulfillmentMode } : {}),
    itemCount: cart.itemCount,
    lines,
    total: cart.total,
  }
}

function mergeMenuSubjects(existing: KioskAgentMenuSubject[], additions: KioskAgentMenuSubject[]) {
  const merged = new Map(existing.map(item => [item.id, item]))
  for (const item of additions) {
    merged.delete(item.id)
    merged.set(item.id, item)
  }
  return [...merged.values()].slice(-maximumRecentMenuSubjects)
}

function formatOptions(options: Record<string, string>) {
  const values = Object.values(options)
  return values.length > 0 ? `，選項：${values.join('、')}` : ''
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value))
    return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeSubjectIds(existing: string[], additions: string[]) {
  return [...new Set([...existing, ...additions])].slice(-maximumRememberedSubjects)
}
