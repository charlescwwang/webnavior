import type { ServiceAction, ServiceOperation, ServiceStep } from '@proj-airi/stage-shared/service-operation'

import { errorMessageFrom } from '@moeru/std'

/**
 * One document/operation owns the actual actions and their cursor. Cancellation
 * before dispatch has no effect; once dispatched, verification must still settle.
 */
export function createOperation(input: {
  documentId: string
  operationId: string
  signal: AbortSignal
  follow: (target: HTMLElement, label: string, dispatch: (onPress?: () => void) => Promise<void>, prepare: () => Promise<void>) => Promise<boolean>
}) {
  const started = performance.now()
  const steps: ServiceStep[] = []
  let busy = false
  const assertCurrent = () => {
    if (input.signal.aborted)
      throw new Error('操作已由使用者接手，尚未派送下一步。')
    if (document.visibilityState === 'hidden')
      throw new Error('操作畫面已隱藏，尚未派送下一步。')
  }
  return {
    snapshot(): ServiceOperation {
      return { documentId: input.documentId, operationId: input.operationId, durationMs: performance.now() - started, steps: steps.map(step => ({ ...step, ...(step.target ? { target: { ...step.target } } : {}) })) }
    },
    async run<T>(action: ServiceAction, label: string, effect: ServiceStep['effect'], locate: () => HTMLElement | undefined, dispatch: (accept: () => void) => Promise<T>, verify: (result: T) => Promise<void>, options: { deferredDispatch?: boolean, target?: ServiceStep['target'] } = {}): Promise<T> {
      assertCurrent()
      if (busy)
        throw new Error('同一操作不能同時派送兩個畫面步驟。')
      if (steps.length >= 100)
        throw new Error('畫面步驟過多，請重新確認需求。')
      busy = true
      const step: ServiceStep = { id: `${input.operationId}:${steps.length + 1}`, action, label, effect, ...(options.target ? { target: options.target } : {}), state: 'locating', startedMs: performance.now() - started }
      steps.push(step)
      let result!: T
      let dispatched = false
      try {
        const target = locate()
        if (!target?.isConnected || !target.getClientRects().length)
          throw new Error(`目前無法定位「${label}」，尚未執行。`)
        const blocked = () => {
          assertCurrent()
          // Scrolling, async checks or Vue may replace a control entirely.
          if (locate() !== target || !target.isConnected)
            throw new Error(`「${label}」已變更，尚未執行。`)
          if (target.matches(':disabled, [aria-disabled="true"]'))
            return `「${label}」尚不可操作，尚未執行。`
          const bounds = target.getBoundingClientRect()
          const x = Math.max(0, Math.min(innerWidth - 1, bounds.left + bounds.width / 2))
          const y = Math.max(0, Math.min(innerHeight - 1, bounds.top + bounds.height / 2))
          const hit = document.elementFromPoint(x, y)
          if (!target.getClientRects().length || !hit || !target.contains(hit))
            return `「${label}」被其他畫面遮住，尚未執行。`
        }

        const prepare = async () => {
          step.arrivedMs ??= performance.now() - started
          // PB may finish its HTTP write before removing its loading mask.
          // Wait on actual actionability, not a blanket delay or a forced click.
          const deadline = performance.now() + 2500
          let reason = blocked()
          while (reason) {
            if (performance.now() >= deadline)
              throw new Error(reason)
            await new Promise(resolve => setTimeout(resolve, 25))
            reason = blocked()
          }
          step.state = 'ready'
          step.readyMs = performance.now() - started
        }
        step.state = 'moving'
        const followed = await input.follow(target, label, async (onPress) => {
          await prepare()
          step.state = 'executing'
          const accept = () => {
            const reason = blocked()
            if (reason)
              throw new Error(reason)
            step.dispatchMs = performance.now() - started
            dispatched = true
            onPress?.()
          }
          // Commerce may re-read facts asynchronously before its actual click.
          // Such preparation must not be mislabeled as an accepted write.
          if (!options.deferredDispatch)
            accept()
          result = await dispatch(accept)
          step.state = 'verifying'
          await verify(result)
        }, prepare)
        if (!followed && !dispatched)
          throw new Error('手勢或目標已失效，尚未執行。')
        step.state = 'completed'
        return result
      }
      catch (error) {
        step.reason = errorMessageFrom(error) ?? '目前操作未完成。'
        step.state = dispatched && effect === 'cart' ? 'unknown' : input.signal.aborted ? 'cancelled' : 'failed'
        throw error
      }
      finally {
        step.finishedMs = performance.now() - started
        busy = false
      }
    },
  }
}
