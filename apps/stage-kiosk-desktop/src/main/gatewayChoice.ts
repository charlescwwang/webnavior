/* eslint-disable unicorn/prefer-dom-node-text-content -- Payment choices must match the rendered text, excluding hidden payment instructions. */
import type { GatewayChoice } from '@proj-airi/stage-shared/kiosk-desktop'

/**
 * Runs in an isolated world of the approved top-level ECPay cashier only.
 * Returns presentation evidence; never reads input values or confirms a transaction.
 */
export async function selectGatewayChoice(choice: GatewayChoice) {
  if (window !== window.top || location.href !== 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5' || document.hidden)
    return 'unavailable'
  const visible = (el: Element) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && el.getClientRects().length > 0
  const labels = { apple: 'Apple Pay', wallet: '綠界Pay', card: '信用卡' }
  // Match visible standalone text on the three-option selector. Ads, payment
  // submit buttons, inputs and nested provider frames are never click targets.
  const matches = new Map<string, HTMLElement[]>()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const label = walker.currentNode.textContent?.trim()
    if (!label || !Object.values(labels).includes(label))
      continue
    const el = walker.currentNode.parentElement
    if (el instanceof HTMLElement && el.innerText?.trim() === label && visible(el) && !el.closest('button[type=submit],input,[aria-disabled=true],[inert]'))
      matches.set(label, [...matches.get(label) ?? [], el])
  }
  const tabs = matches.get(labels[choice])
  if (!Object.values(labels).every(label => matches.has(label)) || tabs?.length !== 1)
    return 'unavailable'
  const state = window as Window & { gatewayChoiceBusy?: boolean, appleRequested?: boolean }
  if (state.gatewayChoiceBusy)
    return 'unavailable'
  const visibleAppleFrame = () => Array.from(document.querySelectorAll('iframe')).some(frame =>
    visible(frame) && frame.src.startsWith('https://applepay.cdn-apple.com/'))
  if (visibleAppleFrame())
    return choice === 'apple' ? 'apple-opened' : 'return-required'
  state.gatewayChoiceBusy = true
  try {
    tabs[0]!.click()
    for (let attempt = 0; attempt < 20; attempt++) {
      if (document.hidden || !tabs[0]!.isConnected || !visible(tabs[0]!))
        break
      if (choice === 'apple') {
        const buttons = Array.from(document.querySelectorAll<HTMLElement>('a.apple-pay-btn')).filter(visible)
        if (buttons.length === 1) {
          if (!state.appleRequested) {
            state.appleRequested = true
            buttons[0]!.click()
          }
          return 'apple-requested'
        }
      }
      else if (choice === 'card' && Array.from(document.querySelectorAll('input[type=tel]')).filter(visible).length >= 4 && document.body.innerText.includes('信用卡卡號')) {
        state.appleRequested = false
        return 'card-ready'
      }
      else if (choice === 'wallet' && document.body.innerText.includes('掃描付款碼') && Array.from(document.querySelectorAll('canvas,img')).some(visible)) {
        state.appleRequested = false
        return 'wallet-ready'
      }
      await new Promise(resolve => setTimeout(resolve, 75))
    }
    return 'unavailable'
  }
  finally {
    state.gatewayChoiceBusy = false
  }
}
