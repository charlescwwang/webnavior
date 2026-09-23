/**
 * Per-visitor, short-lived context used to keep an ordering conversation
 * coherent. This deliberately stores compact references and the latest
 * successful cart summary; the order-menu remains the source of truth.
 */
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
const maximumConversationCharacters = 16_000
const maximumConversationMessages = 48
const maximumModelToolResultCharacters = 8_000
const renderedMenuToolNames = new Set(['menu_get', 'menu_recommend', 'menu_show_recommendations'])

/**
 * Keeps the latest complete conversational turns within a provider-independent
 * character ceiling. The newest single turn is truncated only when that turn
 * alone exceeds the entire budget.
 */
export function selectBoundedConversationText(entries: KioskConversationTextEntry[]): KioskConversationMessage[] {
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
export function compactToolResultForModel(name: string, content: string) {
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
export function createInteractionInstructions(state: KioskAgentInteractionState) {
  const instructions = [
    '這是單一訪客、僅在本次點餐有效的互動摘要；不可向顧客提及摘要、session 或內部規則。',
    '購物車、金額、選項與取餐方式不是此摘要的真實來源；回答前如有需要，必須使用點餐工具查詢。',
  ]
  if (state.suggestedSubjectIds.length > 0)
    instructions.push(`已展示但尚未選擇的餐點 ID：${state.suggestedSubjectIds.join(', ')}。除非顧客主動提起，不可再次推薦這些餐點。`)
  if (state.dismissedSubjectIds.length > 0)
    instructions.push(`顧客已拒絕或要求替換的餐點 ID：${state.dismissedSubjectIds.join(', ')}。不可再次推薦。`)
  if (state.recentMenuSubjects?.length)
    instructions.push(`最近顯示或操作的餐點：${state.recentMenuSubjects.map(item => `${item.name}（${item.id}）`).join('、')}。可用於理解「剛剛那個」等指涉。`)
  if (state.cartSummary) {
    const serviceMode = state.cartSummary.fulfillmentMode === 'dine-in'
      ? '內用'
      : state.cartSummary.fulfillmentMode === 'takeout'
        ? '外帶'
        : '尚未選擇'
    const lines = state.cartSummary.lines.length > 0
      ? state.cartSummary.lines.map(line => `${line.name}（lineId=${line.lineId}，${line.quantity} 份${formatOptions(line.options)}）`).join('、')
      : '空購物車'
    instructions.push(`最近一次成功工具結果的購物車快照：${lines}；共 ${state.cartSummary.itemCount} 份，總額 ${state.cartSummary.total} 元，用餐方式：${serviceMode}。此快照用於延續對話；修改或結帳前仍以點餐工具的最新結果為準。`)
  }
  if (state.mode === 'decision_guidance') {
    instructions.push('顧客尚未做出決定。請停止重複開放式提問，改為展示 2 至 3 個尚未展示的可點選選項，或只問一個可直接回答的二選一問題。')
  }
  if (state.mode === 'touch_preferred')
    instructions.push('畫面點選目前優先。不要主動追問；只有顧客主動輸入時才簡短協助，並優先引導他直接使用畫面。')
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
  if (!payload || !isRecord(payload.presentation) || !Array.isArray(payload.presentation.itemIds))
    return []
  return payload.presentation.itemIds.filter((itemId): itemId is string => typeof itemId === 'string' && itemId.length > 0)
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
