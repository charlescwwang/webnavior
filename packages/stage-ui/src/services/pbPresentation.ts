import type { ProductPresentation } from '@proj-airi/stage-shared/product-presentation'

// PB controls use distance-sensitive movement without changing the owned Menu's pace.
const pace = { minimumTravelMs: 280, maximumTravelMs: 1200, speedPixelsPerSecond: 900, dwellMs: 180, pressMs: 150 }

/** Keep nearby controls quick to reach while cross-panel travel remains readable. */
function travelDuration(distance: number) {
  return Math.min(pace.maximumTravelMs, Math.max(pace.minimumTravelMs, distance / pace.speedPixelsPerSecond * 1000))
}

/**
 * Owns one visual cue in the vendor document. It never clicks, fills or writes.
 * Trusted input revokes operation cues; introductions temporarily lock input.
 * Navigation revokes visual work; already dispatched cart work is
 * owned by the cart coordinator and must still settle independently.
 */
export function createPresentation() {
  let revision = 0
  let active: AbortController | undefined
  let root: HTMLElement | undefined
  let currentHand: HTMLElement | undefined
  // Reception maintenance spans SPA navigation; ordinary cue cancellation must
  // not expose the intermediate cart. Its caller owns cleanup in finally.
  let maintenance: HTMLElement | undefined
  let introduction: symbol | undefined
  let position = { x: 32, y: 64 }
  function retire(preserveRoot: boolean) {
    // A new step can supersede a moving cue. Continue from its rendered location,
    // not the previous endpoint, before cancelling that animation.
    if (currentHand?.isConnected && root?.dataset.phase === 'moving') {
      const bounds = currentHand.getBoundingClientRect()
      position = { x: bounds.left, y: bounds.top }
    }
    revision++
    active?.abort()
    active = undefined
    if (!preserveRoot) {
      root?.remove()
      root = undefined
      currentHand = undefined
    }
  }
  function cancel() {
    introduction = undefined
    retire(false)
  }
  const input = (event: Event) => {
    if (!event.isTrusted)
      return
    if (introduction) {
      // Keep native controls hit-testable for our scroll/actionability checks.
      // Capture only real customer input before PB or its takeover handler sees it.
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    else if (['pointerdown', 'keydown', 'wheel'].includes(event.type)) {
      cancel()
    }
  }
  for (const event of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'keydown', 'keyup', 'wheel', 'touchstart', 'touchmove', 'touchend'])
    window.addEventListener(event, input, { capture: true, passive: false })
  document.addEventListener('inertia:start', cancel)
  window.addEventListener('pagehide', cancel)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden')
      cancel()
  })

  return {
    cancel,
    revision: () => revision,
    isCovered: () => Boolean(maintenance),
    /** Locks one introduction batch, including movement between dishes; cancel releases it immediately. */
    async introduce<T>(work: () => Promise<T>): Promise<T> {
      const owner = Symbol('introduction')
      introduction = owner
      try {
        return await work()
      }
      finally {
        // A cancelled batch may settle after a replacement starts.
        if (introduction === owner)
          introduction = undefined
      }
    },
    /** Masks fast lifecycle controls while leaving native actionability checks intact. */
    async cover<T>(work: () => Promise<T>): Promise<T> {
      cancel()
      const container = document.createElement('div')
      container.dataset.webnaviorMaintenance = 'true'
      container.setAttribute('aria-hidden', 'true')
      container.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;background:rgb(248,250,252);display:grid;place-items:center;'
      const shadow = container.attachShadow({ mode: 'closed' })
      const style = document.createElement('style')
      style.textContent = '.spinner{width:48px;height:48px;border:5px solid #d8e6e7;border-top-color:#287a7c;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation:none}}'
      const spinner = document.createElement('div')
      spinner.className = 'spinner'
      shadow.append(style, spinner)
      maintenance = container
      document.documentElement.append(container)
      // The cover is pointer-transparent so our hit tests still see PB's real
      // controls/overlays. Capture trusted input instead: customers must not
      // unknowingly click a covered cart, while programmatic native clicks run.
      const blockInput = (event: Event) => {
        if (event.isTrusted) {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
      }
      const events = ['pointerdown', 'click', 'keydown', 'wheel']
      for (const event of events)
        document.addEventListener(event, blockInput, { capture: true, passive: false })
      try {
        return await work()
      }
      finally {
        for (const event of events)
          document.removeEventListener(event, blockInput, { capture: true })
        container.remove()
        maintenance = undefined
      }
    },
    async show(products: ProductPresentation['products'], target?: HTMLElement, press = false, related: HTMLElement[] = [], control?: { label: string, dispatch: (onPress: () => void) => Promise<void>, prepare?: () => Promise<void> }, holdMs = 0): Promise<ProductPresentation> {
      const startedAt = performance.now()
      const previous = root
      retire(true)
      if (!products.length && !control) {
        cancel()
        return { products: [], cue: 'cleared' }
      }
      if (!target?.isConnected || !target.getClientRects().length) {
        cancel()
        return { products, cue: 'target-unavailable' }
      }
      const owner = new AbortController()
      active = owner
      const signal = owner.signal
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
      // All waits have a deadline and abort listener. A superseded cue cannot
      // awaken later and move the new visitor's pointer or invoke an operation.
      const wait = (ms: number) => new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve()
          return
        }
        let timer: ReturnType<typeof setTimeout>
        const finish = () => {
          clearTimeout(timer)
          signal.removeEventListener('abort', finish)
          resolve()
        }
        timer = setTimeout(finish, ms)
        signal.addEventListener('abort', finish, { once: true })
      })
      const container = document.createElement('div')
      container.dataset.webnaviorPresentation = 'true'
      container.dataset.mode = control ? 'operation' : 'presentation'
      container.dataset.productNames = JSON.stringify(products.map(product => product.name))
      container.dataset.phase = 'moving'
      container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;'
      const shadow = container.attachShadow({ mode: 'closed' })
      const style = document.createElement('style')
      style.textContent = ':host{pointer-events:none!important} .frame{position:fixed;box-sizing:border-box;border:4px solid #ec7a13;border-radius:16px;box-shadow:0 0 0 5px #fff9,0 0 24px #ed8c3280} .hand{position:fixed;font-size:44px;line-height:1;filter:drop-shadow(0 3px 3px #0008);transform-origin:30% 20%} .label{position:fixed;max-width:75vw;padding:6px 12px;border-radius:10px;background:#31291f;color:white;font:600 16px sans-serif}'
      const frames = [target, ...related.filter(element => element !== target)].map((element) => {
        const frame = document.createElement('div')
        frame.className = 'frame'
        return { element, frame, text: element.textContent }
      })
      const hand = document.createElement('div')
      hand.className = 'hand'
      currentHand = hand
      hand.textContent = '👆'
      hand.style.left = `${position.x}px`
      hand.style.top = `${position.y}px`
      const label = document.createElement('div')
      label.className = 'label'
      label.textContent = control?.label ?? products.map(product => product.name).join('、')
      shadow.append(style, ...frames.map(({ frame }) => frame), hand, label)
      document.documentElement.append(container)
      root = container
      previous?.remove()
      const measure = () => {
        const current = target.getBoundingClientRect()
        for (const { element, frame } of frames) {
          const bounds = element.getBoundingClientRect()
          frame.style.cssText = `left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height}px`
          frame.hidden = !element.isConnected || bounds.bottom <= 0 || bounds.top >= innerHeight
        }
        label.style.left = `${Math.max(4, Math.min(current.left, innerWidth - 200))}px`
        label.style.top = `${Math.max(4, Math.min(current.top - 36, innerHeight - 44))}px`
      }
      measure()
      window.addEventListener('scroll', measure, { capture: true, passive: true, signal })
      window.addEventListener('resize', measure, { signal })
      const sizes = new ResizeObserver(measure)
      for (const { element } of frames)
        sizes.observe(element)
      const layout = new MutationObserver(() => {
        // Vue can reuse a button for a different product. A retained element
        // identity alone is not permission to keep pointing at its new contents.
        if (frames.some(({ element, text }) => !element.isConnected || (!control && element.textContent !== text)))
          cancel()
        else
          measure()
      })
      layout.observe(document.body, { childList: true, subtree: true, characterData: true })
      signal.addEventListener('abort', () => {
        sizes.disconnect()
        layout.disconnect()
      }, { once: true })
      const before = target.getBoundingClientRect()
      const x = Math.max(0, Math.min(innerWidth - 1, before.left + before.width / 2))
      const y = Math.max(0, Math.min(innerHeight - 1, before.top + before.height / 2))
      let hit = document.elementFromPoint(x, y)
      const targetRoot = target.getRootNode()
      // The large table buttons live in our shadow root. A hit on their host
      // is not an overlay; resolve inside it before deciding to scroll again.
      if (targetRoot instanceof ShadowRoot && hit === targetRoot.host)
        hit = targetRoot.elementFromPoint(x, y)
      // A sticky header can cover an otherwise viewport-visible control.
      // Center it before actionability checks; unknown overlays still block.
      if (before.top < 0 || before.bottom > innerHeight || before.left < 0 || before.right > innerWidth || !hit || !target.contains(hit)) {
        // Keep the hand inside this PB viewport while its actual content
        // scrolls, rather than creating the hand only after scroll completion.
        const origin = { x: Math.max(4, Math.min(innerWidth / 2, innerWidth - 48)), y: Math.max(4, Math.min(innerHeight * 0.6, innerHeight - 100)) }
        hand.style.left = `${origin.x}px`
        hand.style.top = `${origin.y}px`
        label.textContent = `捲動至${control?.label ?? products.map(product => product.name).join('、')}`
        const travelMs = reduced ? 0 : travelDuration(Math.hypot(origin.x - position.x, origin.y - position.y))
        const approach = hand.animate([{ translate: `${position.x - origin.x}px ${position.y - origin.y}px` }, { translate: '0 0' }], { duration: travelMs, fill: 'forwards' })
        signal.addEventListener('abort', () => approach.cancel(), { once: true })
        await wait(travelMs)
        approach.cancel()
        if (signal.aborted)
          return { products: [], cue: 'cancelled' }
        container.dataset.phase = 'scrolling'
        const delta = before.top < 0 ? 80 : -80
        const gesture = hand.animate([{ translate: '0 0' }, { translate: `0 ${delta}px` }], { duration: reduced ? 0 : 300, fill: 'forwards', easing: 'ease-in-out' })
        signal.addEventListener('abort', () => gesture.cancel(), { once: true })
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduced ? 'instant' : 'smooth' })
        // Observe actual rectangle stability, with a bounded smooth-scroll wait.
        let last = target.getBoundingClientRect().top
        let stable = 0
        for (let elapsed = 0; elapsed < 1200 && !signal.aborted; elapsed += 60) {
          await wait(60)
          const bounds = target.getBoundingClientRect()
          const top = bounds.top
          stable = Math.abs(top - last) < 0.5 ? stable + 1 : 0
          last = top
          // Smooth scrolling or an asynchronous layout may not have started
          // yet. A stationary offscreen target is not a completed arrival.
          if (stable >= 2 && bounds.bottom > 0 && bounds.top < innerHeight)
            break
        }
        gesture.cancel()
        position = { x: origin.x, y: origin.y + delta }
        label.textContent = control?.label ?? products.map(product => product.name).join('、')
      }
      if (signal.aborted)
        return { products: [], cue: 'cancelled' }
      const rect = target.getBoundingClientRect()
      if (!target.isConnected || rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight) {
        if (active === owner)
          cancel()
        return { products, cue: 'target-unavailable' }
      }
      const destination = { x: Math.max(4, Math.min(rect.left + rect.width / 2, innerWidth - 48)), y: Math.max(4, Math.min(rect.top + rect.height / 2, innerHeight - 48)) }
      const duration = reduced ? 0 : travelDuration(Math.hypot(destination.x - position.x, destination.y - position.y))
      hand.style.left = `${destination.x}px`
      hand.style.top = `${destination.y}px`
      container.dataset.phase = 'moving'
      const movement = hand.animate([{ translate: `${position.x - destination.x}px ${position.y - destination.y}px` }, { translate: '0px 0px' }], { duration, easing: 'ease-in-out', fill: 'forwards' })
      signal.addEventListener('abort', () => movement.cancel(), { once: true })
      await wait(duration)
      position = destination
      container.dataset.phase = 'hovering'
      if (press && !signal.aborted) {
        // Actionability and a readable pause share the same time window. Final
        // identity/current-owner checks still run at the actual dispatch boundary.
        await Promise.all([wait(reduced ? 0 : pace.dwellMs), control?.prepare?.()])
        let release: Promise<void> | undefined
        const onPress = () => {
          if (signal.aborted)
            return
          container.dataset.phase = 'pressing'
          hand.style.transform = 'scale(.8)'
          // Release is independent from HTTP/preflight verification. Keeping a
          // finger pressed until the website responds makes an ordinary tap a hold.
          release = wait(reduced ? 0 : pace.pressMs).then(() => {
            hand.style.transform = ''
            container.dataset.phase = 'waiting'
            // A dispatched tap has finished visually even if native readback
            // is pending. Hide its frame/hand without aborting verification or
            // changing the operation's ownership revision. Discovery cues stay.
            if (control)
              container.hidden = true
          })
        }
        if (!signal.aborted) {
          if (control) {
            try {
              await control.dispatch(onPress)
            }
            catch (error) {
              if (active === owner)
                cancel()
              throw error
            }
          }
          else {
            onPress()
          }
          await release
        }
      }
      if (!press && holdMs > 0)
        await wait(holdMs)
      container.dataset.phase = 'settled'
      // A visible frame expires independently; it is never a durable target.
      if (!signal.aborted) {
        const expiry = setTimeout(() => {
          if (active === owner)
            cancel()
        }, 8000)
        signal.addEventListener('abort', () => clearTimeout(expiry), { once: true })
      }
      return signal.aborted ? { products: [], cue: 'cancelled', durationMs: performance.now() - startedAt } : { products, cue: 'shown', durationMs: performance.now() - startedAt }
    },
  }
}
