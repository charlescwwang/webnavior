import { resolveTableName } from '@proj-airi/stage-shared/table-names'

import { orderingMessages } from '../../../i18n/src/orderingMessages'

type TableTap = (target: HTMLElement, label: string, press: () => void) => Promise<void>

/**
 * Makes the native PB table selector touch-friendly inside its isolated view.
 * Buttons use current names; table tokens never leave the original PB controls.
 * Selection alone does not start ordering or establish cart ownership.
 */
export function installTablePicker(path: string, read: () => Promise<readonly string[]>) {
  const copy = orderingMessages['zh-Hant'].checkout
  let names: readonly string[] = []
  let host: HTMLDivElement | undefined
  let disposed = false
  let generation = 0
  let selected: string | undefined
  let pending = false

  const visible = (element: Element) => element.isConnected && element.getClientRects().length > 0
  function selector() {
    const candidates = [...document.querySelectorAll<HTMLElement>('.table-row__select [role="combobox"]')].filter(visible)
    return location.pathname === path && candidates.length === 1 ? candidates[0] : undefined
  }
  function assertCurrent(revision: number) {
    if (disposed || generation !== revision || location.pathname !== path)
      throw new Error('PB table selection changed.')
  }
  function render() {
    const target = selector()?.closest('.table-row__select')
    if (disposed || !target || !names.length) {
      host?.remove()
      host = undefined
      return
    }
    if (host?.isConnected)
      return
    host = document.createElement('div')
    host.setAttribute('data-webnavior-table-picker', '')
    // Shadow styles belong to this isolated vendor enhancement, independent
    // from the Host's UnoCSS and from PB's changing utility class definitions.
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = ':host{display:block;margin:20px 0;color:#243147;font:inherit}h2{font-size:24px;margin:0 0 12px}.tables{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}button{min-height:76px;padding:14px 8px;border:2px solid #cbd5e1;border-radius:12px;background:#fff;color:inherit;font:inherit;font-size:22px;cursor:pointer}button[aria-pressed=true]{border-color:#2563eb;background:#eff6ff}button:focus-visible{outline:3px solid #2563eb;outline-offset:2px}button:disabled{opacity:.6}p{line-height:1.6}p[role=alert]{color:#b42318}@media(max-width:500px){.tables{grid-template-columns:repeat(2,minmax(0,1fr))}button{font-size:18px}}'
    const heading = document.createElement('h2')
    heading.textContent = copy.tablePickerTitle
    const grid = document.createElement('div')
    grid.className = 'tables'
    grid.setAttribute('role', 'group')
    grid.setAttribute('aria-label', copy.tablePickerTitle)
    const hint = document.createElement('p')
    hint.textContent = copy.tablePickerHint
    const error = document.createElement('p')
    error.setAttribute('role', 'alert')
    for (const name of names) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = name
      button.setAttribute('aria-pressed', String(selected === name))
      button.addEventListener('click', () => {
        void choose(name).catch(() => {
          error.textContent = copy.tablePickerFailed
        })
      })
      grid.append(button)
    }
    shadow.append(style, heading, grid, hint, error)
    target.insertAdjacentElement('afterend', host)
  }

  async function choices() {
    if (disposed || location.pathname !== path)
      return []
    const revision = generation
    const fresh = await read()
    assertCurrent(revision)
    if (!fresh.length || fresh.some(name => !name.trim()) || new Set(fresh).size !== fresh.length)
      throw new Error('PB table names are unavailable or ambiguous.')
    if (JSON.stringify(names) !== JSON.stringify(fresh)) {
      names = fresh
      host?.remove()
      host = undefined
    }
    render()
    return [...names]
  }

  async function choose(requestedName: string, signal?: AbortSignal, tap?: TableTap) {
    if (tap) {
      const name = resolveTableName(requestedName, await choices())
      const button = [...host?.shadowRoot?.querySelectorAll('button') ?? []].find(button => button.textContent === name)
      if (!name || !button)
        throw new Error('The requested table is not currently offered.')
      let applied: Promise<string> | undefined
      await tap(button, name, () => {
        signal?.throwIfAborted()
        applied = choose(name, signal)
        // Observe early failure while the tap finishes; the await below rethrows it.
        void applied.catch(() => {})
      })
      if (!applied)
        throw new Error('PB table selection was not dispatched.')
      return applied
    }
    if (pending)
      throw new Error('PB table selection is still in progress.')
    pending = true
    const revision = generation
    const ensureCurrent = () => {
      assertCurrent(revision)
      signal?.throwIfAborted()
    }
    try {
      const name = resolveTableName(requestedName, await choices())
      if (!name)
        throw new Error('The requested table is not currently offered.')
      ensureCurrent()
      const control = selector()
      if (!control)
        throw new Error('PB table selector changed.')
      const listId = control.getAttribute('aria-controls')
      if (!listId)
        throw new Error('PB table selector is not associated with a list.')
      if (control.getAttribute('aria-expanded') !== 'true') {
        control.click()
      }
      const deadline = performance.now() + 2000
      let option: HTMLElement | undefined
      while (!option) {
        ensureCurrent()
        if (selector() !== control)
          throw new Error('PB table selector was replaced.')
        const matches = [...document.getElementById(listId)?.querySelectorAll<HTMLElement>('[role="option"]') ?? []].filter(element => visible(element) && element.textContent?.trim() === name && element.getAttribute('aria-disabled') !== 'true')
        if (matches.length > 1)
          throw new Error('PB table option is ambiguous.')
        option = matches[0]
        if (!option) {
          if (performance.now() >= deadline)
            throw new Error('PB table option is unavailable.')
          await new Promise(resolve => setTimeout(resolve, 25))
        }
      }
      ensureCurrent()
      option.click()
      while (control.closest('.table-row__select')?.querySelector('.el-select__placeholder')?.textContent?.trim() !== name) {
        ensureCurrent()
        if (performance.now() >= deadline)
          throw new Error('PB table selection could not be verified.')
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      selected = name
      for (const button of host?.shadowRoot?.querySelectorAll('button') ?? [])
        button.setAttribute('aria-pressed', String(button.textContent === name))
      return name
    }
    finally { pending = false }
  }

  function selection() {
    const visibleName = selector()?.closest('.table-row__select')?.querySelector('.el-select__placeholder')?.textContent?.trim()
    // This is the visible website selection, including its default. It is
    // context, never consent to order; only a customer Start request enters menu.
    selected = visibleName && names.includes(visibleName) ? visibleName : undefined
    for (const button of host?.shadowRoot?.querySelectorAll('button') ?? [])
      button.setAttribute('aria-pressed', String(button.textContent === selected))
    return selected
  }

  async function start(name: string, signal?: AbortSignal, tap?: TableTap) {
    const revision = generation
    const available = await choices()
    const requested = resolveTableName(name, available)
    if (!requested)
      throw new Error('The requested table is not currently offered.')
    // A separate Start turn uses the current touch/default selection directly.
    name = selection() === requested ? requested : await choose(requested, signal, tap)
    signal?.throwIfAborted()
    if (selection() !== name)
      throw new Error('桌號已變更，請重新確認。')
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(button => visible(button) && button.textContent?.trim() === '開始點餐')
    const button = buttons.length === 1 ? buttons[0] : undefined
    if (!button || button.matches(':disabled, [aria-disabled="true"]'))
      throw new Error('目前無法操作「開始點餐」，請確認畫面後再試。')
    button.scrollIntoView({ block: 'center', behavior: 'instant' })
    const deadline = performance.now() + 2500
    // PB keeps the closing dropdown over Start during its transition. Wait for
    // real hit-target readiness, while retaining table/document/caller ownership.
    while (true) {
      assertCurrent(revision)
      signal?.throwIfAborted()
      if (selection() !== name || !button.isConnected || button.matches(':disabled, [aria-disabled="true"]'))
        throw new Error('桌號或開始按鈕已變更，請重新確認。')
      const bounds = button.getBoundingClientRect()
      if (button.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)))
        break
      if (performance.now() >= deadline)
        throw new Error('「開始點餐」被其他畫面遮住，請確認後再試。')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    // This is menu entry, never order submission. A full document navigation
    // revokes this executor; the new document must prove the bound table/cart.
    if (tap) {
      await tap(button, '開始點餐', () => {
        assertCurrent(revision)
        signal?.throwIfAborted()
        if (selection() !== name || !button.isConnected || button.matches(':disabled, [aria-disabled="true"]'))
          throw new Error('桌號或開始按鈕已變更，請重新確認。')
        button.click()
      })
    }
    else {
      button.click()
    }
    return name
  }
  const observer = new MutationObserver(() => {
    selection()
    render()
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  return {
    choices,
    choose,
    selection,
    start,
    dispose() {
      disposed = true
      generation++
      observer.disconnect()
      host?.remove()
    },
  }
}
