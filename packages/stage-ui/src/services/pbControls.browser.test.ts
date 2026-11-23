import { afterEach, expect, it, vi } from 'vitest'

import { createControls } from './pbControls'
import { createOperation } from './pbOperation'

// Report: this chat, Nov14; manual PB additions can create identical rows.
it('edits indistinguishable rows only as an explicitly admitted equivalent group', async () => {
  history.replaceState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
  document.body.innerHTML = `<main class="order-create">${['a', 'b'].map(id => `<div class="produce-item" data-row="${id}"><h3>水餃 <span>$80</span></h3><div class="product-attr"><div><div class="ml-4"><span>水餃X2</span></div></div><div class="ml-4"></div></div><input type="number" value="1"><button class="is-circle">刪除</button></div>`).join('')}</main>`
  for (const input of Array.from(document.querySelectorAll('input'))) {
    input.addEventListener('change', () => {
      if (input.value === '0')
        input.closest('.produce-item')!.remove()
    })
  }
  const lines = ['a', 'b'].map(ref => ({ ref, productRef: 'dumplings', name: '水餃', quantity: 1, unitPrice: 80, configuration: 'extra-two', options: [{ name: '水餃', quantity: 2 }], note: '' }))
  const controller = new AbortController()
  const operation = createOperation({ documentId: 'equivalent', operationId: 'remove', signal: controller.signal, follow: async (_target, _label, dispatch) => {
    await dispatch()
    return true
  } })
  const controls = createControls(operation, controller.signal)
  expect(controls.canEdit(lines, ['a'])).toBe(false)
  expect(controls.canEdit(lines, ['a', 'b'])).toBe(true)
  expect(controls.canEdit([lines[0], { ...lines[1], configuration: 'another' }], ['a', 'b'])).toBe(false)
  await controls.edit(lines, 'b', undefined, async () => {}, async () => document.querySelectorAll('.produce-item').length === 1, () => {}, ['a', 'b'])
  expect(document.querySelectorAll('.produce-item').length).toBe(1)
})

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
    for (const input of Array.from(document.querySelectorAll('input[type=number]'))) {
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

// Report: this chat, Nov12; cart 加點 navigates, while 新增/＋ changes servings.
it('uses the guest journey 加點 link without pressing quantity controls or clearing search', async () => {
  history.replaceState({}, '', '/order/store/1kAMNok/internal_use/orders/create')
  document.body.innerHTML = '<main class="order-create"><button id="plus">新增</button><a href="/order/store/1kAMNok/internal_use/menu">加點</a></main>'
  const plus = vi.fn()
  document.querySelector('#plus')!.addEventListener('click', plus)
  document.querySelector('a')!.addEventListener('click', (event) => {
    event.preventDefault()
    history.pushState({}, '', '/order/store/1kAMNok/internal_use/menu')
    document.body.innerHTML = '<input placeholder="搜尋品項，例如：拿鐵、雞腿、套餐" value="雞腿">'
  })
  const controller = new AbortController()
  const operation = createOperation({ documentId: 'guest', operationId: 'return', signal: controller.signal, follow: async (_target, _label, dispatch) => {
    await dispatch()
    return true
  } })
  const controls = createControls(operation, controller.signal)
  await controls.navigate('/order/store/1kAMNok/internal_use/menu')
  expect(plus).not.toHaveBeenCalled()
  expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('雞腿')
  expect(operation.snapshot().steps).toMatchObject([{ action: 'navigate', effect: 'navigation', state: 'completed' }])
  await expect(controls.navigate('/order/store/other/internal_use/menu')).rejects.toThrow('approved journey')
})

// Report: this chat, Nov15; the first clear after cold PB entry can precede its rendered controls.
it('waits for the checkout link and cart clear button to render before one verified clear', async () => {
  const { controls, operation } = setup()
  const opened = vi.fn()
  const cleared = vi.fn()
  const accepted = vi.fn()
  let clearTimer: ReturnType<typeof setTimeout> | undefined
  const linkTimer = setTimeout(() => {
    const link = document.createElement('button')
    link.textContent = '$50 去結算'
    link.addEventListener('click', () => {
      opened()
      history.pushState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
      document.body.innerHTML = '<main class="order-create"><div class="produce-item">魚丸湯</div></main>'
      clearTimer = setTimeout(() => {
        const clear = document.createElement('button')
        clear.textContent = '清空'
        clear.addEventListener('click', () => {
          cleared()
          document.querySelector('.produce-item')!.remove()
        })
        document.querySelector('.order-create')!.append(clear)
      }, 80)
    })
    document.body.append(link)
  }, 80)
  try {
    await controls.clearCart(async () => {}, async () => !document.querySelector('.produce-item'), accepted)
  }
  finally {
    clearTimeout(linkTimer)
    clearTimeout(clearTimer)
  }
  expect(opened).toHaveBeenCalledOnce()
  expect(cleared).toHaveBeenCalledOnce()
  expect(accepted).toHaveBeenCalledOnce()
  expect(operation.snapshot().steps.map(step => step.state)).toEqual(['completed', 'completed'])
})

// Report: this chat, Nov11; PB cart's native 清空 must be used at reception end.
it.each([false, true])('clears only the native cart button after fresh preflight (changed=%s)', async (changed) => {
  const { controls, operation } = setup()
  history.replaceState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
  document.body.innerHTML = '<button id="unrelated">清空</button><main class="order-create"><button id="clear-cart">清空</button><div class="produce-item">原餐</div></main>'
  const unrelated = vi.fn()
  document.querySelector('#unrelated')!.addEventListener('click', unrelated)
  const cleared = vi.fn(() => document.querySelector('.produce-item')!.remove())
  document.querySelector('#clear-cart')!.addEventListener('click', cleared)
  const accepted = vi.fn()
  const run = controls.clearCart(async () => {
    if (changed)
      throw new Error('cart changed')
  }, async () => !document.querySelector('.produce-item'), accepted)
  if (changed) {
    await expect(run).rejects.toThrow('cart changed')
    expect(cleared).not.toHaveBeenCalled()
    expect(accepted).not.toHaveBeenCalled()
  }
  else {
    await run
    expect(cleared).toHaveBeenCalledOnce()
    expect(accepted).toHaveBeenCalledOnce()
    expect(operation.snapshot().steps[0]).toMatchObject({ effect: 'cart', state: 'completed', target: { ref: 'cart-clear' } })
  }
  expect(unrelated).not.toHaveBeenCalled()
})

// Report: this chat, Nov11; a new query could read the previous filter's cards.
it.each([0, 80])('waits for PB search debounce, loading and its rendered result count (load=%s ms)', async (loadMs) => {
  const { controls, operation } = setup()
  document.body.insertAdjacentHTML('afterbegin', '<input placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"><div class="menu-search-meta">共找到 1 項</div>')
  document.querySelector('input')!.addEventListener('input', () => {
    setTimeout(() => {
      document.querySelector('.menu-search-meta')!.textContent = '搜尋中...'
      setTimeout(() => {
        document.querySelector('main')!.innerHTML = '<button><h4>雞腿便當</h4></button><button><h4>烤雞腿便當</h4></button>'
        document.querySelector('.menu-search-meta')!.textContent = '共找到 2 項'
      }, loadMs)
    }, 250)
  })
  await controls.search('雞腿')
  expect(Array.from(document.querySelectorAll('main h4')).map(heading => heading.textContent)).toEqual(['雞腿便當', '烤雞腿便當'])
  expect(operation.snapshot().steps[0]?.state).toBe('completed')
})

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
// Report: this chat, Nov19 03:04 — real Electron + production PB reset fails
// because the coupon dialog covers the announcement's acknowledgement button.
it('defers the observed coupon before dismissing a covered store announcement', async () => {
  const { controls, operation } = setup()
  document.body.insertAdjacentHTML('beforeend', '<div id="announcement" role="dialog" style="position:fixed;inset:0;z-index:100;background:white"><button>我知道了，開始點餐</button></div><div id="coupon" role="dialog" style="position:fixed;inset:0;z-index:101;background:white"><button>稍後再領</button><button>立即領取</button><label><input type="checkbox">不再顯示此優惠</label></div>')
  const clicked: string[] = []
  document.querySelector('#announcement button')!.addEventListener('click', () => {
    clicked.push('announcement')
    document.querySelector('#announcement')!.remove()
  })
  document.querySelector('#coupon button')!.addEventListener('click', () => {
    clicked.push('later')
    document.querySelector('#coupon')!.remove()
  })
  const claim = vi.fn()
  const preference = vi.fn()
  document.querySelectorAll('#coupon button')[1]!.addEventListener('click', claim)
  document.querySelector('#coupon input')!.addEventListener('change', preference)
  await controls.navigate(location.pathname)
  expect(clicked).toEqual(['later', 'announcement'])
  expect(claim).not.toHaveBeenCalled()
  expect(preference).not.toHaveBeenCalled()
  expect(operation.snapshot().steps.map(step => step.effect)).toEqual(['draft', 'draft'])
})

it.each([false, true])('visits the native cart and returns whether the optional store announcement exists (notice=%s)', async (announcement) => {
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
  if (announcement) {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:white'
    overlay.innerHTML = '<button>我知道了，開始點餐</button>'
    overlay.querySelector('button')!.addEventListener('click', () => overlay.remove())
    document.body.append(overlay)
  }
  await controls.edit([{ ref: 'line', name: '每日新品', quantity: 1, unitPrice: 10, productRef: 'daily', configuration: '' }], 'line', 2, async () => {}, async () => amount === 2)
  expect(amount).toBe(2)
  await controls.navigate('/order/store/1kgJeql/pick_up/menu')
  expect(location.pathname.endsWith('/menu')).toBe(true)
  expect(operation.snapshot().steps.map(step => step.action)).toEqual(announcement ? ['notice', 'navigate', 'quantity', 'navigate'] : ['navigate', 'quantity', 'navigate'])
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, S04/S09/S12.
it('selects the visible configuration by its observed price when product name and quantity are the same', async () => {
  const { controls } = setup()
  history.replaceState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
  document.body.innerHTML = '<main class="order-create"><div class="produce-item"><h3>每日新品 <span>($10)</span></h3><input type="number" value="1"><button class="is-circle">刪除</button></div><div class="produce-item"><h3>每日新品 <span>($15)</span></h3><p>白飯 ×1</p><input type="number" value="1"><button class="is-circle">刪除</button></div></main>'
  const removed = vi.fn()
  const rows = document.querySelectorAll('.produce-item')
  rows[1].querySelector('input')!.addEventListener('change', removed)
  const wrongRow = vi.fn()
  rows[0].querySelector('input')!.addEventListener('change', wrongRow)
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
  rows[0].querySelector('input')!.addEventListener('change', wrong)
  rows[1].querySelector('input')!.addEventListener('change', correct)
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
  rows[0].querySelector('input')!.addEventListener('change', wrong)
  rows[1].querySelector('input')!.addEventListener('change', correct)
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

// Report: this chat, Nov15 actual PB checkout has both Edit and Delete circles.
it('removes the exact cart row through its supported zero quantity without confusing circular controls', async () => {
  const { controls } = setup()
  history.replaceState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
  document.body.innerHTML = '<main class="order-create"><div class="produce-item"><h3>魚丸湯 <span>$50</span></h3><input type="number" min="0" value="2"><button class="is-circle">編輯</button><button class="is-circle">刪除</button></div></main>'
  const clicked = vi.fn()
  const changed = vi.fn()
  document.querySelectorAll('button').forEach(button => button.addEventListener('click', clicked))
  document.querySelector('input')!.addEventListener('change', (event) => {
    changed((event.target as HTMLInputElement).value)
    if ((event.target as HTMLInputElement).value === '0')
      document.querySelector('.produce-item')!.remove()
  })
  await controls.edit([{ ref: 'fish', productRef: 'p-2595', name: '魚丸湯', quantity: 2, unitPrice: 50, configuration: '', options: [] }], 'fish', undefined, async () => {}, async () => !document.querySelector('.produce-item'))
  expect(changed).toHaveBeenCalledWith('0')
  expect(clicked).not.toHaveBeenCalled()
  expect(document.querySelector('.produce-item')).toBeNull()
})

// Report: this chat, Nov15; quantity operations should point at and click native +/− controls.
it('clicks the scoped native buttons for options and servings, waiting for each asynchronous update', async () => {
  const { controls, configuration, selection, operation } = setup()
  await controls.open('每日新品')
  const clicks: string[] = []
  const released = vi.fn()
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input[type=number]'))) {
    const wrapper = document.createElement('div')
    wrapper.className = 'el-input-number'
    input.before(wrapper)
    wrapper.append(input)
    for (const [name, delta] of [['decrease', -1], ['increase', 1]] as const) {
      const button = document.createElement('span')
      button.className = `el-input-number__${name}`
      button.setAttribute('role', 'button')
      button.textContent = delta > 0 ? '+' : '−'
      wrapper.append(button)
      // Element Plus v-repeat-click starts on mousedown, not click:
      // https://github.com/element-plus/element-plus/blob/dev/packages/directives/repeat-click/index.ts
      button.addEventListener('mousedown', () => {
        document.addEventListener('mouseup', released, { once: true })
        clicks.push(`${input.closest('.product-item') ? 'option' : 'servings'}:${delta}`)
        setTimeout(() => {
          input.value = String(Number(input.value) + delta)
          input.dispatchEvent(new Event('change', { bubbles: true }))
        }, 30)
      })
    }
  }
  await controls.prepare('每日新品', 'daily-ref', configuration, { ...selection, choices: [{ ref: 'a-1', quantity: 2 }] }, 3, '')
  await controls.prepare('每日新品', 'daily-ref', configuration, selection, 1, '')
  expect(clicks).toEqual(['option:1', 'option:1', 'servings:1', 'servings:1', 'option:-1', 'servings:-1', 'servings:-1'])
  expect(document.querySelector<HTMLInputElement>('.dialog-footer input')!.value).toBe('1')
  expect(operation.snapshot().steps.filter(step => step.action === 'quantity')).toHaveLength(4)
  expect(released).toHaveBeenCalledTimes(clicks.length)
})

// Report: this chat, Nov18 — checkout was attempted behind an open product dialog.
it('closes the product dialog before navigating to the cart', async () => {
  const { controls, operation } = setup()
  await controls.open('每日新品')
  const link = document.createElement('button')
  link.textContent = '去結算'
  document.querySelector('main')!.append(link)
  link.addEventListener('click', () => {
    if (document.querySelector('[role="dialog"]'))
      return
    history.pushState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
    document.body.innerHTML = '<main class="order-create"></main>'
  })
  await controls.navigate('/order/store/1kgJeql/pick_up/orders/create')
  expect(location.pathname).toBe('/order/store/1kgJeql/pick_up/orders/create')
  expect(operation.snapshot().steps.map(step => step.action)).toEqual(['open-product', 'close-product', 'navigate'])
})

it.each(['click', 'mousedown'] as const)('uses %s cart quantity buttons through replaced rows with one preflight and final verification', async (event) => {
  history.replaceState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
  const clicks: number[] = []
  const render = (quantity: number) => {
    document.body.innerHTML = `<main class="order-create"><div class="produce-item"><h3>水餃 <span>$64</span></h3><div class="line-actions"><button aria-label="減少水餃份數">−</button><input type="number" min="0" value="${quantity}"><button aria-label="增加水餃份數">+</button></div></div></main>`
    for (const [index, delta] of [[0, -1], [1, 1]]) {
      document.querySelectorAll('button')[index].addEventListener(event, () => {
        clicks.push(delta)
        const input = document.querySelector('input')!
        input.value = String(quantity + delta)
        input.disabled = true
        setTimeout(render, 30, quantity + delta)
      })
    }
  }
  render(1)
  const controller = new AbortController()
  const operation = createOperation({ documentId: 'cart', operationId: 'steps', signal: controller.signal, follow: async (target, _label, dispatch) => {
    expect(target.tagName).toBe('BUTTON')
    await dispatch()
    return true
  } })
  const controls = createControls(operation, controller.signal)
  const preflight = vi.fn(async () => {})
  const dispatched = vi.fn()
  const line = { ref: 'one', productRef: 'dumplings', name: '水餃', quantity: 1, unitPrice: 64, configuration: 'plain' }
  await controls.edit([line], line.ref, 3, preflight, async () => document.querySelector<HTMLInputElement>('input')?.value === '3', dispatched)
  await controls.edit([{ ...line, quantity: 3 }], line.ref, 1, preflight, async () => document.querySelector<HTMLInputElement>('input')?.value === '1', dispatched)
  expect(clicks).toEqual([1, 1, -1, -1])
  expect(preflight).toHaveBeenCalledTimes(2)
  expect(dispatched).toHaveBeenCalledTimes(2)
  expect(operation.snapshot().steps.every(step => step.state === 'completed')).toBe(true)
})

// Report: this chat, Nov15; native quantity buttons must not bypass takeover or disabled controls.
it.each([false, true])('stops cart clicks after takeover and does not bypass a disabled stepper (disabled=%s)', async (disabled) => {
  history.replaceState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
  document.body.innerHTML = `<main class="order-create"><div class="produce-item"><h3>水餃 <span>$64</span></h3><div class="el-input-number"><span role="button" class="el-input-number__increase ${disabled ? 'is-disabled' : ''}">+</span><input type="number" min="0" value="1"></div></div></main>`
  const controller = new AbortController()
  const clicked = vi.fn(() => {
    controller.abort()
    setTimeout(() => document.querySelector<HTMLInputElement>('input')!.value = '2', 30)
  })
  document.querySelector('span[role=button]')!.addEventListener('click', clicked)
  const operation = createOperation({ documentId: 'cart', operationId: 'takeover', signal: controller.signal, follow: async (_target, _label, dispatch) => {
    await dispatch()
    return true
  } })
  const controls = createControls(operation, controller.signal)
  const dispatched = vi.fn()
  const verify = vi.fn(async () => true)
  await expect(controls.edit([{ ref: 'one', productRef: 'dumplings', name: '水餃', quantity: 1, unitPrice: 64, configuration: 'plain' }], 'one', 3, async () => {}, verify, dispatched)).rejects.toThrow()
  expect(clicked).toHaveBeenCalledTimes(disabled ? 0 : 1)
  expect(dispatched).toHaveBeenCalledTimes(disabled ? 0 : 1)
  expect(verify).not.toHaveBeenCalled()
  expect(document.querySelector<HTMLInputElement>('input')!.value).toBe(disabled ? '1' : '2')
})

it('keeps the original live cart row while its delayed count passes an identical peer count', async () => {
  history.replaceState({}, '', '/order/store/1kgJeql/pick_up/orders/create')
  document.body.innerHTML = `<main class="order-create">${[1, 2].map((quantity, index) => `<div class="produce-item" data-row="${index}"><h3>水餃 <span>$64</span></h3><div class="product-attr"><div><div class="ml-4"></div></div><div class="ml-4"></div></div><div class="el-input-number"><span role="button" class="el-input-number__increase">+</span><input type="number" min="0" value="${quantity}"></div></div>`).join('')}</main>`
  const clicks: string[] = []
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('.produce-item'))) {
    row.querySelector('span[role=button]')!.addEventListener('click', () => {
      clicks.push(row.dataset.row!)
      setTimeout(() => {
        const input = row.querySelector('input')!
        input.value = String(Number(input.value) + 1)
      }, 60)
    })
  }
  const controller = new AbortController()
  const operation = createOperation({ documentId: 'peers', operationId: 'steps', signal: controller.signal, follow: async (_target, _label, dispatch) => {
    await dispatch()
    return true
  } })
  const controls = createControls(operation, controller.signal)
  const lines = [1, 2].map((quantity, index) => ({ ref: String(index), productRef: 'dumplings', name: '水餃', quantity, unitPrice: 64, configuration: 'plain', options: [], note: '' }))
  await controls.edit(lines, '0', 3, async () => {}, async () => document.querySelector<HTMLInputElement>('input')?.value === '3')
  expect(clicks).toEqual(['0', '0'])
  expect(Array.from(document.querySelectorAll('input')).map(input => input.value)).toEqual(['3', '2'])
})

// Report: this chat, Nov19 — actual PB add completed while its product dialog was still leaving.
it('continues when PB naturally finishes closing the product dialog before the close gesture arrives', async () => {
  history.replaceState({}, '', '/order/store/1kgJeql/internal_use/menu')
  document.body.innerHTML = '<div role="dialog"><div class="menu-dialog"><h1>魚丸湯</h1><button class="el-dialog__headerbtn">關閉</button></div></div>'
  const clicked = vi.fn()
  document.querySelector('button')!.addEventListener('click', clicked)
  const controller = new AbortController()
  const operation = createOperation({ documentId: 'closing', operationId: 'cart-review', signal: controller.signal, follow: async (_target, _label, dispatch) => {
    document.querySelector('[role=dialog]')!.remove()
    await dispatch()
    return true
  } })
  const controls = createControls(operation, controller.signal)
  await expect(controls.close()).resolves.toBeUndefined()
  expect(clicked).not.toHaveBeenCalled()
  expect(document.querySelector('[role=dialog]')).toBeNull()
})

// Report: this chat, 2026-11-20; live PB .business-dialog now says 我知道了.
it('dismisses PB November announcement with its current short acknowledgement without accepting another dialog', async () => {
  const { controls, operation } = setup()
  document.body.insertAdjacentHTML('beforeend', '<div id="announcement" role="dialog" style="position:fixed;inset:0;z-index:100;background:white"><div class="business-dialog"><h2>📢 線上點餐公告</h2><button>我知道了</button></div></div><div id="coupon" role="dialog" style="position:fixed;inset:0;z-index:101;background:white"><button>稍後再領</button><button>立即領取</button><label><input type="checkbox">不再顯示此優惠</label></div>')
  const clicked: string[] = []
  document.querySelector('#announcement button')!.addEventListener('click', () => {
    clicked.push('announcement')
    document.querySelector('#announcement')!.remove()
  })
  document.querySelector('#coupon button')!.addEventListener('click', () => {
    clicked.push('later')
    document.querySelector('#coupon')!.remove()
  })
  const claim = vi.fn()
  const preference = vi.fn()
  document.querySelectorAll('#coupon button')[1]!.addEventListener('click', claim)
  document.querySelector('#coupon input')!.addEventListener('change', preference)
  document.body.insertAdjacentHTML('beforeend', '<div id="unrelated" role="dialog" style="position:fixed;inset:0;z-index:99;background:white"><h2>付款提醒</h2><button>我知道了</button></div>')
  const unrelated = vi.fn()
  document.querySelector('#unrelated button')!.addEventListener('click', unrelated)
  await controls.navigate(location.pathname)
  expect(clicked).toEqual(['later', 'announcement'])
  expect(unrelated).not.toHaveBeenCalled()
  expect(document.querySelector('#unrelated')).not.toBeNull()
  expect(claim).not.toHaveBeenCalled()
  expect(preference).not.toHaveBeenCalled()
  expect(operation.snapshot().steps.map(step => step.effect)).toEqual(['draft', 'draft'])
})
