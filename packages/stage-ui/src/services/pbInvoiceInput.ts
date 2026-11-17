import type { ScannedInvoiceMethod } from '@proj-airi/stage-shared/invoice-input'

import { invoiceCode } from '@proj-airi/stage-shared/invoice-input'

import { orderingMessages } from '../../../i18n/src/orderingMessages'
import { notificationField } from './pbCheckout'

/**
 * Owns checkout field editing and the notification phone touch keypad. Scanner Enter finishes input;
 * it never clicks checkout or grants order consent. Values stay in the page.
 */
export function installInvoiceInput() {
  let owned: { field: HTMLInputElement, method: ScannedInvoiceMethod, path: string } | undefined
  let selectedField: HTMLInputElement | undefined
  let keypad: { field: HTMLInputElement, root: HTMLElement, trigger: HTMLButtonElement } | undefined
  let keyboardClosed = false
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
    const phone = location.pathname.endsWith('/orders/create') ? notificationField('phone') : undefined
    if (keypad && (keypad.field !== phone || !keypad.root.isConnected)) {
      keypad.root.remove()
      keypad.trigger.remove()
      keypad = undefined
    }
    if (phone && !keypad) {
      const root = document.createElement('div')
      root.setAttribute('role', 'group')
      root.setAttribute('aria-label', copy.phoneKeypad.title)
      root.popover = 'manual'
      root.style.cssText = 'display:none;position:fixed;inset:auto 12px 12px auto;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;width:min(340px,calc(100vw - 24px));max-height:70vh;overflow:auto;margin:0;padding:14px;border:1px solid #ead7c9;border-radius:18px;background:#fff;color:#3d281c;box-shadow:0 12px 40px #0004;'
      const title = document.createElement('strong')
      title.textContent = copy.phoneKeypad.title
      title.style.cssText = 'grid-column:span 2;align-self:center;'
      const close = document.createElement('button')
      close.type = 'button'
      close.textContent = copy.phoneKeypad.close
      close.style.cssText = 'min-height:40px;border:1px solid #ead7c9;border-radius:10px;background:#fff9f3;color:#3d281c;'
      close.addEventListener('click', () => {
        // Closing must not reopen when hidePopover restores focus to the phone.
        keyboardClosed = true
        root.hidePopover()
        root.style.display = 'none'
      })
      root.append(title, close)
      const hint = document.createElement('p')
      hint.textContent = copy.phoneKeypad.hint
      hint.style.cssText = 'grid-column:1/-1;margin:0 0 4px;font-size:16px;line-height:1.5;color:#3d281c;'
      root.append(hint)
      // The keypad writes only this connected merchant field via Vue's native
      // input/change contract. Every key is type=button: no implicit form submit.
      for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'delete']) {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.phoneDigit = 'true'
        button.textContent = key === 'clear' ? copy.phoneKeypad.clear : key === 'delete' ? copy.phoneKeypad.delete : key
        button.style.cssText = 'min-height:48px;border:1px solid #ead7c9;border-radius:12px;background:#fff9f3;color:#3d281c;font-size:20px;touch-action:manipulation;'
        button.disabled = phone.disabled || phone.readOnly
        button.addEventListener('click', () => {
          if (!phone.isConnected || phone.disabled || phone.readOnly || notificationField('phone') !== phone || !location.pathname.endsWith('/orders/create'))
            return
          const value = key === 'clear' ? '' : key === 'delete' ? phone.value.slice(0, -1) : (phone.value + key).slice(0, phone.maxLength > 0 ? phone.maxLength : 15)
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(phone, value)
          phone.dispatchEvent(new Event('input', { bubbles: true }))
          phone.dispatchEvent(new Event('change', { bubbles: true }))
          phone.focus({ preventScroll: true })
        })
        root.append(button)
      }
      const trigger = document.createElement('button')
      trigger.type = 'button'
      trigger.textContent = copy.phoneKeypad.open
      trigger.style.cssText = 'margin:6px 0;min-height:40px;padding:6px 12px;border:1px solid #ead7c9;border-radius:10px;background:#fff9f3;color:#3d281c;'
      trigger.addEventListener('click', showKeypad)
      phone.closest('.el-form-item, .field')!.append(trigger)
      document.body.append(root)
      keypad = { field: phone, root, trigger }
      keyboardClosed = false
      if (document.activeElement === phone)
        showKeypad()
    }
    if (keypad) {
      for (const button of [...Array.from(keypad.root.querySelectorAll<HTMLButtonElement>('button[data-phone-digit]')), keypad.trigger]) {
        const disabled = keypad.field.disabled || keypad.field.readOnly
        if (button.disabled !== disabled)
          button.disabled = disabled
      }
    }
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
  function showKeypad() {
    if (!keypad || keypad.field.disabled || keypad.field.readOnly || !keypad.field.isConnected)
      return
    keyboardClosed = false
    if (keypad.root.matches(':popover-open'))
      return
    // Use the same native top-layer popover boundary as PB's visual cues.
    // The merchant form keeps its original layout; place the panel on the
    // opposite half from the focused field, with an explicit close control.
    const above = keypad.field.getBoundingClientRect().top > window.innerHeight / 2
    keypad.root.style.top = above ? '12px' : 'auto'
    keypad.root.style.bottom = above ? 'auto' : '12px'
    keypad.root.style.display = 'grid'
    keypad.root.showPopover()
  }
  function pointer(event: PointerEvent) {
    if (event.target === keypad?.field)
      showKeypad()
  }
  function ownsScanner(event: Event) {
    const selected = current()
    return Boolean(owned && selected?.field === owned.field && owned.path === location.pathname
      && event.target === owned.field && document.activeElement === owned.field)
  }
  function focus(event: FocusEvent) {
    if (!keyboardClosed && event.target === keypad?.field)
      showKeypad()
    const selected = current()
    owned = selected && event.target === selected.field ? { ...selected, path: location.pathname } : undefined
  }
  function blur(event: FocusEvent) {
    if (event.target === owned?.field)
      owned = undefined
  }
  function input(event: Event) {
    if (ownsScanner(event))
      owned!.field.setCustomValidity('')
  }
  function keydown(event: KeyboardEvent) {
    if (!ownsScanner(event) || event.key !== 'Enter')
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
  document.addEventListener('pointerdown', pointer, true)
  document.addEventListener('focusin', focus, true)
  document.addEventListener('focusout', blur, true)
  document.addEventListener('input', input, true)
  document.addEventListener('keydown', keydown, true)
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled', 'readonly'] })
  sync()
  return {
    // Checkout drafts do not change cart contents. Preserve the bound step from
    // the first pointerdown, before focusin has established scanner ownership.
    owns(event: Event) {
      if (!location.pathname.endsWith('/orders/create') || !(event.target instanceof Node))
        return false
      return event.target === current()?.field || event.target === notificationField('phone')
        || event.target === notificationField('email') || event.target === keypad?.trigger || Boolean(keypad?.root.contains(event.target))
    },
    /** True only while this document's selected invoice field owns keyboard input. */
    pending: () => Boolean(owned && current()?.field === owned.field && document.activeElement === owned.field && owned.path === location.pathname),
    /** Leaves draft editing and closes its floating panel without clearing entered values. */
    leave() {
      const field = owned?.field
      owned = undefined
      // Native submission checks occlusion. Close our own panel before leaving
      // editing, and suppress focus restoration from reopening it over checkout.
      keyboardClosed = true
      if (keypad) {
        keypad.root.hidePopover()
        keypad.root.style.display = 'none'
        if (document.activeElement === keypad.field)
          keypad.field.blur()
      }
      // Keep selectedField: unrelated cart rendering must not focus this field again.
      if (field && document.activeElement === field)
        field.blur()
    },
    /** Reception reset invalidates expected input without clearing shared login. */
    reset() { owned = undefined },
    dispose() {
      owned = undefined
      keypad?.root.remove()
      keypad?.trigger.remove()
      keypad = undefined
      observer.disconnect()
      document.removeEventListener('pointerdown', pointer, true)
      document.removeEventListener('focusin', focus, true)
      document.removeEventListener('focusout', blur, true)
      document.removeEventListener('input', input, true)
      document.removeEventListener('keydown', keydown, true)
    },
  }
}
