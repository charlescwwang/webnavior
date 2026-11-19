import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { createPresentation } from './pbPresentation'

const presentations: ReturnType<typeof createPresentation>[] = []
afterEach(() => {
  presentations.forEach(presentation => presentation.cancel())
  document.body.replaceChildren()
})
function setup() {
  const presentation = createPresentation()
  presentations.push(presentation)
  const target = document.createElement('button')
  target.style.cssText = 'display:block;width:250px;height:100px;margin:20px'
  target.textContent = '每日新餐'
  document.body.append(target)
  return { presentation, target }
}

// Report: this chat, Nov19 — an already visible menu batch must remain manually usable.
it('allows customer clicks to take over a passive batch without an introduction lock', async () => {
  const { presentation, target } = setup()
  const second = document.createElement('button')
  second.textContent = '每日湯品'
  document.body.append(second)
  let clicks = 0
  second.addEventListener('click', () => clicks++)
  const products = [{ ref: 'meal', name: '每日新餐', price: 100 }, { ref: 'soup', name: '每日湯品', price: 40 }]
  expect(await presentation.show(products, target, false, [second])).toMatchObject({ cue: 'shown', products })
  await page.getByRole('button', { name: '每日湯品', exact: true }).click()
  expect(clicks).toBe(1)
  expect(document.querySelector('[data-webnavior-presentation]')).toBeNull()
})

// Report: this chat, Nov14; customer input cancelled introductions instead of being locked.
it('blocks real customer clicks throughout an introduction and releases after failure', async () => {
  const { presentation, target } = setup()
  let clicks = 0
  target.addEventListener('click', () => clicks++)
  const gate = Promise.withResolvers<void>()
  const pending = presentation.introduce(async () => gate.promise)
  try {
    await page.getByRole('button', { name: '每日新餐' }).click()
    expect(clicks).toBe(0)
    // Native scripted operations remain available; only customer input is locked.
    target.click()
    expect(clicks).toBe(1)
  }
  finally {
    gate.reject(new Error('presentation stopped'))
    await expect(pending).rejects.toThrow('presentation stopped')
  }
  await page.getByRole('button', { name: '每日新餐' }).click()
  expect(clicks).toBe(2)
})

it('does not let an old introduction cleanup unlock its replacement', async () => {
  const { presentation, target } = setup()
  let clicks = 0
  target.addEventListener('click', () => clicks++)
  const old = Promise.withResolvers<void>()
  const next = Promise.withResolvers<void>()
  const first = presentation.introduce(async () => old.promise)
  presentation.cancel()
  const second = presentation.introduce(async () => next.promise)
  try {
    old.resolve()
    await first
    await page.getByRole('button', { name: '每日新餐' }).click()
    expect(clicks).toBe(0)
  }
  finally {
    next.resolve()
    await second
  }
  await page.getByRole('button', { name: '每日新餐' }).click()
  expect(clicks).toBe(1)
})

// Report: this chat, Nov14 built Host; an offscreen meal was rejected before viewport movement finished.
it('does not mistake a stable offscreen rectangle for completed viewport movement', async () => {
  const { presentation, target } = setup()
  target.style.position = 'fixed'
  target.style.top = '150vh'
  const pending = presentation.show([{ ref: 'late-layout', name: '每日新餐' }], target)
  await expect.poll(() => document.querySelector<HTMLElement>('[data-webnavior-presentation]')?.dataset.phase).toBe('scrolling')
  // Use real DOM layout and time: the website settles its target after the
  // initial stationary interval, without replacing browser platform methods.
  await new Promise(resolve => setTimeout(resolve, 240))
  target.style.top = '100px'
  expect(await pending).toMatchObject({ cue: 'shown' })
})

describe('isolated PB visual cue', () => {
  // Report: this chat, Nov12; the item frame lingered after the native tap.
  it('retires the tap cue promptly while native verification is still pending', async () => {
    const { presentation, target } = setup()
    let finish = () => {}
    let clicked = false
    let settled = false
    const verification = new Promise<void>(resolve => finish = resolve)
    const pending = presentation.show([], target, true, [], {
      label: '開啟每日新餐',
      dispatch: async (onPress) => {
        onPress()
        target.click()
        clicked = true
        await verification
        settled = true
      },
    })
    try {
      await expect.poll(() => clicked).toBe(true)
      const overlay = document.querySelector<HTMLElement>('[data-webnavior-presentation]')!
      await expect.poll(() => getComputedStyle(overlay).display, { timeout: 600 }).toBe('none')
      expect(settled).toBe(false)
      // Retiring the visual must not cancel or replay the accepted operation.
      expect(overlay.dataset.phase).toBe('waiting')
    }
    finally {
      finish()
      expect(await pending).toMatchObject({ cue: 'shown' })
    }
    expect(settled).toBe(true)
  })

  it('moves to the real card and shows a press without ever clicking it', async () => {
    const { presentation, target } = setup()
    let clicks = 0
    target.addEventListener('click', () => clicks++)
    const result = await presentation.show([{ ref: 'p-today', name: '每日新餐', price: 85 }], target, true)
    expect(result.cue).toBe('shown')
    expect(clicks).toBe(0)
    const overlay = document.querySelector<HTMLElement>('[data-webnavior-presentation]')!
    expect(overlay).not.toBeNull()
    expect(getComputedStyle(overlay).display).not.toBe('none')
    expect(getComputedStyle(overlay).pointerEvents).toBe('none')
    const rect = target.getBoundingClientRect()
    expect(document.elementFromPoint(rect.left + 20, rect.top + 20)).toBe(target)
  })

  it('cancels old movement and cannot resurrect it after a new turn', async () => {
    const { presentation, target } = setup()
    const first = presentation.show([{ ref: 'p-yesterday', name: '昨日餐' }], target, true)
    presentation.cancel()
    expect(await first).toMatchObject({ cue: 'cancelled', products: [] })
    expect(document.querySelector('[data-webnavior-presentation]')).toBeNull()
    expect(await presentation.show([{ ref: 'p-today', name: '今日餐' }], target)).toMatchObject({ cue: 'shown' })
    expect(document.querySelectorAll('[data-webnavior-presentation]')).toHaveLength(1)
  })

  it('revokes a cue when Vue reuses a related card for a different product', async () => {
    const { presentation, target } = setup()
    const related = target.cloneNode(true) as HTMLButtonElement
    related.textContent = '同列其他商品'
    document.body.append(related)
    const pending = presentation.show([{ ref: 'p-today', name: '每日新餐' }, { ref: 'p-other', name: '同列其他商品' }], target, false, [related])
    related.textContent = '已換成不同商品'
    expect(await pending).toMatchObject({ cue: 'cancelled', products: [] })
    expect(document.querySelector('[data-webnavior-presentation]')).toBeNull()
  })

  it('does not invent coordinates for a missing or removed card', async () => {
    const { presentation, target } = setup()
    target.remove()
    expect(await presentation.show([{ ref: 'p-new', name: '未顯示商品' }], target)).toMatchObject({ cue: 'target-unavailable' })
    expect(document.querySelector('[data-webnavior-presentation]')).toBeNull()
  })

  it('measures an offscreen card after real scrolling and clears on navigation', async () => {
    const { presentation, target } = setup()
    document.body.style.minHeight = '3000px'
    target.style.marginTop = '1600px'
    expect(await presentation.show([{ ref: 'p-low', name: '下方餐點' }], target)).toMatchObject({ cue: 'shown' })
    expect(target.getBoundingClientRect().top).toBeLessThan(innerHeight)
    document.dispatchEvent(new Event('inertia:start'))
    expect(document.querySelector('[data-webnavior-presentation]')).toBeNull()
    document.body.style.minHeight = ''
    window.scrollTo(0, 0)
  })
})

it('keeps the hand visible during the actual scroll instead of appearing only after it settles', async () => {
  const { presentation, target } = setup()
  document.body.style.minHeight = '3000px'
  target.style.marginTop = '1600px'
  window.scrollTo({ top: 0, behavior: 'instant' })
  let handDuringScroll = false
  const observeScroll = () => {
    if (window.scrollY > 20)
      handDuringScroll ||= Boolean(document.querySelector('[data-webnavior-presentation]'))
  }
  window.addEventListener('scroll', observeScroll)
  try {
    expect(await presentation.show([{ ref: 'daily-below', name: '每日新餐' }], target)).toMatchObject({ cue: 'shown' })
    expect(handDuringScroll).toBe(true)
  }
  finally {
    window.removeEventListener('scroll', observeScroll)
    document.body.style.minHeight = ''
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
})

// Report: this chat, Nov15; the operation hand disappeared behind product modals.
it('places the cue in the top layer above a modal without intercepting its real controls', async () => {
  const { presentation, target } = setup()
  const modal = document.createElement('dialog')
  modal.append(target)
  document.body.append(modal)
  modal.showModal()
  try {
    expect(await presentation.show([], target, true, [], { label: '增加份數', dispatch: async (onPress) => {
      const overlay = document.querySelector<HTMLElement>('[data-webnavior-presentation]')!
      expect(getComputedStyle(overlay).display).not.toBe('none')
      expect(overlay.matches(':popover-open')).toBe(true)
      await page.screenshot({ path: '__screenshots__/pb-modal-hand.png' })
      onPress()
    } })).toMatchObject({ cue: 'shown' })
    const overlay = document.querySelector<HTMLElement>('[data-webnavior-presentation]')!
    // Chromium's open popover is above the previously opened modal top layer.
    expect(overlay.matches(':popover-open')).toBe(true)
    expect(getComputedStyle(overlay).pointerEvents).toBe('none')
    const bounds = target.getBoundingClientRect()
    expect(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)).toBe(target)
    presentation.cancel()
    expect(overlay.isConnected).toBe(false)
    expect(modal.open).toBe(true)
  }
  finally {
    modal.close()
  }
})

// Report: this chat, Nov19 screenshot — all cards were framed but only the first received the hand.
it('tours every visible highlighted dish without locking clicks or replacing the batch', async () => {
  const { presentation, target } = setup()
  const second = document.createElement('button')
  second.textContent = '每日湯品'
  second.style.cssText = 'display:block;width:250px;height:100px;margin:20px'
  document.body.append(second)
  const products = [{ ref: 'meal', name: '每日新餐', price: 100 }, { ref: 'soup', name: '每日湯品', price: 40 }]
  expect(await presentation.show(products, target, false, [second])).toMatchObject({ cue: 'shown', products })
  const batch = document.querySelector<HTMLElement>('[data-webnavior-presentation]')!
  await expect.poll(() => batch.dataset.pointedProductRef).toBe('meal')
  expect(JSON.parse(batch.dataset.productNames!)).toEqual(['每日新餐', '每日湯品'])
  await expect.poll(() => batch.dataset.pointedProductRef).toBe('soup')
  expect(document.querySelector('[data-webnavior-presentation]')).toBe(batch)
  await page.screenshot({ path: '__screenshots__/pb-passive-batch-tour.png' })
  await page.getByRole('button', { name: '每日湯品', exact: true }).click()
  expect(document.querySelector('[data-webnavior-presentation]')).toBeNull()
})
