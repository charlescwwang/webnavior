import type { PbCheckout, PbInvoiceMethod } from '@proj-airi/stage-shared/pb-checkout'

import type { CartSnapshot } from './pbCart'
import type { createControls } from './pbControls'

import { invoiceCode } from '@proj-airi/stage-shared/invoice-input'
import { readPbSubmissionResult } from '@proj-airi/stage-shared/pb-checkout'

const methods = [
  { method: 'none' as const, value: '5', label: '無載具' },
  { method: 'carrier' as const, value: '3', label: '手機載具', placeholder: '請輸入共8碼編號' },
  { method: 'citizen' as const, value: '2', label: '自然人憑證', placeholder: '2碼英文字碼+14碼數字' },
  { method: 'tax' as const, value: '4', label: '統一編號', placeholder: '請輸入統一編號' },
  { method: 'donation' as const, value: '6', label: '捐贈發票', placeholder: '請輸入3~7碼數字' },
]

/** Resolves a unique visible contact field by its merchant label, independently of input type. */
export function notificationField(kind: 'phone' | 'email') {
  const label = kind === 'phone' ? '手機號碼' : 'E-mail'
  // PB has rendered phone as both email and tel. Labels prevent overwriting email.
  const fields = Array.from(document.querySelectorAll<HTMLElement>('.order-create .el-form-item, .order-create .field'))
    .filter(item => Array.from(item.querySelectorAll('label')).some(node => node.textContent?.trim() === label))
    .flatMap(item => Array.from(item.querySelectorAll<HTMLInputElement>('input')))
    .filter(input => input.isConnected && input.getClientRects().length)
  return fields.length === 1 ? fields[0] : undefined
}

/** One document's checkout draft and one-use submission ticket; no payment controls are exposed. */
export function createCheckout(readCart: () => Promise<CartSnapshot>, revision: () => number, onDispatch: () => void, onAccepted: () => void, canSubmit: boolean) {
  let confirmation: { token: string, fingerprint: string, expiresAt: number } | undefined
  let dispatched = false
  function unique<T extends HTMLElement>(elements: Iterable<T> | ArrayLike<T>) {
    const visible = Array.from(elements).filter(element => element.isConnected && element.getClientRects().length)
    return visible.length === 1 ? visible[0] : undefined
  }
  function read(): PbCheckout | undefined {
    if (!location.pathname.endsWith('/orders/create') || !document.querySelector('.order-create'))
      return
    const available = methods.flatMap((method) => {
      const radio = unique(document.querySelectorAll<HTMLInputElement>(`.order-create input[type="radio"][value="${method.value}"]`))
      return radio ? [{ ...method, radio }] : []
    })
    if (!available.length)
      return
    const selected = available.filter(method => method.radio.checked)
    const fields: PbCheckout['fields'] = []
    const missing: string[] = []
    if (selected.length !== 1)
      missing.push('請選擇發票方式。')
    const method = selected[0]
    if (method && method.method !== 'none') {
      const input = unique(document.querySelectorAll<HTMLInputElement>(`.order-create input[placeholder="${method.placeholder}"]`))
      const value = input?.value.trim() ?? ''
      let valid = false
      if (method.method === 'carrier' || method.method === 'citizen')
        valid = !!invoiceCode(method.method, value)
      else
        valid = method.method === 'tax' ? /^\d{8}$/.test(value) : /^\d{3,7}$/.test(value)
      fields.push({ kind: method.method, label: method.label, value, valid })
      if (!valid)
        missing.push(`請在畫面${method.method === 'carrier' || method.method === 'citizen' ? '掃描或輸入' : '填寫'}${method.label}。`)
    }
    const phone = notificationField('phone')
    const email = notificationField('email')
    if (phone)
      fields.push({ kind: 'phone', label: '通知手機', value: phone.value.trim(), valid: /^\d{10,15}$/.test(phone.value.trim()) })
    if (email)
      fields.push({ kind: 'email', label: '通知電子信箱', value: email.value.trim(), valid: /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(email.value.trim()) })
    const contacts = fields.filter(item => item.kind === 'phone' || item.kind === 'email')
    // The guest PB form and the frozen fixture require one notification channel.
    // Do not invent an optional path when the page exposes this required group.
    if (contacts.length && !contacts.some(item => item.value && item.valid))
      missing.push('請填寫通知手機或電子信箱；電子信箱請在畫面輸入。')
    for (const contact of contacts) {
      if (contact.value && !contact.valid)
        missing.push(`請修正${contact.label}格式。`)
    }
    // The order-note accordion may be collapsed after entry. Its connected
    // field still holds submitted data and must remain in the final summary.
    const notes = Array.from(document.querySelectorAll<HTMLTextAreaElement>('.order-create textarea')).filter(field => field.isConnected)
    const note = notes.length === 1 ? notes[0].value : ''
    if (notes.length > 1)
      missing.push('請先在畫面確認訂單備註。')
    const totals = Array.from(document.querySelectorAll<HTMLElement>('p, span')).flatMap((element) => {
      const text = element.textContent?.trim() ?? ''
      const match = text.match(/^總金額\s*\$([\d,]+(?:\.\d+)?)$/)
      return element.getClientRects().length && match ? [Number(match[1].replaceAll(',', ''))] : []
    })
    const total = totals.length === 1 ? totals[0] : undefined
    if (total === undefined)
      missing.push('請先確認畫面上的訂單總金額。')
    return { methods: available.map(item => ({ method: item.method, label: item.label, selected: item.radio.checked })), fields, missing, ready: missing.length === 0, orderNote: note, total }
  }
  async function binding() {
    const form = read()
    if (!form)
      throw new Error('請先開啟購物車的發票與結帳畫面。')
    const cart = await readCart()
    return { form, cart, fingerprint: JSON.stringify({ path: location.pathname, revision: revision(), cart, form }) }
  }
  return {
    read,
    reset() { confirmation = undefined },
    async reveal(controls: ReturnType<typeof createControls>) {
      if (read())
        return
      const locate = () => unique(Array.from(document.querySelectorAll<HTMLElement>('.order-create summary, .order-create .el-collapse-item__header')).filter(element => element.textContent?.trim().startsWith('開立發票')))
      await controls.act('option', '開啟發票選擇', 'draft', locate, target => target.click(), () => read() !== undefined)
    },
    /** Scrolls/focuses the current entry step without filling or submitting it. */
    async focus(step: 'invoice' | 'next', controls: ReturnType<typeof createControls>) {
      const locate = () => {
        const state = read()
        const selected = state?.methods.find(method => method.selected)
        if (!state || !selected)
          return
        if (step === 'invoice')
          return unique(document.querySelectorAll<HTMLInputElement>('.order-create input[type="radio"]:checked'))
        const invoice = state.fields.find(field => field.kind === selected.method)
        if (selected.method !== 'none' && !invoice?.valid) {
          const definition = methods.find(method => method.method === selected.method)!
          return unique(document.querySelectorAll<HTMLInputElement>(`.order-create input[placeholder="${definition.placeholder}"]`))
        }
        const invalidContact = state.fields.find(field => ['phone', 'email'].includes(field.kind) && field.value && !field.valid)
        return notificationField(invalidContact?.kind === 'email' ? 'email' : 'phone')
      }
      if (!locate())
        return
      await controls.act('option', step === 'invoice' ? '前往發票方式' : '前往目前資料欄位', 'draft', locate, target => target.focus({ preventScroll: true }), () => document.activeElement === locate())
    },
    async choose(method: PbInvoiceMethod, controls: ReturnType<typeof createControls>) {
      confirmation = undefined
      const definition = methods.find(item => item.method === method)!
      const locate = () => unique(document.querySelectorAll<HTMLInputElement>(`.order-create input[type="radio"][value="${definition.value}"]`))?.closest<HTMLElement>('label') ?? undefined
      await controls.act('option', `選擇${definition.label}`, 'draft', locate, target => target.click(), () => read()?.methods.some(item => item.method === method && item.selected) === true)
      return read()!
    },
    async phone(value: string, controls: ReturnType<typeof createControls>) {
      if (!/^\d{10,15}$/.test(value))
        throw new Error('請提供完整通知手機號碼。')
      confirmation = undefined
      await controls.act('note', '填寫通知手機', 'draft', () => notificationField('phone'), (target) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, value)
        target.dispatchEvent(new Event('input', { bubbles: true }))
        target.dispatchEvent(new Event('change', { bubbles: true }))
      }, () => notificationField('phone')?.value === value)
      return read()!
    },
    async prepare() {
      const fresh = await binding()
      if (!canSubmit)
        return { ...fresh.form, ready: false, missing: [...fresh.form.missing, '核對完成後，請在畫面點「送出訂單」。'] }
      if (!fresh.form.ready || !fresh.cart.lines.length)
        return { ...fresh.form, ready: false }
      if (dispatched)
        throw new Error('訂單已進入送出處理，請查看目前畫面，不重複送出。')
      confirmation = { token: crypto.randomUUID(), fingerprint: fresh.fingerprint, expiresAt: Date.now() + 120_000 }
      return { ...fresh.form, confirmationToken: confirmation.token }
    },
    /** Consumes the ticket before the native click. A missing result is never retried. */
    async submit(token: string, controls: ReturnType<typeof createControls>) {
      const ticket = confirmation
      confirmation = undefined
      if (!canSubmit || dispatched || !ticket || ticket.token !== token || ticket.expiresAt <= Date.now())
        throw new Error('請先核對目前訂單內容，再確認送出。')
      const fresh = await binding()
      if (!fresh.form.ready || fresh.fingerprint !== ticket.fingerprint)
        throw new Error('訂單內容已變更，請重新核對後再確認送出。')
      const locate = () => unique(Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(button => button.textContent?.trim() === '送出訂單'))
      const path = location.pathname
      // PB Create-CjexdErb.js opens this confirmation before its orders.store
      // POST. Opening it is a draft action; the dispatch barrier starts only
      // at the final native confirmation, never at the first button.
      const dialog = () => unique(Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-label="確認訂單"]'))
        .filter(element => element.querySelector('.el-message-box__message')?.textContent?.trim() === '訂單送出後將無法修改，請確認所有資訊是否正確。'))
      await controls.act('option', '開啟訂單確認', 'draft', locate, target => target.click(), () => Boolean(dialog()))
      const confirmed = await binding()
      if (!confirmed.form.ready || confirmed.fingerprint !== ticket.fingerprint)
        throw new Error('訂單內容已變更，請重新核對後再確認送出。')
      const confirm = () => unique(Array.from((dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])).filter(button => button.textContent?.trim() === '確定'))
      await controls.act('submit', '送出訂單', 'order', confirm, (target) => {
        dispatched = true
        onDispatch()
        target.click()
      }, () => location.pathname !== path)
      // The fixed checkout expectation predates the click. Navigation alone
      // proves no acceptance, and pickup number is not the merchant identity.
      const parent = path.match(/^\/order\/store\/([^/]+)\/([^/]+)\/orders\/create$/)!
      const roots = document.querySelectorAll('[data-page]')
      let raw: unknown
      if (roots.length === 1) {
        try {
          raw = JSON.parse(roots[0].getAttribute('data-page')!)
        }
        catch { raw = null }
      }
      else if (roots.length > 1) {
        raw = null
      }
      const result = readPbSubmissionResult({ origin: location.origin, store: parent[1], flow: parent[2], cartPath: path, total: fresh.form.total! }, location.href, raw)
      if (result.status === 'accepted')
        onAccepted()
      return result
    },
  }
}
