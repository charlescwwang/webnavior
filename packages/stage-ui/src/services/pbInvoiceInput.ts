import type { ScannedInvoiceMethod } from '@proj-airi/stage-shared/invoice-input'

import { invoiceCode } from '@proj-airi/stage-shared/invoice-input'

import { orderingMessages } from '../../../i18n/src/orderingMessages'

/**
 * Owns only the selected native invoice field. Scanner Enter finishes input;
 * it never clicks checkout or grants order consent. Values stay in the page.
 */
export function installInvoiceInput() {
  let owned: { field: HTMLInputElement, method: ScannedInvoiceMethod, path: string } | undefined
  let selectedField: HTMLInputElement | undefined
  const copy = orderingMessages['zh-Hant'].checkout

  function current() {
    if (!location.pathname.endsWith('/orders/create'))
      return
    const methods = [
      { method: 'carrier' as const, value: '3', placeholder: '請輸入共8碼編號' },
      { method: 'citizen' as const, value: '2', placeholder: '2碼英文字碼+14碼數字' },
    ]
    const fields = methods.flatMap(({ method, value, placeholder }) => Array.from(document.querySelectorAll<HTMLLabelElement>('.order-create label.el-radio'))
      .filter(label => label.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)?.checked)
      .flatMap(label => Array.from(label.querySelectorAll<HTMLInputElement>(`input[placeholder="${placeholder}"]`)).map(field => ({ field, method }))))
      .filter(({ field }) => field.isConnected && field.getClientRects().length && !field.disabled && !field.readOnly)
    return fields.length === 1 ? fields[0] : undefined
  }

  function sync() {
    const selected = current()
    if (owned && (selected?.field !== owned.field || owned.path !== location.pathname))
      owned = undefined
    if (selected?.field === selectedField)
      return
    selectedField = selected?.field
    // Do not repeatedly steal focus back after a customer clicks elsewhere.
    // A newly rendered selected field follows the owned Menu's invoice focus.
    if (selected) {
      const focused = document.activeElement
      if (focused && focused !== document.body && focused !== selected.field && !focused.matches('input[type="radio"]'))
        return
      selected.field.focus({ preventScroll: true })
      if (document.activeElement === selected.field)
        owned = { ...selected, path: location.pathname }
    }
  }
  function owns(event: Event) {
    const selected = current()
    return Boolean(owned && selected?.field === owned.field && owned.path === location.pathname
      && event.target === owned.field && document.activeElement === owned.field)
  }
  function focus(event: FocusEvent) {
    const selected = current()
    owned = selected && event.target === selected.field ? { ...selected, path: location.pathname } : undefined
  }
  function blur(event: FocusEvent) {
    if (event.target === owned?.field)
      owned = undefined
  }
  function input(event: Event) {
    if (owns(event))
      owned!.field.setCustomValidity('')
  }
  function keydown(event: KeyboardEvent) {
    if (!owns(event) || event.key !== 'Enter')
      return
    event.preventDefault()
    event.stopImmediatePropagation()
    const { field, method } = owned!
    const code = invoiceCode(method, field.value)
    if (!code) {
      field.setCustomValidity(method === 'carrier' ? copy.carrierFormatError : copy.citizenFormatError)
      field.reportValidity()
      field.select()
      return
    }
    // Vue must receive its real input/change contract. Blur lets PB run its
    // own carrier check; local format acceptance is not official verification.
    field.value = code
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
    field.blur()
  }
  document.addEventListener('focusin', focus, true)
  document.addEventListener('focusout', blur, true)
  document.addEventListener('input', input, true)
  document.addEventListener('keydown', keydown, true)
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled', 'readonly'] })
  sync()
  return {
    owns,
    /** True only while this document's selected invoice field owns keyboard input. */
    pending: () => Boolean(owned && current()?.field === owned.field && document.activeElement === owned.field && owned.path === location.pathname),
    /** Leaves scanner input before a meal operation without clearing the entered value. */
    leave() {
      const field = owned?.field
      owned = undefined
      // Keep selectedField: unrelated cart rendering must not focus this field again.
      if (field && document.activeElement === field)
        field.blur()
    },
    /** Reception reset invalidates expected input without clearing shared login. */
    reset() { owned = undefined },
    dispose() {
      owned = undefined
      observer.disconnect()
      document.removeEventListener('focusin', focus, true)
      document.removeEventListener('focusout', blur, true)
      document.removeEventListener('input', input, true)
      document.removeEventListener('keydown', keydown, true)
    },
  }
}
