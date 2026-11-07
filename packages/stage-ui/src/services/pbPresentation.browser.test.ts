import { afterEach, describe, expect, it } from 'vitest'

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

describe('isolated PB visual cue', () => {
  it('moves to the real card and shows a press without ever clicking it', async () => {
    const { presentation, target } = setup()
    let clicks = 0
    target.addEventListener('click', () => clicks++)
    const result = await presentation.show([{ ref: 'p-today', name: '每日新餐', price: 85 }], target, true)
    expect(result.cue).toBe('shown')
    expect(clicks).toBe(0)
    const overlay = document.querySelector<HTMLElement>('[data-webnavior-presentation]')!
    expect(overlay).not.toBeNull()
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
