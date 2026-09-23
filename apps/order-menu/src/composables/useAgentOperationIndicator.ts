import { computed, shallowRef } from 'vue'

export interface AgentOperationIndicatorOptions {
  minimumVisibleMs?: number
}

/**
 * Keeps WebMCP work perceptible when a local tool completes within Vue's
 * render batch. Each started operation receives its own minimum display lease.
 */
export function useAgentOperationIndicator(options: AgentOperationIndicatorOptions = {}) {
  const minimumVisibleMs = options.minimumVisibleMs ?? 600
  const activeOperationCount = shallowRef(0)
  const startedAt: number[] = []
  const pendingEnds = new Set<ReturnType<typeof setTimeout>>()
  const isOperating = computed(() => activeOperationCount.value > 0)

  function start() {
    startedAt.push(Date.now())
    activeOperationCount.value++
  }

  function end() {
    const operationStartedAt = startedAt.shift()
    if (operationStartedAt === undefined)
      return

    const remainingVisibleMs = Math.max(0, minimumVisibleMs - (Date.now() - operationStartedAt))
    const timer = setTimeout(() => {
      pendingEnds.delete(timer)
      activeOperationCount.value = Math.max(0, activeOperationCount.value - 1)
    }, remainingVisibleMs)
    pendingEnds.add(timer)
  }

  function dispose() {
    for (const timer of pendingEnds)
      clearTimeout(timer)
    pendingEnds.clear()
    startedAt.length = 0
    activeOperationCount.value = 0
  }

  return { dispose, end, isOperating, start }
}
