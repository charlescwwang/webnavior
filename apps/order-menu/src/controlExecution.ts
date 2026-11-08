import type { AgentAction } from './webmcp'

/** Binds one authorized operation to the corresponding real UI click. */
export function createControlExecution(options: {
  resolve: (id: string) => HTMLElement | undefined
  animate: (action: AgentAction) => Promise<void>
}) {
  let disposed = false
  let running = false
  let pending: { id: string, apply: () => unknown, result?: Promise<unknown> } | undefined

  return {
    /** UI event handlers share this entry with manual clicks; only the active control can commit. */
    handle<T>(id: string, manual: () => T): T | Promise<unknown> {
      if (!pending)
        return manual()
      if (pending.id !== id || pending.result)
        throw new Error('The clicked control does not belong to the current operation.')
      // Capture rejection in the awaiting tool, including async submission. The
      // event handler must not start a second manual tool invocation.
      pending.result = Promise.resolve().then(pending.apply)
      return pending.result
    },
    async execute<T>(action: AgentAction, apply: () => T | Promise<T>): Promise<T> {
      if (disposed || running)
        throw new Error('Another UI operation is active or the menu was closed.')
      running = true
      try {
        const id = action.controlId ?? `item:${action.targetId}`
        await options.animate(action)
        const target = options.resolve(id)
        if (disposed || !target?.isConnected || target.getClientRects().length === 0 || getComputedStyle(target).visibility !== 'visible' || target.matches(':disabled, [aria-disabled="true"]'))
          throw new Error('The requested control is not visible or available.')
        const request = { id, apply, result: undefined as Promise<unknown> | undefined }
        pending = request
        if (action.inputValue !== undefined) {
          if (!(target instanceof HTMLInputElement))
            throw new Error('The requested text field is not an input control.')
          target.value = action.inputValue
          target.dispatchEvent(new Event('input', { bubbles: true }))
        }
        else {
          target.click()
        }
        if (!request.result)
          throw new Error('The requested control did not acknowledge its click.')
        // The exact callback is bound before click, so a late or repeated event
        // cannot commit another command. The resulting value belongs to T.
        return await request.result as T
      }
      finally {
        pending = undefined
        running = false
      }
    },
    dispose() {
      disposed = true
    },
  }
}
