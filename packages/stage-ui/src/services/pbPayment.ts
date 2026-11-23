import type { PbJourney } from '@proj-airi/stage-shared/pb-journey'

import { orderingMessages } from '../../../i18n/src/orderingMessages'

/** Restricts native PB payment links in this kiosk; retains native LINE Pay and credit choices; never initiates payment. */
export function installPaymentPolicy(journey: PbJourney) {
  const disabled = new Map<HTMLAnchorElement, { href: string, tabindex: string | null, title: string | null, aria: string | null, disabledClass: boolean }>()
  const notice = document.createElement('p')
  notice.dataset.webnaviorPaymentPolicy = ''
  notice.setAttribute('role', 'note')
  notice.textContent = orderingMessages['zh-Hant'].checkout.paymentRestriction
  notice.style.cssText = 'margin-top:16px;font-size:18px;line-height:1.5;'
  // Order hash and journey isolate policy to this one merchant payment screen.
  // Editor, result, cancellation and provider pages retain their native controls.
  function orderReference() {
    if (location.origin !== journey.origin || !location.pathname.startsWith(journey.basePath))
      return
    return location.pathname.slice(journey.basePath.length).match(/^orders\/([\w-]{1,200})\/choosePayment$/)?.[1]
  }
  function allowed(link: HTMLAnchorElement, reference: string) {
    try {
      const target = new URL(disabled.get(link)?.href ?? link.getAttribute('href') ?? '', journey.origin)
      return target.origin === journey.origin && !target.username && !target.password && !target.search && !target.hash
        && [
          `/order/linepay/redirect/${reference}/LinePay`,
          `/order/ecpay/redirect/${reference}/Credit`,
        ].includes(target.pathname)
    }
    catch { return false }
  }
  function restore() {
    notice.remove()
    for (const [link, original] of disabled) {
      link.setAttribute('href', original.href)
      for (const [name, value] of [['tabindex', original.tabindex], ['title', original.title], ['aria-disabled', original.aria]] as const) {
        if (value === null)
          link.removeAttribute(name)
        else
          link.setAttribute(name, value)
      }
      if (!original.disabledClass)
        link.classList.remove('is-disabled')
      delete link.dataset.webnaviorPaymentDisabled
    }
    disabled.clear()
  }
  function sync() {
    const reference = orderReference()
    if (!reference) {
      restore()
      return
    }
    const region = document.querySelector('.order-pay .pay-method')
    if (!region)
      return
    if (notice.parentElement !== region)
      region.append(notice)
    for (const link of Array.from(region.querySelectorAll<HTMLAnchorElement>('a'))) {
      if (allowed(link, reference))
        continue
      if (!disabled.has(link))
        disabled.set(link, { href: link.getAttribute('href') ?? '', tabindex: link.getAttribute('tabindex'), title: link.getAttribute('title'), aria: link.getAttribute('aria-disabled'), disabledClass: link.classList.contains('is-disabled') })
      // Removing href also prevents opening a disabled provider in another tab.
      link.classList.add('is-disabled')
      link.removeAttribute('href')
      link.setAttribute('aria-disabled', 'true')
      link.setAttribute('tabindex', '-1')
      link.setAttribute('title', notice.textContent!)
      link.dataset.webnaviorPaymentDisabled = ''
    }
    for (const link of disabled.keys()) {
      if (!link.isConnected)
        disabled.delete(link)
    }
  }
  function block(event: Event) {
    const reference = orderReference()
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('.order-pay .pay-method a') : null
    if (!reference || !link || allowed(link, reference))
      return
    if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key))
      return
    event.preventDefault()
    event.stopImmediatePropagation()
    sync()
  }
  const observer = new MutationObserver(sync)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  // Capture also covers the interval between Vue inserting a link and sync.
  for (const event of ['click', 'auxclick', 'keydown'])
    document.addEventListener(event, block, true)
  sync()
  return {
    dispose() {
      observer.disconnect()
      for (const event of ['click', 'auxclick', 'keydown'])
        document.removeEventListener(event, block, true)
      restore()
    },
  }
}
