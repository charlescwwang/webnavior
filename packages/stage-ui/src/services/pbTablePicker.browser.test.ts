import { afterEach, expect, it, vi } from 'vitest'

import { installTablePicker } from './pbTablePicker'

const initialUrl = location.href
const tablePath = '/order/store/1kAMNok/internal_use/menu/select-table'
let picker: ReturnType<typeof installTablePicker> | undefined
afterEach(() => {
  picker?.dispose()
  history.replaceState({}, '', initialUrl)
  document.body.replaceChildren()
})

function setup(read: () => Promise<readonly string[]> = async () => ['櫃台取餐', 'A1 桌', 'B1 吧檯']) {
  history.replaceState({}, '', tablePath)
  document.body.innerHTML = '<div class="table-row__select"><input role="combobox" aria-controls="tables" aria-expanded="false"><div class="el-select__placeholder">櫃台取餐</div></div><button id="start">開始點餐</button><ul id="other"><li role="option">A1 桌</li></ul>'
  const start = vi.fn()
  document.querySelector('#start')!.addEventListener('click', start)
  const chosen = vi.fn()
  const control = document.querySelector<HTMLInputElement>('[role=combobox]')!
  control.addEventListener('click', () => {
    control.setAttribute('aria-expanded', 'true')
    const list = document.createElement('ul')
    list.id = 'tables'
    for (const name of ['櫃台取餐', 'A1 桌', 'B1 吧檯']) {
      const option = document.createElement('li')
      option.setAttribute('role', 'option')
      option.textContent = name
      option.addEventListener('click', () => {
        chosen(name)
        document.querySelector('.el-select__placeholder')!.textContent = name
        control.setAttribute('aria-expanded', 'false')
        list.remove()
      })
      list.append(option)
    }
    document.body.append(list)
  })
  picker = installTablePicker(tablePath, read)
  return { start, chosen, control }
}

it('shows real table names and the current website default without starting automatically', async () => {
  setup()
  await picker!.choices()
  const shadow = document.querySelector('[data-webnavior-table-picker]')!.shadowRoot!
  expect(Array.from(shadow.querySelectorAll('button')).map(button => button.textContent)).toEqual(['櫃台取餐', 'A1 桌', 'B1 吧檯'])
  expect(shadow.querySelector('[aria-pressed=true]')?.textContent).toBe('櫃台取餐')
  expect(shadow.textContent).not.toContain('qr_token')
})

it('selects the exact option from its associated dropdown, verifies it, and leaves Start to the customer', async () => {
  const { chosen, start } = setup()
  expect(await picker!.choose('A1 桌')).toBe('A1 桌')
  expect(chosen).toHaveBeenCalledExactlyOnceWith('A1 桌')
  expect(start).not.toHaveBeenCalled()
  const selected = document.querySelector('[data-webnavior-table-picker]')!.shadowRoot!.querySelector('[aria-pressed=true]')
  expect(selected?.textContent).toBe('A1 桌')
})

it('rechecks current table availability before pressing a previously displayed button', async () => {
  let names = ['櫃台取餐', 'A1 桌']
  const { chosen, start } = setup(async () => names)
  await picker!.choices()
  names = ['櫃台取餐']
  await expect(picker!.choose('A1 桌')).rejects.toThrow('not currently offered')
  expect(chosen).not.toHaveBeenCalled()
  expect(start).not.toHaveBeenCalled()
})

it('stops selection when the Agent loses control while the fresh table read is in flight', async () => {
  let release!: (names: string[]) => void
  const { chosen, control } = setup(() => new Promise((resolve) => {
    release = resolve
  }))
  const controller = new AbortController()
  const pending = picker!.choose('A1 桌', controller.signal)
  controller.abort()
  release(['A1 桌'])
  await expect(pending).rejects.toThrow()
  expect(chosen).not.toHaveBeenCalled()
  expect(control.getAttribute('aria-expanded')).toBe('false')
})

it('does not guess between duplicate table names', async () => {
  const { chosen } = setup(async () => ['A1 桌', 'A1 桌'])
  await expect(picker!.choose('A1 桌')).rejects.toThrow('ambiguous')
  expect(chosen).not.toHaveBeenCalled()
})

// Report: this chat; table selection and Start must both support voice control.
it('starts ordering only after verifying the explicitly named table', async () => {
  const { chosen, start } = setup()
  await picker!.start('A1 桌')
  expect(chosen).toHaveBeenCalledExactlyOnceWith('A1 桌')
  expect(start).toHaveBeenCalledOnce()
})

it('does not start from the website default when no table was supplied', async () => {
  const { start } = setup()
  await expect(picker!.start('')).rejects.toThrow()
  expect(start).not.toHaveBeenCalled()
})

it('reads the latest website selection for the next voice turn', async () => {
  setup()
  expect(picker!.selection()).toBeUndefined()
  await picker!.choose('A1 桌')
  expect(picker!.selection()).toBe('A1 桌')
  document.querySelector('.el-select__placeholder')!.textContent = 'B1 吧檯'
  expect(picker!.selection()).toBe('B1 吧檯')
})

it('refuses a disabled native Start control', async () => {
  const { start } = setup()
  document.querySelector('#start')!.setAttribute('disabled', '')
  await expect(picker!.start('A1 桌')).rejects.toThrow()
  expect(start).not.toHaveBeenCalled()
})

it('does not guess between multiple visible Start controls', async () => {
  const { start } = setup()
  document.querySelector('#start')!.insertAdjacentHTML('afterend', '<button>開始點餐</button>')
  await expect(picker!.start('A1 桌')).rejects.toThrow()
  expect(start).not.toHaveBeenCalled()
})

it('does not click Start after customer takeover during selection', async () => {
  const { chosen, start } = setup()
  const controller = new AbortController()
  chosen.mockImplementation(() => controller.abort())
  await expect(picker!.start('A1 桌', controller.signal)).rejects.toThrow()
  expect(start).not.toHaveBeenCalled()
})

it('waits for the native dropdown closing transition before pressing Start', async () => {
  const { chosen, start } = setup()
  chosen.mockImplementation(() => {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:white'
    document.body.append(overlay)
    setTimeout(() => {
      expect(start).not.toHaveBeenCalled()
      overlay.remove()
    }, 75)
  })
  await picker!.start('A1 桌')
  expect(start).toHaveBeenCalledOnce()
})

// Report: this chat; a manual native choice must be accepted for the next voice Start.
it('accepts a native dropdown choice and keeps the large-button selection in sync', async () => {
  const { control } = setup()
  await picker!.choices()
  control.click()
  const option = Array.from(document.querySelectorAll<HTMLElement>('#tables [role=option]')).find(option => option.textContent === 'A1 桌')!
  option.click()
  await Promise.resolve()
  expect(picker!.selection()).toBe('A1 桌')
  expect(document.querySelector('[data-webnavior-table-picker]')!.shadowRoot!.querySelector('[aria-pressed=true]')?.textContent).toBe('A1 桌')
})

// Report: this chat, 2026-11-14 — voice counter pickup lacked the Agent hand cue.
it('points to the counter pickup button with only one hand cue', async () => {
  const { chosen } = setup()
  const labels: string[] = []
  const tap = vi.fn(async (_target: HTMLElement, label: string, press: () => void) => {
    labels.push(label)
    press()
  })
  expect(await picker!.choose('我要外帶', undefined, tap)).toBe('櫃台取餐')
  expect(labels).toEqual(['櫃台取餐'])
  expect(chosen).toHaveBeenCalledExactlyOnceWith('櫃台取餐')
})

// Report: this chat, Nov14 Start reopened the table dropdown after a touch choice.
it('starts the current touch selection without choosing it a second time', async () => {
  const { chosen, start } = setup()
  await picker!.choose('B1 吧檯')
  chosen.mockClear()
  await picker!.start('B1 吧檯')
  expect(chosen).not.toHaveBeenCalled()
  expect(start).toHaveBeenCalledOnce()
})

it('exposes the actual default and starts it only on an explicit start request', async () => {
  const { chosen, start } = setup()
  await picker!.choices()
  expect(picker!.selection()).toBe('櫃台取餐')
  expect(start).not.toHaveBeenCalled()
  await picker!.start('櫃台取餐')
  expect(chosen).not.toHaveBeenCalled()
  expect(start).toHaveBeenCalledOnce()
})

// Report: this chat, Nov14 touch/voice table changes must not race the illustrated Start.
it('does not press Start if the table changes while its hand is moving', async () => {
  const { start } = setup()
  await picker!.choose('A1 桌')
  const tap = async (_target: HTMLElement, label: string, press: () => void) => {
    if (label === '開始點餐')
      document.querySelector('.el-select__placeholder')!.textContent = 'B1 吧檯'
    press()
  }
  await expect(picker!.start('A1 桌', undefined, tap)).rejects.toThrow()
  expect(start).not.toHaveBeenCalled()
})

it('updates the large buttons when the native framework edits the selected text node', async () => {
  setup()
  await picker!.choices()
  document.querySelector('.el-select__placeholder')!.firstChild!.nodeValue = 'B1 吧檯'
  await Promise.resolve()
  expect(document.querySelector('[data-webnavior-table-picker]')!.shadowRoot!.querySelector('[aria-pressed=true]')?.textContent).toBe('B1 吧檯')
})
