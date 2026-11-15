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

// Report: this chat, Nov11; reception reset should be masked instead of slowly guided.
it('keeps a loading cover across merchant navigation until the maintenance work settles', async () => {
  const { presentation, target } = setup()
  let finish = () => {}
  const work = new Promise<void>(resolve => finish = resolve)
  const pending = presentation.cover(async () => work)
  const cover = document.querySelector<HTMLElement>('[data-webnavior-maintenance]')!
  expect(cover).not.toBeNull()
  expect(presentation.isCovered()).toBe(true)
  expect(getComputedStyle(cover).backgroundColor).toBe('rgb(248, 250, 252)')
  const rect = target.getBoundingClientRect()
  expect(document.elementFromPoint(rect.left + 20, rect.top + 20)).toBe(target)
  document.dispatchEvent(new Event('inertia:start'))
  expect(cover.isConnected).toBe(true)
  finish()
  await pending
  expect(presentation.isCovered()).toBe(false)
  expect(document.querySelector('[data-webnavior-maintenance]')).toBeNull()
})

it('removes the maintenance cover after a failed reset without hiding its error', async () => {
  const { presentation } = setup()
  await expect(presentation.cover(async () => {
    throw new Error('clear result unknown')
  })).rejects.toThrow('clear result unknown')
  expect(presentation.isCovered()).toBe(false)
  expect(document.querySelector('[data-webnavior-maintenance]')).toBeNull()
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
