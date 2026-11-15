import type { ProductConfiguration, ProductSelection } from '@proj-airi/stage-shared/product-configuration'
import type { ServiceAction, ServiceStep } from '@proj-airi/stage-shared/service-operation'

import type { CartLine } from './pbCart'
import type { createOperation } from './pbOperation'

import { resolveSelection } from './pbProduct'

const searchSelector = 'input[placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"]'
const noteSelector = 'input[placeholder="商品有特殊需求，請在此備註"]'

/** Unique visible nodes only: DOM order is never a product/option identity. */
function unique<T extends HTMLElement>(elements: Iterable<T>): T | undefined {
  const visible = [...elements].filter(element => element.isConnected && element.getClientRects().length)
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
  const labels = [...detail.children[0].children]
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
  async function ready(check: () => boolean, accepted = false) {
    const deadline = performance.now() + 5000
    while (!check()) {
      if ((!accepted && signal.aborted) || performance.now() >= deadline)
        throw new Error('PB 控制項尚未完成更新，請確認目前畫面；不會自動重試寫入。')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  async function act(action: ServiceAction, label: string, effect: ServiceStep['effect'], locate: () => HTMLElement | undefined, dispatch: (target: HTMLElement) => void, check: () => boolean, target?: ServiceStep['target']) {
    await operation.run(action, label, effect, locate, async () => dispatch(locate()!), async () => ready(check, effect === 'cart' || effect === 'order'), { target })
  }
  const dialog = () => unique([...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(element => element.querySelector('.menu-dialog') || element.matches('.menu-dialog')))
  const productDialog = (name: string) => {
    const current = dialog()
    return current?.querySelector('h1')?.textContent?.trim() === name ? current : undefined
  }
  async function close() {
    await dismissAnnouncement()
    const current = dialog()
    if (current)
      await act('close-product', '關閉商品視窗', 'draft', () => unique(current.querySelectorAll<HTMLButtonElement>('button.el-dialog__headerbtn')), target => target.click(), () => !current.getClientRects().length || !current.isConnected)
  }
  async function dismissAnnouncement() {
    const locate = () => unique([...document.querySelectorAll<HTMLButtonElement>('button')].filter(button => button.textContent?.trim() === '我知道了，開始點餐'))
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
        const cards = [...document.querySelectorAll<HTMLElement>('main [role="button"] h4, main button h4')].filter(heading => heading.getClientRects().length)
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
    const locate = () => unique([...document.querySelectorAll<HTMLElement>('a, button, div.cursor-pointer')].filter((element) => {
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
    }).filter(element => ![...element.querySelectorAll('a, button, div.cursor-pointer')].some(child => child.textContent?.includes('去結算'))))
    await act('navigate', path === menuPath ? '返回菜單' : '查看購物車', 'navigation', locate, target => target.click(), () => location.pathname === path && (path === menuPath ? Boolean(document.querySelector(searchSelector)) : Boolean(document.querySelector('.order-create'))), { kind: 'route', ref: path })
    await dismissAnnouncement()
  }
  async function open(name: string, productRef?: string) {
    await navigate(menuPath)
    await dismissAnnouncement()
    if (productDialog(name))
      return
    await close()
    const locate = () => unique([...document.querySelectorAll<HTMLElement>('main [role="button"] h4, main button h4')].filter(element => element.textContent?.trim() === name).flatMap(element => element.closest<HTMLElement>('button, [role="button"]') ?? []))
    if (!locate()) {
      await search(name)
      await ready(() => Boolean(locate()))
    }
    await act('open-product', `開啟${name}`, 'draft', locate, target => target.click(), () => Boolean(productDialog(name)), productRef ? { kind: 'product', ref: productRef } : undefined)
    await ready(() => !productDialog(name)?.querySelector('.attr-loading-block'))
  }
  async function number(action: 'quantity' | 'option', label: string, locate: () => HTMLInputElement | undefined, amount: number, target: ServiceStep['target']) {
    const current = locate()
    if (!current || !Number.isInteger(amount) || amount < Number(current.min || 0) || amount > Number(current.max || Number.MAX_SAFE_INTEGER))
      throw new Error(`「${label}」的數值控制項或限制已變更，尚未寫入。`)
    if (Number(current.value) !== amount)
      await act(action, label, 'draft', locate, target => fill(target as HTMLInputElement, String(amount)), () => Number(locate()?.value) === amount, target)
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
    await ready(() => configuration.groups.every(group => [...current.querySelectorAll('.product-item h4')].some(heading => heading.textContent?.trim() === group.name)))
    // PB's public ProductDialog renders one .product-item per named group.
    // Resolve group + choice inside it; identical labels elsewhere cannot win.
    for (const group of configuration.groups) {
      const container = unique([...current.querySelectorAll<HTMLElement>('.product-item')].filter(element => element.querySelector('h4')?.textContent?.trim() === group.name))
      if (!container)
        throw new Error(`無法確認「${group.name}」的實際控制項。`)
      for (const choice of group.choices) {
        const amount = selection.choices.find(selected => selected.ref === choice.ref)?.quantity ?? 0
        if (group.required && group.maximum === 1) {
          if (!amount)
            continue
          const radio = () => unique([...container.querySelectorAll<HTMLElement>('label.el-radio')].filter(label => label.querySelector<HTMLInputElement>('input[type="radio"]')?.value === choice.ref.slice(2) && label.textContent?.includes(choice.name)))
          await act('option', `選擇${group.name}：${choice.name}`, 'draft', radio, target => target.click(), () => radio()?.querySelector<HTMLInputElement>('input')?.checked === true, { kind: 'option', ref: choice.ref })
        }
        else {
          const row = unique([...container.querySelectorAll<HTMLElement>('li')].filter(element => element.querySelector('.flex-col > span')?.childNodes[0]?.textContent?.trim() === choice.name))
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
    const locate = () => unique([...productDialog(name)?.querySelectorAll<HTMLButtonElement>('.dialog-footer button') ?? []].filter(button => button.textContent?.replaceAll(/\s/g, '').startsWith('選好了')))
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
    const needsDetails = lines.filter(candidate => sameVisibleBase(candidate, line)).length > 1
    await close()
    await navigate(cartPath)
    const row = () => {
      const matches = [...document.querySelectorAll<HTMLElement>('.order-create .produce-item')].filter((element) => {
        const name = element.querySelector('h3')?.childNodes[0]?.textContent?.trim()
        const price = element.querySelector('h3 span')?.textContent?.match(/\$([\d,.]+)/)?.[1]
        return price !== undefined && sameVisibleBase({ name: name ?? '', quantity: Number(element.querySelector<HTMLInputElement>('input[type="number"]')?.value), unitPrice: Number(price.replaceAll(',', '')) }, line) && (!needsDetails || renderedDetails(element) === detailsKey(line))
      }).filter(element => element.getClientRects().length)
      if (matches.length === 1)
        return matches[0]
      // DOM order does not identify a vendor row. Within an explicitly admitted
      // group, identical rows are interchangeable; full-cart readback determines
      // the actual affected identity. Never extend this to another configuration.
      const peers = lines.filter(candidate => sameVisibleBase(candidate, line) && detailsKey(candidate) === detailsKey(line))
      return equivalentRefs.length && matches.length === peers.length && peers.every(peer => admitted.includes(peer.ref)) ? matches[0] : undefined
    }
    const locate = () => {
      const current = row()
      if (!current)
        return undefined
      return amount === undefined ? unique(current.querySelectorAll<HTMLButtonElement>('button.is-circle')) : unique(current.querySelectorAll<HTMLInputElement>('input[type="number"]'))
    }
    await operation.run(amount === undefined ? 'remove' : 'quantity', amount === undefined ? `移除${line.name}` : `${line.name}改為 ${amount} 份`, 'cart', locate, async (accept) => {
      const expected = locate()
      await beforeDispatch()
      const target = locate()
      if (target !== expected || !target || target.matches(':disabled, [aria-disabled="true"]'))
        throw new Error('購物車控制項已變更。')
      accept()
      onDispatch()
      if (amount === undefined)
        target.click()
      else
        fill(target as HTMLInputElement, String(amount))
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
    const locate = () => unique([...document.querySelectorAll<HTMLButtonElement>('.order-create button')].filter(button => button.textContent?.trim() === '清空'))
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
  return { act, ready, canEdit, search, open, close, navigate, prepare, add, edit, clearCart, note: setNote }
}
