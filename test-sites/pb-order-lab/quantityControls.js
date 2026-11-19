const selector = '[data-action="step"], [data-action="line-quantity"]'

/**
 * One page owns one held quantity control. Match Element Plus's press/Enter
 * contract; click by itself is deliberately inert. Stop on release, removal,
 * page exit or loss of focus so an old dialog cannot keep changing quantities.
 */
export function installQuantityControls(adjust) {
  let held
  const lifecycle = new AbortController()
  const stop = () => {
    if (!held)
      return
    clearTimeout(held.delay)
    clearInterval(held.interval)
    held = undefined
  }
  const usable = control => control.isConnected && !control.matches(':disabled, [aria-disabled="true"], .is-disabled')
  const press = (event) => {
    const control = event.target.closest?.(selector)
    if (event.button !== 0 || !control)
      return
    stop()
    if (!usable(control))
      return
    adjust(control)
    const current = { control }
    held = current
    // Element Plus v-repeat-click: one immediate step, then a 600 ms delay
    // before 100 ms repeats. These model the component, not network latency.
    // https://github.com/element-plus/element-plus/blob/dev/packages/directives/repeat-click/index.ts
    current.delay = setTimeout(() => {
      if (held !== current)
        return
      current.interval = setInterval(() => {
        if (held !== current)
          return
        if (!usable(control)) {
          stop()
          return
        }
        adjust(control)
      }, 100)
    }, 600)
  }
  document.addEventListener('mousedown', press, { signal: lifecycle.signal })
  document.addEventListener('mouseup', stop, { capture: true, signal: lifecycle.signal })
  document.addEventListener('keydown', (event) => {
    const control = event.target.closest?.(selector)
    if (event.key === 'Enter' && control) {
      event.preventDefault()
      if (usable(control))
        adjust(control)
    }
  }, { signal: lifecycle.signal })
  window.addEventListener('blur', stop, { signal: lifecycle.signal })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden')
      stop()
  }, { signal: lifecycle.signal })
  window.addEventListener('pagehide', () => {
    stop()
  }, { signal: lifecycle.signal })
  // Keep listeners across a back/forward-cache restore; explicit disposal is
  // reserved for the owning page replacing this controller.
  return {
    stop,
    dispose: () => {
      stop()
      lifecycle.abort()
    },
  }
}
