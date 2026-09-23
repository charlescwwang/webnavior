/**
 * Per-visitor, short-lived context used to keep an ordering conversation
 * coherent. This deliberately stores only compact decisions and opaque menu
 * subject IDs; the order-menu remains the source of truth for the cart.
 */
export type KioskAgentInteractionMode = 'active' | 'decision_guidance' | 'touch_preferred'

export interface KioskAgentInteractionState {
  dismissedSubjectIds: string[]
  mode: KioskAgentInteractionMode
  noProgressCount: number
  recentAgentAction?: { name: string, subjectIds?: string[] }
  recentUserIntent?: 'browse' | 'request_alternatives' | 'unknown'
  suggestedSubjectIds: string[]
}

export const defaultKioskAgentInteractionState: KioskAgentInteractionState = {
  dismissedSubjectIds: [],
  mode: 'active',
  noProgressCount: 0,
  suggestedSubjectIds: [],
}

const maximumRememberedSubjects = 24

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
    if (toolResult.name !== 'menu_show_recommendations')
      continue
    const itemIds = recommendationIds(toolResult.content)
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

function recommendationIds(content: string) {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || !('presentation' in parsed))
      return []
    const presentation = parsed.presentation
    if (!presentation || typeof presentation !== 'object' || !('itemIds' in presentation) || !Array.isArray(presentation.itemIds))
      return []
    return presentation.itemIds.filter((itemId): itemId is string => typeof itemId === 'string' && itemId.length > 0)
  }
  catch {
    return []
  }
}

function mergeSubjectIds(existing: string[], additions: string[]) {
  return [...new Set([...existing, ...additions])].slice(-maximumRememberedSubjects)
}
