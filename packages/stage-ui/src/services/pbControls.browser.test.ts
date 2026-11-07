import { afterEach, expect, it, vi } from 'vitest'

import { createControls } from './pbControls'
import { createOperation } from './pbOperation'

const initialUrl = location.href
afterEach(() => {
  history.replaceState({}, '', initialUrl)
  document.body.replaceChildren()
})
function setup() {
  history.replaceState({}, '', '/order/store/1kgJeql/pick_up/menu')
  document.body.innerHTML = '<main><button><h4>每日新品</h4></button></main>'
  document.querySelector('main button')!.addEventListener('click', () => {
    document.body.insertAdjacentHTML('beforeend', `<div role="dialog"><div class="menu-dialog"><h1>每日新品</h1><button class="el-dialog__headerbtn">關閉</button><div class="product-item"><h4>加購</h4><ul><li><div class="flex-col"><span>白飯 <span>$5</span></span></div><input type="number" min="0" max="2" value="0"></li></ul></div><input placeholder="商品有特殊需求，請在此備註"><div class="dialog-footer"><input type="number" min="1" max="99" value="1"><button>選好了 共計$10</button></div></div></div>`)
    for (const input of document.querySelectorAll('input[type=number]')) {
      input.addEventListener('change', () => {
        const option = Number(document.querySelector<HTMLInputElement>('.product-item input')!.value)
        const quantity = Number(document.querySelector<HTMLInputElement>('.dialog-footer input')!.value)
        document.querySelector('.dialog-footer button')!.textContent = `選好了 共計$${(10 + option * 5) * quantity}`
      })
    }
    document.querySelector('.el-dialog__headerbtn')!.addEventListener('click', () => document.querySelector('[role=dialog]')!.remove())
  })
  const controller = new AbortController()
  const operation = createOperation({ documentId: 'daily', operationId: 'one', signal: controller.signal, follow: async (_target, _label, dispatch) => {
    await dispatch()
    return true
  } })
  const controls = createControls(operation, controller.signal)
  const configuration = { version: 'today', variantRef: '', name: '', unitPrice: 10, groups: [{ ref: 'g-1', name: '加購', required: false, maximum: 2, choices: [{ ref: 'a-1', name: '白飯', unitPrice: 5, maximum: 2 }] }] }
  const selection = { version: 'today', variantRef: '', choices: [{ ref: 'a-1', quantity: 1 }] }
  return { controls, operation, controller, configuration, selection }
}
it('opens the actual daily item, fills each-serving options, meal quantity and note, then commits exactly once', async () => {
  const { controls, operation, configuration, selection } = setup()
  await controls.prepare('每日新品', 'daily-ref', configuration, selection, 2, '飯少')
  expect(document.querySelector<HTMLInputElement>('.product-item input')!.value).toBe('1')
  expect(document.querySelector<HTMLInputElement>('.dialog-footer input')!.value).toBe('2')
  expect(document.querySelector<HTMLInputElement>('input[placeholder]')!.value).toBe('飯少')
  const dispatch = vi.fn(() => document.querySelector('[role=dialog]')!.remove())
  document.querySelector('.dialog-footer button')!.addEventListener('click', dispatch)
  await controls.add('每日新品', 'daily-ref', async () => {}, async () => dispatch.mock.calls.length === 1)
  expect(dispatch).toHaveBeenCalledOnce()
  expect(operation.snapshot().steps.map(step => step.action)).toEqual(['open-product', 'option', 'quantity', 'note', 'add'])
  expect(operation.snapshot().steps.every(step => step.state === 'completed')).toBe(true)
})
it('rejects a disabled merchant add control without dispatching', async () => {
  const { controls, configuration, selection } = setup()
  await controls.prepare('每日新品', 'daily-ref', configuration, selection, 1, '')
  const button = document.querySelector<HTMLButtonElement>('.dialog-footer button')!
  button.disabled = true
  const clicked = vi.fn()
  button.addEventListener('click', clicked)
  await expect(controls.add('每日新品', 'daily-ref', async () => {}, async () => true)).rejects.toThrow('不可操作')
  expect(clicked).not.toHaveBeenCalled()
})
it('does not choose the first same-name option when the vendor duplicates a group', async () => {
  const { controls, configuration, selection } = setup()
  await controls.open('每日新品')
  document.querySelector('.product-item')!.insertAdjacentElement('afterend', document.querySelector('.product-item')!.cloneNode(true) as HTMLElement)
  await expect(controls.prepare('每日新品', 'daily-ref', configuration, selection, 1, '')).rejects.toThrow('無法確認')
  expect(document.querySelector<HTMLInputElement>('.product-item input')!.value).toBe('0')
})
it('visits only the native cart, edits the unique line once and returns through the native menu link', async () => {
  const { controls, operation } = setup()
  let amount = 1
  document.body.insertAdjacentHTML('beforeend', '<button id="cart">$10 去結算</button>')
  const renderMenu = () => {
    history.pushState({}, '', '/order/store/1kgJeql/pick_up/menu')
    document.body.innerHTML = '<input placeholder="搜尋品項，例如：拿鐵、雞腿、套餐">'
  }
  document.querySelector('#cart')!.addEventListener('click', () => {
    history.pushState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
    document.body.innerHTML = '<main class="order-create"><div class="produce-item"><h3>每日新品 <span>($10)</span></h3><input type="number" value="1"></div><a href="/order/store/1kgJeql/pick_up/menu">繼續點餐</a></main>'
    document.querySelector('input')!.addEventListener('change', event => amount = Number((event.target as HTMLInputElement).value))
    document.querySelector('a')!.addEventListener('click', (event) => {
      event.preventDefault()
      renderMenu()
    })
  })
  // Report: this chat, Nov1 live PB; returning to menu reopened the store
  // announcement over the cart footer. It must be dismissed by its real control.
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:white'
  overlay.innerHTML = '<button>我知道了，開始點餐</button>'
  overlay.querySelector('button')!.addEventListener('click', () => overlay.remove())
  document.body.append(overlay)
  await controls.edit([{ ref: 'line', name: '每日新品', quantity: 1, unitPrice: 10, productRef: 'daily', configuration: '' }], 'line', 2, async () => {}, async () => amount === 2)
  expect(amount).toBe(2)
  await controls.navigate('/order/store/1kgJeql/pick_up/menu')
  expect(location.pathname.endsWith('/menu')).toBe(true)
  expect(operation.snapshot().steps.map(step => step.action)).toEqual(['notice', 'navigate', 'quantity', 'navigate'])
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, S04/S09/S12.
it('selects the visible configuration by its observed price when product name and quantity are the same', async () => {
  const { controls } = setup()
  history.replaceState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
  document.body.innerHTML = '<main class="order-create"><div class="produce-item"><h3>每日新品 <span>($10)</span></h3><input type="number" value="1"><button class="is-circle">刪除</button></div><div class="produce-item"><h3>每日新品 <span>($15)</span></h3><p>白飯 ×1</p><input type="number" value="1"><button class="is-circle">刪除</button></div></main>'
  const removed = vi.fn()
  const rows = document.querySelectorAll('.produce-item')
  rows[1].querySelector('button')!.addEventListener('click', removed)
  const wrongRow = vi.fn()
  rows[0].querySelector('button')!.addEventListener('click', wrongRow)
  await controls.edit([{ ref: 'plain', name: '每日新品', productRef: 'daily', quantity: 1, unitPrice: 10, configuration: 'plain' }, { ref: 'rice', name: '每日新品', productRef: 'daily', quantity: 1, unitPrice: 15, configuration: 'rice', description: '白飯 ×1' }], 'rice', undefined, async () => {}, async () => removed.mock.calls.length === 1)
  expect(removed).toHaveBeenCalledTimes(1)
  expect(wrongRow).not.toHaveBeenCalled()
})

it('does not select an arbitrary rendered row when its entire visible signature is duplicated', async () => {
  const { controls } = setup()
  history.replaceState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
  document.body.innerHTML = `<main class="order-create">${'<div class="produce-item"><h3>每日新品 <span>($10)</span></h3><input type="number" value="1"><button class="is-circle">刪除</button></div>'.repeat(2)}</main>`
  const clicked = vi.fn()
  document.querySelectorAll('button').forEach(button => button.addEventListener('click', clicked))
  await expect(controls.edit(['first', 'second'].map(ref => ({ ref, name: '每日新品', productRef: 'daily', quantity: 1, unitPrice: 10, configuration: '', options: [] })), 'first', undefined, async () => {}, async () => true)).rejects.toThrow()
  expect(clicked).not.toHaveBeenCalled()
})

// Source: PB Create-DccDhWl4.js / DetailProductPrice-DpUTh351.js observed Nov3.
it('identifies equal-name/equal-count/equal-price rows by the complete rendered note without prefix matching', async () => {
  const { controls } = setup()
  history.replaceState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
  document.body.innerHTML = `<main class="order-create">${['飯少少', '飯少'].map(note => `<div class="produce-item"><h3>每日新品 <span>($10)</span></h3><div class="product-attr"><div><div class="ml-4"><span></span></div></div><div class="ml-4">${note}</div></div><input type="number" value="1"><button class="is-circle">刪除</button></div>`).join('')}</main>`
  const rows = document.querySelectorAll('.produce-item')
  const correct = vi.fn()
  const wrong = vi.fn()
  rows[0].querySelector('button')!.addEventListener('click', wrong)
  rows[1].querySelector('button')!.addEventListener('click', correct)
  await controls.edit(['飯少少', '飯少'].map((note, index) => ({ ref: index ? 'exact-note' : 'other-note', name: '每日新品', productRef: 'daily', quantity: 1, unitPrice: 10, configuration: note, note, options: [] })), 'exact-note', undefined, async () => {}, async () => correct.mock.calls.length === 1)
  expect(correct).toHaveBeenCalledTimes(1)
  expect(wrong).not.toHaveBeenCalled()
})

it('distinguishes a free option from the plain configuration without relying on price or row order', async () => {
  const { controls } = setup()
  history.replaceState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
  document.body.innerHTML = '<main class="order-create"><div class="produce-item"><h3>每日新品 <span>($10)</span></h3><div class="product-attr"><div><div class="ml-4"><span></span><span>白飯 <!----></span></div></div><div class="ml-4"></div></div><input type="number" value="1"><button class="is-circle">刪除</button></div><div class="produce-item"><h3>每日新品 <span>($10)</span></h3><div class="product-attr"><div><div class="ml-4"><span></span></div></div><div class="ml-4"></div></div><input type="number" value="1"><button class="is-circle">刪除</button></div></main>'
  const correct = vi.fn()
  const wrong = vi.fn()
  const rows = document.querySelectorAll('.produce-item')
  rows[0].querySelector('button')!.addEventListener('click', wrong)
  rows[1].querySelector('button')!.addEventListener('click', correct)
  const base = { name: '每日新品', productRef: 'daily', quantity: 1, unitPrice: 10, note: '' }
  await controls.edit([{ ...base, ref: 'rice', configuration: 'rice', options: [{ name: '白飯', quantity: 1 }] }, { ...base, ref: 'plain', configuration: 'plain', options: [] }], 'plain', undefined, async () => {}, async () => correct.mock.calls.length === 1)
  expect(correct).toHaveBeenCalledTimes(1)
  expect(wrong).not.toHaveBeenCalled()
})

it('refuses an indistinguishable peer from the full cart even when only one DOM row is currently rendered', async () => {
  const { controls } = setup()
  history.replaceState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
  document.body.innerHTML = '<main class="order-create"><div class="produce-item"><h3>每日新品 <span>($10)</span></h3><input type="number" value="1"><button class="is-circle">刪除</button></div></main>'
  const clicked = vi.fn()
  document.querySelector('button')!.addEventListener('click', clicked)
  const lines = ['first', 'hidden-peer'].map(ref => ({ ref, name: '每日新品', productRef: 'daily', quantity: 1, unitPrice: 10, configuration: '', options: [] }))
  await expect(controls.edit(lines, 'first', undefined, async () => {}, async () => true)).rejects.toThrow()
  expect(clicked).not.toHaveBeenCalled()
})

// Report: this chat, Nov1 live PB. Removing the last line replaces the cart's
// continue link with an empty-state button; the verified removal must not replay.
it('returns from the empty cart through its actual order button once', async () => {
  const { controls, operation } = setup()
  history.replaceState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
  document.body.innerHTML = '<main class="order-create"><h2>購物車是空的</h2><button>立即點餐</button><button>我的點餐紀錄</button></main>'
  const clicked = vi.fn(() => {
    history.pushState({}, '', '/order/store/1kgJeql/pick_up/menu')
    document.body.innerHTML = '<input placeholder="搜尋品項，例如：拿鐵、雞腿、套餐">'
  })
  document.querySelector('button')!.addEventListener('click', clicked)
  await controls.navigate('/order/store/1kgJeql/pick_up/menu')
  expect(clicked).toHaveBeenCalledOnce()
  expect(location.pathname.endsWith('/menu')).toBe(true)
  expect(operation.snapshot().steps).toHaveLength(1)
  expect(operation.snapshot().steps[0]).toMatchObject({ action: 'navigate', state: 'completed' })
})

it('does not accept a merchant write when takeover occurs during its last asynchronous check', async () => {
  const { controls, operation, controller, configuration, selection } = setup()
  await controls.prepare('每日新品', 'daily-ref', configuration, selection, 1, '')
  const clicked = vi.fn()
  document.querySelector('.dialog-footer button')!.addEventListener('click', clicked)
  await expect(controls.add('每日新品', 'daily-ref', async () => controller.abort(), async () => true)).rejects.toThrow('接手')
  expect(clicked).not.toHaveBeenCalled()
  expect(operation.snapshot().steps.at(-1)).toMatchObject({ action: 'add', state: 'cancelled' })
  expect(operation.snapshot().steps.at(-1)?.dispatchMs).toBeUndefined()
})

it('refuses a replacement control created during its last asynchronous check', async () => {
  const { controls, operation, configuration, selection } = setup()
  await controls.prepare('每日新品', 'daily-ref', configuration, selection, 1, '')
  const clicked = vi.fn()
  await expect(controls.add('每日新品', 'daily-ref', async () => {
    const old = document.querySelector('.dialog-footer button')!
    const replacement = old.cloneNode(true)
    replacement.addEventListener('click', clicked)
    old.replaceWith(replacement)
  }, async () => true)).rejects.toThrow('無法加入')
  expect(clicked).not.toHaveBeenCalled()
  expect(operation.snapshot().steps.at(-1)?.dispatchMs).toBeUndefined()
})

it('explicitly selects the requested mandatory radio instead of inheriting PB’s first default', async () => {
  const { controls, configuration } = setup()
  await controls.open('每日新品')
  document.querySelector('.product-item')!.innerHTML = '<h4>口味</h4><label class="el-radio"><input type="radio" name="flavour" value="10" checked>原味</label><label class="el-radio"><input type="radio" name="flavour" value="11">辣味</label>'
  document.querySelector('.dialog-footer button')!.textContent = '選好了 共計$10'
  const mandatory = { ...configuration, groups: [{ ref: 'g-2', name: '口味', required: true, maximum: 1, choices: [{ ref: 'a-10', name: '原味', maximum: 1, unitPrice: 0 }, { ref: 'a-11', name: '辣味', maximum: 1, unitPrice: 0 }] }] }
  await controls.prepare('每日新品', 'daily-ref', mandatory, { version: 'today', variantRef: '', choices: [{ ref: 'a-11', quantity: 1 }] }, 1, '')
  expect(document.querySelector<HTMLInputElement>('input[value="11"]')!.checked).toBe(true)
  expect(document.querySelector<HTMLInputElement>('input[value="10"]')!.checked).toBe(false)
})
