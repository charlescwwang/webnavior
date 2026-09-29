import { readonly, shallowRef } from 'vue'

export type KioskConversationProgressPhase = 'applying-action' | 'finding-menu' | 'understanding'

export interface KioskConversationProgress {
  message: string
  phase: KioskConversationProgressPhase
  turnId: number
}

const menuDiscoveryTools = new Set([
  'menu_get',
  'menu_recommend',
  'menu_show_recommendations',
])

function progressForTool(turnId: number, toolName: string, message?: string): KioskConversationProgress {
  if (menuDiscoveryTools.has(toolName)) {
    return {
      message: message ?? '幫您找找適合的餐點。',
      phase: 'finding-menu',
      turnId,
    }
  }

  if (toolName.startsWith('menu_') || toolName.startsWith('cart_') || toolName.startsWith('order_')) {
    return {
      message: message ?? '我幫您確認一下這份餐點。',
      phase: 'applying-action',
      turnId,
    }
  }

  return {
    message: message ?? '我確認一下。',
    phase: 'understanding',
    turnId,
  }
}

/**
 * Projects only verified conversation and tool events into customer-safe
 * progress copy. A turn id keeps a cancelled request from clearing a newer
 * customer's thought bubble.
 */
export function useKioskConversationProgress() {
  const progress = shallowRef<KioskConversationProgress>()

  function start(turnId: number, message = '正在理解您的需求…') {
    progress.value = {
      message,
      phase: 'understanding',
      turnId,
    }
  }

  function selectTool(turnId: number, toolName: string, message?: string) {
    if (progress.value?.turnId !== turnId)
      return
    progress.value = progressForTool(turnId, toolName, message)
  }

  function extendWait(turnId: number) {
    const current = progress.value
    if (!current || current.turnId !== turnId)
      return

    progress.value = {
      ...current,
      message: current.phase === 'finding-menu'
        ? '我還在確認目前菜單。'
        : current.phase === 'applying-action'
          ? '我還在確認這份餐點。'
          : '我還在確認您的需求。',
    }
  }

  function finish(turnId: number) {
    if (progress.value?.turnId === turnId)
      progress.value = undefined
  }

  return {
    extendWait,
    finish,
    progress: readonly(progress),
    selectTool,
    start,
  }
}
