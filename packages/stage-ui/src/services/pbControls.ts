import type { ProductConfiguration, ProductSelection } from '@proj-airi/stage-shared/product-configuration'
import type { ServiceAction, ServiceStep } from '@proj-airi/stage-shared/service-operation'

import type { CartLine } from './pbCart'
import type { createOperation } from './pbOperation'

import { resolveSelection } from './pbProduct'

const searchSelector = 'input[placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"]'
const noteSelector = 'input[placeholder="商品有特殊需求，請在此備註"]'

/** Unique visible nodes only: DOM order is never a product/option identity. */
function unique<T extends HTMLElement>(elements: Iterable<T> | ArrayLike<T>): T | undefined {
  const visible = Array.from(elements).filter(element => element.isConnected && element.getClientRects().length)
  return visible.length === 1 ? visible[0] : undefined
}

function sameVisibleBase(left: Pick<CartLine, 'name' | 'quantity' | 'unitPrice'>, right: Pick<CartLine, 'name' | 'quantity' | 'unitPrice'>) {
  // The price is rendered in currency, so compare minor units consistently with
  // the cart coordinator rather than using binary float equality.
  return left.name === right.name && left.quantity === right.quantity && Math.round(left.unitPrice * 100) === Math.round(right.unitPrice * 100)
}

function detailsKey(line: CartLine) {
  if (!line.options || line.options.some(option => !Number.isInteger(option.quantity) || option.quantity < 1))
    return undefined
  // PB's observed DetailProductPrice component omits X1 and renders X n only
  // above one. Keep each complete label: substring matching confuses X1/X10 or
  // notes such as 飯少/飯少少. Unknown option observations never imply empty.
  return JSON.stringify({ options: line.options.map(option => `${option.name}${option.quantity > 1 ? `X${option.quantity}` : ''}`.replaceAll(/\s/g, '')).sort(), note: (line.note ?? '').replaceAll(/\s/g, '') })
}

function canEdit(lines: readonly CartLine[], refs: readonly string[]) {
  return refs.every((ref) => {
    const targets = lines.filter(line => line.ref === ref)
    if (targets.length !== 1)
      return false
    const target = targets[0]
    const peers = lines.filter(line => sameVisibleBase(line, target))
    if (peers.length === 1)
      return true
    const key = detailsKey(target)
    return key !== undefined && peers.every(peer => peer.ref === target.ref || (detailsKey(peer) !== undefined && (detailsKey(peer) !== key
      || (refs.includes(peer.ref) && peer.productRef === target.productRef && peer.configuration === target.configuration && peer.note === target.note))))
  })
}

function renderedDetails(element: HTMLElement) {
  // Confirmed from PB Create-DccDhWl4.js and DetailProductPrice-DpUTh351.js on
  // Nov3: product-attr contains one option component and one separate note div.
  // Nested packages/unknown variant markup must stop, not become empty options.
  const attrs = element.querySelector('.product-attr')
  if (!attrs || attrs.children.length !== 2)
    return undefined
  const detail = attrs.children[0]
  const note = attrs.children[1]
  if (detail.children.length !== 1 || !detail.children[0].matches('div.ml-4') || !note.matches('div.ml-4'))
    return undefined
  const labels = Array.from(detail.children[0].children)
  if (labels.some(label => label.tagName !== 'SPAN'))
    return undefined
  return JSON.stringify({ options: labels.map(label => (label.textContent ?? '').replaceAll(/\s/g, '')).filter(Boolean).sort(), note: (note.textContent ?? '').replaceAll(/\s/g, '') })
}

/** Vue's public input/change contract; assigning .value alone leaves its form stale. */
function fill(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  element.blur()
}

/** Dispatch one press/release; Element Plus starts repeat-click on mousedown. */
function pressQuantity(control: HTMLElement) {
  // A click alone never reaches Element Plus's v-repeat-click handler. Release
  // synchronously so its hold timer cannot produce additional quantity writes.
  // https://github.com/element-plus/element-plus/blob/dev/packages/directives/repeat-click/index.ts
  control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }))
  const releaseTarget = control.isConnected ? control : document
  releaseTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
  // Plain native buttons and the PB lab stepper use click rather than repeat-click.
  if (control.isConnected)
    control.click()
}

/** Resolve one native step within this input's own control, never a nearby add/delete button. */
function quantityStep(locate: () => HTMLInputElement | undefined, amount: number) {
  const input = locate()
  if (!input || !Number.isInteger(amount) || amount < Number(input.min || 0) || amount > Number(input.max || Number.MAX_SAFE_INTEGER) || input.disabled)
    throw new Error('數量控制項或限制已變更，尚未寫入。')
  const current = Number(input.value)
  if (!Number.isInteger(current))
    throw new Error('目前數量無法確認，尚未寫入。')
  const wrapper = input.closest('.el-input-number, .stepper, .line-actions')
  const direction = amount > current ? 'increase' : 'decrease'
  const selector = direction === 'increase'
    ? '.el-input-number__increase, [role="button"][aria-label^="增加"], button[aria-label^="增加"]'
    : '.el-input-number__decrease, [role="button"][aria-label^="減少"], button[aria-label^="減少"]'
  // A plain numeric input is itself a supported native control. When a stepper
  // exists, missing/disabled buttons must fail rather than bypassing its rules.
  if (!wrapper)
    return { locate, next: amount, click: false }
  const step = Number(input.step || 1)
  if (!Number.isInteger(step) || step < 1 || Math.abs(amount - current) % step)
    throw new Error('要求的數量不符合網站增減單位，尚未寫入。')
  const button = () => {
    const currentInput = locate()
    const currentWrapper = currentInput?.closest('.el-input-number, .stepper, .line-actions')
    return currentWrapper ? unique(currentWrapper.querySelectorAll<HTMLElement>(selector)) : undefined
  }
  if (!button())
    throw new Error('目前無法確認數量增減按鈕，尚未寫入。')
  return { locate: button, next: current + (direction === 'increase' ? step : -step), click: true }
}

/**
 * One operation's finite PB controls. Only menu/cart navigation is permitted;
 * order submission, account fields and generic selectors never enter this API.
 * UI writes have a single dispatch owner and must settle their readback even
 * after takeover. Full-document navigation destroys this executor; the Host
 * revokes its binding instead of replaying a possibly accepted write.
 */
export function createControls(operation: ReturnType<typeof createOperation>, signal: AbortSignal) {
  // The service approves origin/store/flow before constructing controls. Tests
  // use loopback documents with the same finite journey paths.
  const match = location.pathname.match(/^(\/order\/store\/[^/]+\/(?:pick_up|internal_use)\/)(?:menu(?:\/select-table)?|orders\/create)$/)
  if (!match)
    throw new Error('PB control journey is unavailable.')
  const menuPath = `${match[1]}menu`
  const cartPath = `${match[1]}orders/create`
  async function ready(check: () => boolean, accepted = false, timeoutMs = 5000) {
    const deadline = performance.now() + timeoutMs
    while (!check()) {
      if ((!accepted && signal.aborted) || performance.now() >= deadline)
        throw new Error('PB 控制項尚未完成更新，請確認目前畫面；不會自動重試寫入。')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  async function act(action: ServiceAction, label: string, effect: ServiceStep['effect'], locate: () => HTMLElement | undefined, dispatch: (target: HTMLElement) => void, check: () => boolean, target?: ServiceStep['target']) {
    // Merchant submission can include official invoice validation and network
    // processing. Await that one accepted click longer; never click it again.
    await operation.run(action, label, effect, locate, async () => dispatch(locate()!), async () => ready(check, effect === 'cart' || effect === 'order', effect === 'order' ? 30_000 : 5000), { target })
  }
  const dialog = () => unique(Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(element => element.querySelector('.menu-dialog') || element.matches('.menu-dialog')))
  const productDialog = (name: string) => {
    const current = dialog()
    return current?.querySelector('h1')?.textContent?.trim() === name ? current : undefined
  }
  async function close() {
    await dismissAnnouncement()
    const current = dialog()
    if (!current)
      return
    try {
      await act('close-product', '關閉商品視窗', 'draft', () => unique(current.querySelectorAll<HTMLButtonElement>('button.el-dialog__headerbtn')), target => target.click(), () => !current.getClientRects().length || !current.isConnected)
    }
    catch (error) {
      // PB's successful add starts a leave transition before the next cart
      // operation. Natural disappearance already satisfies close; do not retry
      // a vanished button. Customer takeover or any still-open dialog still fails.
      const stillOpen = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).some(element => (element.querySelector('.menu-dialog') || element.matches('.menu-dialog')) && element.getClientRects().length)
      if (signal.aborted || stillOpen)
        throw error
    }
  }
  async function dismissAnnouncement() {
    // Production PB can stack its coupon dialog above the store announcement.
    // Use only the observed promotion's defer action; never claim a coupon,
    // change its persistent preference or force-click through another dialog.
    const couponLater = () => {
      const coupon = unique(Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(element => element.textContent?.includes('不再顯示此優惠') && Array.from(element.querySelectorAll('button')).some(button => button.textContent?.trim() === '立即領取')))
      return coupon && unique(Array.from(coupon.querySelectorAll<HTMLButtonElement>('button')).filter(button => button.textContent?.trim() === '稍後再領'))
    }
    if (couponLater())
      await act('notice', '暫時關閉領券提示', 'draft', couponLater, target => target.click(), () => !couponLater())
    const locate = () => unique(Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter((button) => {
      const label = button.textContent?.trim()
      if (label === '我知道了，開始點餐')
        return true
      // PB's November announcement shortened its acknowledgement. Scope that
      // generic label to the observed business dialog, never payment/consent UI.
      const announcement = button.closest('.business-dialog')
      return label === '我知道了' && announcement?.querySelector('.el-dialog__title,h2')?.textContent?.includes('線上點餐公告')
    }))
    if (locate())
      await act('notice', '關閉營業公告', 'draft', locate, target => target.click(), () => !locate())
  }
  async function search(query: string, rendered: () => boolean = () => true) {
    await navigate(menuPath)
    await dismissAnnouncement()
    await close()
    let searchStarted = false
    const loading = new MutationObserver(() => {
      if (document.querySelector('.menu-search-meta')?.textContent?.includes('搜尋中'))
        searchStarted = true
    })
    // The merchant updates cards asynchronously. Callers presenting catalog
    // facts must verify those actual cards, not just our synchronous input value.
    try {
      await act('search', '搜尋餐點', 'draft', () => unique(document.querySelectorAll<HTMLInputElement>(searchSelector)), (target) => {
        loading.observe(document.body, { childList: true, subtree: true, characterData: true })
        fill(target as HTMLInputElement, query)
      }, () => {
        if (unique(document.querySelectorAll<HTMLInputElement>(searchSelector))?.value !== query || !rendered())
          return false
        if (!query.trim())
          return true
        // NOTICE: PB Show-D_rzU06X.js (observed 2026-11-11) debounces Ge by
        // 250 ms, then sets me while loading ALL categories. Observe that native
        // loading cycle rather than sleeping: a cached search can finish between
        // polls, while the old result count remains visible before Ge starts.
        // Source: https://app.esgpb.com/order/build/assets/Show-D_rzU06X.js
        if (!searchStarted)
          return false
        const count = unique(document.querySelectorAll<HTMLElement>('.menu-search-meta'))?.textContent?.trim().match(/^共找到\s*(\d+)\s*項$/)
        const cards = Array.from(document.querySelectorAll<HTMLElement>('main [role="button"] h4, main button h4')).filter(heading => heading.getClientRects().length)
        return !!count && Number(count[1]) === cards.length
      }, { kind: 'field', ref: 'menu-search' })
    }
    finally {
      loading.disconnect()
    }
  }
  async function navigate(path: string) {
    if (path !== menuPath && path !== cartPath)
      throw new Error('PB control navigation is outside the approved journey.')
    await dismissAnnouncement()
    if (location.pathname === path)
      return
    // Product dialogs cover the cart link, including after a failed draft edit.
    // Resolve them before locating the route control. A same-route lookup must
    // preserve the open product draft for prepare() to continue configuring it.
    await close()
    const locate = () => unique(Array.from(document.querySelectorAll<HTMLElement>('a, button, div.cursor-pointer')).filter((element) => {
      if (path === menuPath) {
        const cart = element.closest('.order-create')
        if (!cart)
          return false
        if (element instanceof HTMLAnchorElement)
          return new URL(element.href).origin === location.origin && new URL(element.href).pathname === menuPath && ['繼續點餐', '加點'].includes(element.textContent?.trim() ?? '')
        // Removing the last line replaces the continue link with PB's empty
        // cart button. Use that actual control, never the unrelated account links.
        return element instanceof HTMLButtonElement && element.textContent?.trim() === '立即點餐' && !cart.querySelector('.produce-item') && cart.textContent?.includes('購物車是空的') === true
      }
      return element.textContent?.replaceAll(/\s/g, '').match(/^(?:\$[\d,.]+)?去結算$/) !== null && element.textContent?.includes('去結算') === true
    }).filter(element => !Array.from(element.querySelectorAll('a, button, div.cursor-pointer')).some(child => child.textContent?.includes('去結算'))))
    // A fresh HTTP cart snapshot can precede PB's asynchronous menu controls.
    // Wait for one real route target; the operation rechecks it before dispatch.
    await ready(() => Boolean(locate()))
    await act('navigate', path === menuPath ? '返回菜單' : '查看購物車', 'navigation', locate, target => target.click(), () => location.pathname === path && (path === menuPath ? Boolean(document.querySelector(searchSelector)) : Boolean(document.querySelector('.order-create'))), { kind: 'route', ref: path })
    await dismissAnnouncement()
  }
  async function open(name: string, productRef?: string) {
    await navigate(menuPath)
    await dismissAnnouncement()
    if (productDialog(name))
      return
    await close()
    const locate = () => unique(Array.from(document.querySelectorAll<HTMLElement>('main [role="button"] h4, main button h4')).filter(element => element.textContent?.trim() === name).flatMap(element => element.closest<HTMLElement>('button, [role="button"]') ?? []))
    if (!locate()) {
      await search(name)
      await ready(() => Boolean(locate()))
    }
    await act('open-product', `開啟${name}`, 'draft', locate, target => target.click(), () => Boolean(productDialog(name)), productRef ? { kind: 'product', ref: productRef } : undefined)
    await ready(() => !productDialog(name)?.querySelector('.attr-loading-block'))
  }
  async function number(action: 'quantity' | 'option', label: string, locate: () => HTMLInputElement | undefined, amount: number, target: ServiceStep['target']) {
    // Each gesture owns one actual click and waits for that native value before
    // resolving a fresh control. Vue may replace it while processing the click.
    do {
      await ready(() => {
        const input = locate()
        return Boolean(input && !input.disabled)
      })
      const step = quantityStep(locate, amount)
      if (Number(locate()?.value) === amount)
        return
      await act(action, label, 'draft', step.locate, (control) => {
        if (control.matches(':disabled, [aria-disabled="true"], .is-disabled'))
          throw new Error('數量增減按鈕尚不可操作。')
        if (step.click)
          pressQuantity(control)
        else
          fill(control as HTMLInputElement, String(step.next))
      }, () => Number(locate()?.value) === step.next, target)
    } while (Number(locate()?.value) !== amount)
  }
  async function setNote(note: string) {
    const field = () => {
      const current = dialog()
      return current ? unique(current.querySelectorAll<HTMLInputElement>(noteSelector)) : undefined
    }
    if (!field())
      throw new Error('商品備註控制項已變更。')
    if (field()!.value !== note)
      await act('note', '輸入商品備註', 'draft', field, target => fill(target as HTMLInputElement, note), () => field()?.value === note, { kind: 'field', ref: 'product-note' })
  }
  async function prepare(name: string, productRef: string, configuration: ProductConfiguration, selection: ProductSelection, amount: number, note: string) {
    await open(name, productRef)
    const current = productDialog(name)!
    await ready(() => configuration.groups.every(group => Array.from(current.querySelectorAll('.product-item h4')).some(heading => heading.textContent?.trim() === group.name)))
    // PB's public ProductDialog renders one .product-item per named group.
    // Resolve group + choice inside it; identical labels elsewhere cannot win.
    for (const group of configuration.groups) {
      const container = unique(Array.from(current.querySelectorAll<HTMLElement>('.product-item')).filter(element => element.querySelector('h4')?.textContent?.trim() === group.name))
      if (!container)
        throw new Error(`無法確認「${group.name}」的實際控制項。`)
      for (const choice of group.choices) {
        const amount = selection.choices.find(selected => selected.ref === choice.ref)?.quantity ?? 0
        if (group.required && group.maximum === 1) {
          if (!amount)
            continue
          const radio = () => unique(Array.from(container.querySelectorAll<HTMLElement>('label.el-radio')).filter(label => label.querySelector<HTMLInputElement>('input[type="radio"]')?.value === choice.ref.slice(2) && label.textContent?.includes(choice.name)))
          await act('option', `選擇${group.name}：${choice.name}`, 'draft', radio, target => target.click(), () => radio()?.querySelector<HTMLInputElement>('input')?.checked === true, { kind: 'option', ref: choice.ref })
        }
        else {
          const row = unique(Array.from(container.querySelectorAll<HTMLElement>('li')).filter(element => element.querySelector('.flex-col > span')?.childNodes[0]?.textContent?.trim() === choice.name))
          await number('option', `${group.name}：${choice.name} ${amount} 個`, () => row ? unique(row.querySelectorAll<HTMLInputElement>('input[type="number"]')) : undefined, amount, { kind: 'option', ref: choice.ref })
        }
      }
    }
    await number('quantity', `餐點 ${amount} 份`, () => unique(current.querySelectorAll<HTMLInputElement>('.dialog-footer input[type="number"]')), amount, { kind: 'product', ref: productRef })
    await setNote(note)
    const selected = resolveSelection(configuration, selection, note)
    const expected = Math.round(selected.unitPrice * 100) * amount
    await ready(() => {
      const button = unique(current.querySelectorAll<HTMLButtonElement>('.dialog-footer button'))
      const total = button?.textContent?.replaceAll(/\s/g, '').match(/共計\$([\d,.]+)/)
      return Boolean(total && Math.round(Number(total[1].replaceAll(',', '')) * 100) === expected)
    })
  }
  async function add(name: string, productRef: string, beforeDispatch: () => Promise<void>, verify: () => Promise<boolean>, onDispatch: () => void = () => {}) {
    const locate = () => unique(Array.from(productDialog(name)?.querySelectorAll<HTMLButtonElement>('.dialog-footer button') ?? []).filter(button => button.textContent?.replaceAll(/\s/g, '').startsWith('選好了')))
    await operation.run('add', `加入${name}`, 'cart', locate, async (accept) => {
      const expected = locate()
      await beforeDispatch()
      const target = locate()
      if (target !== expected || !target || target.matches(':disabled, [aria-disabled="true"]'))
        throw new Error('目前無法加入餐點，請確認營業與取餐時段。')
      accept()
      onDispatch()
      target.click()
    }, async () => {
      // The cart coordinator verifies the full effect as well. Waiting here
      // keeps the same pointer on the accepted action until PB settles it.
      const deadline = performance.now() + 8000
      while (!await verify()) {
        if (performance.now() >= deadline)
          throw new Error('PB 加車結果尚未確認。')
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }, { deferredDispatch: true, target: { kind: 'product', ref: productRef } })
  }
  async function edit(lines: readonly CartLine[], ref: string, amount: number | undefined, beforeDispatch: () => Promise<void>, verify: () => Promise<boolean>, onDispatch: () => void = () => {}, equivalentRefs: readonly string[] = []) {
    const line = lines.find(line => line.ref === ref)
    const admitted = equivalentRefs.length ? equivalentRefs : [ref]
    if (!line || !canEdit(lines, admitted))
      throw new Error('購物車行無法由完整配置唯一對應，尚未操作。')
    const needsDetails = lines.filter(candidate => candidate.name === line.name && Math.round(candidate.unitPrice * 100) === Math.round(line.unitPrice * 100)).length > 1
    let expectedQuantity = line.quantity
    let ownedRow: HTMLElement | undefined
    await close()
    await navigate(cartPath)
    const row = () => {
      const matches = Array.from(document.querySelectorAll<HTMLElement>('.order-create .produce-item')).filter((element) => {
        const name = element.querySelector('h3')?.childNodes[0]?.textContent?.trim()
        const price = element.querySelector('h3 span')?.textContent?.match(/\$([\d,.]+)/)?.[1]
        return price !== undefined && sameVisibleBase({ name: name ?? '', quantity: Number(element.querySelector<HTMLInputElement>('input[type="number"]')?.value), unitPrice: Number(price.replaceAll(',', '')) }, { ...line, quantity: expectedQuantity }) && (!needsDetails || renderedDetails(element) === detailsKey(line))
      }).filter(element => element.getClientRects().length)
      // During a sequence, the same live node retains its ownership even if
      // its intermediate count equals a peer's. A replaced ambiguous node stops.
      if (ownedRow?.isConnected)
        return matches.includes(ownedRow) ? ownedRow : undefined
      if (ownedRow && needsDetails) {
        // A detached row cannot transfer its identity to a same-configuration
        // peer while Vue is rebuilding. Only an admitted equivalent group may
        // choose a replacement; waiting is safer than incrementing another row.
        const replacements = lines.filter(candidate => candidate.name === line.name && Math.round(candidate.unitPrice * 100) === Math.round(line.unitPrice * 100) && detailsKey(candidate) === detailsKey(line))
        if (replacements.some(candidate => !admitted.includes(candidate.ref)))
          return undefined
      }
      if (matches.length === 1) {
        ownedRow = matches[0]
        return ownedRow
      }
      // DOM order does not identify a vendor row. Within an explicitly admitted
      // group, identical rows are interchangeable; full-cart readback determines
      // the actual affected identity. Never extend this to another configuration.
      const peers = lines.filter(candidate => sameVisibleBase(candidate, line) && detailsKey(candidate) === detailsKey(line))
      if (equivalentRefs.length && matches.length === peers.length && peers.every(peer => admitted.includes(peer.ref))) {
        ownedRow = matches[0]
        return ownedRow
      }
      return undefined
    }
    const locate = () => {
      const current = row()
      if (!current)
        return undefined
      // PB Create-CjexdErb.js (Nov15) has both edit/delete circular buttons.
      // Its quantity control explicitly supports min=0 and removes the row;
      // use that native contract rather than guessing an icon or DOM position.
      return unique(current.querySelectorAll<HTMLInputElement>('input[type="number"]'))
    }
    if (amount !== undefined) {
      let accepted = false
      do {
        // PB temporarily disables the entire input while its HTTP write settles.
        // That is a wait condition, not permission to fall back to direct input.
        await ready(() => {
          const input = locate()
          return Boolean(input && !input.disabled)
        }, accepted)
        const step = quantityStep(locate, amount)
        if (expectedQuantity === amount) {
          if (!await verify())
            throw new Error('PB 購物車更新尚未確認。')
          return
        }
        await operation.run('quantity', `${line.name}改為 ${amount} 份`, 'cart', step.locate, async (accept) => {
          const expected = step.locate()
          if (!accepted)
            await beforeDispatch()
          const control = step.locate()
          if (!control || control !== expected || control.matches(':disabled, [aria-disabled="true"], .is-disabled'))
            throw new Error('購物車控制項已變更。')
          accept()
          if (!accepted) {
            accepted = true
            onDispatch()
          }
          expectedQuantity = step.next
          if (step.click)
            pressQuantity(control)
          else
            fill(control as HTMLInputElement, String(step.next))
        }, async () => {
          // Accepted writes still settle after takeover; the next click remains
          // cancellable. Never replay an unacknowledged increment or decrement.
          await ready(() => Number(locate()?.value) === expectedQuantity || (expectedQuantity === 0 && !row()), true)
          if (expectedQuantity === amount) {
            const deadline = performance.now() + 8000
            while (!await verify()) {
              if (performance.now() >= deadline)
                throw new Error('PB 購物車更新尚未確認。')
              await new Promise(resolve => setTimeout(resolve, 50))
            }
          }
        }, { deferredDispatch: true, target: { kind: 'cart_line', ref: line.ref } })
      } while (expectedQuantity !== amount)
      return
    }
    await operation.run('remove', `移除${line.name}`, 'cart', locate, async (accept) => {
      const expected = locate()
      await beforeDispatch()
      const target = locate()
      if (target !== expected || !target || target.matches(':disabled, [aria-disabled="true"]'))
        throw new Error('購物車控制項已變更。')
      accept()
      onDispatch()
      fill(target as HTMLInputElement, '0')
    }, async () => {
      const deadline = performance.now() + 8000
      while (!await verify()) {
        if (performance.now() >= deadline)
          throw new Error('PB 購物車更新尚未確認。')
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }, { deferredDispatch: true, target: { kind: 'cart_line', ref: line.ref } })
  }
  async function clearCart(beforeDispatch: () => Promise<void>, verify: () => Promise<boolean>, onDispatch: () => void) {
    await close()
    await navigate(cartPath)
    // PB Create-CX03t3FJ.js (2026-11-11) binds this exact cart-header button
    // to X('all'), DELETE details/all. Account/coupon clear controls cannot win.
    const locate = () => unique(Array.from(document.querySelectorAll<HTMLButtonElement>('.order-create button')).filter(button => button.textContent?.trim() === '清空'))
    // The cart page container appears before its row/header controls finish rendering.
    await ready(() => Boolean(locate()))
    await operation.run('remove', '清空未結帳餐點', 'cart', locate, async (accept) => {
      const expected = locate()
      await beforeDispatch()
      const target = locate()
      if (!target || target !== expected || target.matches(':disabled, [aria-disabled="true"]'))
        throw new Error('清空按鈕已變更或尚不可操作，尚未清空。')
      accept()
      onDispatch()
      target.click()
    }, async () => {
      const deadline = performance.now() + 8000
      while (!await verify() || document.querySelectorAll('.order-create .produce-item').length) {
        if (performance.now() >= deadline)
          throw new Error('PB 清空結果尚未確認。')
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }, { deferredDispatch: true, target: { kind: 'field', ref: 'cart-clear' } })
  }
  return { act, ready, canEdit, search, open, close, dismissAnnouncement, navigate, prepare, add, edit, clearCart, note: setNote }
}
