/** Positions each menu visit using PB's category tabs and their sticky-header offset. */
export function installMenuViewport(menuPath: string, cartPath: string) {
  let positioned = false
  const referrer = document.referrer ? new URL(document.referrer) : undefined
  let returningFromCart = referrer?.origin === location.origin && referrer.pathname === cartPath

  function positionMenu() {
    if (location.pathname !== menuPath) {
      // PB usually keeps this document alive while showing checkout.
      positioned = false
      returningFromCart = location.pathname === cartPath
      return
    }
    if (positioned)
      return
    const category = document.querySelector<HTMLElement>('main .category-section h3')?.textContent?.trim()
    if (!category)
      return
    const tab = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find(tab => tab.textContent?.trim() === category && tab.getClientRects().length && tab.getAttribute('aria-disabled') !== 'true')
    if (!tab || !document.querySelector('main [role="button"] h4, main button h4'))
      return
    positioned = true
    // An SPA return can restore checkout's scroll offset before menu cards render.
    // Honor a customer's existing position on initial attachment only.
    if (returningFromCart || window.scrollY === 0)
      tab.click()
  }

  const observer = new MutationObserver(positionMenu)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  positionMenu()
  return {
    positionMenu,
    takeOver() {
      if (location.pathname === menuPath)
        positioned = true
    },
    dispose: () => observer.disconnect(),
  }
}
