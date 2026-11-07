import { afterEach, expect, it, vi } from 'vitest'

import { createOperation } from './pbOperation'
import { createPresentation } from './pbPresentation'

const cleanup: Array<() => void> = []
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose())
  document.body.replaceChildren()
})
function setup() {
  const target = document.createElement('button')
  target.textContent = '實際控制項'
  document.body.append(target)
  const controller = new AbortController()
  const cursor = createPresentation()
  cleanup.push(cursor.cancel)
  const operation = createOperation({ documentId: 'document', operationId: 'operation', signal: controller.signal, follow: async (element, label, dispatch, prepare) => (await cursor.show([], element, true, [], { label, dispatch, prepare })).cue === 'shown' })
  return { target, controller, operation }
}

it('executes the real control once at the pointer target and records dispatch/verification', async () => {
  const { target, operation } = setup()
  const clicked = vi.fn()
  target.addEventListener('click', clicked)
  const verify = vi.fn(async () => {
    expect(clicked).toHaveBeenCalledOnce()
  })
  await operation.run('open-product', '開啟商品', 'draft', () => target, async () => target.click(), verify)
  expect(clicked).toHaveBeenCalledOnce()
  expect(verify).toHaveBeenCalledOnce()
  expect(operation.snapshot()).toMatchObject({ documentId: 'document', operationId: 'operation', steps: [{ action: 'open-product', state: 'completed' }] })
  const step = operation.snapshot().steps[0]
  expect(step.dispatchMs).toBeGreaterThanOrEqual(step.startedMs)
  expect(step.finishedMs).toBeGreaterThanOrEqual(step.dispatchMs!)
})

// Report: this chat, Nov1: the hand rushed across the screen in <=250ms.
it('makes a cross-screen approach readable before dispatching once', async () => {
  const { target, operation } = setup()
  target.style.cssText = 'position:fixed;right:20px;bottom:20px;width:160px;height:80px'
  const clicked = vi.fn()
  target.addEventListener('click', clicked)
  await operation.run('open-product', '開啟商品', 'draft', () => target, async () => target.click(), async () => {})
  expect(clicked).toHaveBeenCalledOnce()
  const step = operation.snapshot().steps[0]
  expect(step.dispatchMs! - step.startedMs).toBeGreaterThanOrEqual(650)
})

it('releases the visible press while an accepted effect is still being verified', async () => {
  const { target, operation } = setup()
  let finishVerification = () => {}
  const verified = new Promise<void>(resolve => finishVerification = resolve)
  const clicked = vi.fn()
  const pending = operation.run('add', '加入餐點', 'cart', () => target, async () => clicked(), async () => verified)
  await vi.waitFor(() => expect(clicked).toHaveBeenCalledOnce(), { timeout: 2500 })
  expect(document.querySelector<HTMLElement>('[data-webnavior-presentation]')?.dataset.phase).toBe('pressing')
  await vi.waitFor(() => expect(document.querySelector<HTMLElement>('[data-webnavior-presentation]')?.dataset.phase).toBe('waiting'))
  expect(operation.snapshot().steps[0].state).toBe('verifying')
  finishVerification()
  await pending
  expect(clicked).toHaveBeenCalledOnce()
})

it('does not dispatch after a customer takes over during movement', async () => {
  const { target, controller, operation } = setup()
  const dispatch = vi.fn(async () => {})
  const pending = operation.run('note', '備註', 'draft', () => target, dispatch, async () => {})
  controller.abort()
  await expect(pending).rejects.toThrow('接手')
  expect(dispatch).not.toHaveBeenCalled()
  expect(operation.snapshot().steps[0].state).toBe('cancelled')
})

it('settles accepted commerce verification even when cancellation follows dispatch', async () => {
  const { target, controller, operation } = setup()
  const verify = vi.fn(async () => {})
  await operation.run('add', '加入購物車', 'cart', () => target, async () => {
    controller.abort()
    return 15
  }, verify)
  expect(verify).toHaveBeenCalledWith(15)
  expect(operation.snapshot().steps[0].state).toBe('completed')
})

it('refuses a replaced control before dispatch and classifies a lost commerce result as unknown', async () => {
  const { target, operation } = setup()
  const replacement = document.createElement('button')
  document.body.append(replacement)
  let current = target
  const dispatch = vi.fn(async () => {})
  const pending = operation.run('remove', '移除餐點', 'cart', () => current, dispatch, async () => {})
  current = replacement
  await expect(pending).rejects.toThrow('已變更')
  expect(dispatch).not.toHaveBeenCalled()
  await expect(operation.run('remove', '移除餐點', 'cart', () => replacement, async () => {
    throw new Error('lost receipt')
  }, async () => {})).rejects.toThrow('lost receipt')
  expect(operation.snapshot().steps[1].state).toBe('unknown')
})

it('does not click a real control hidden beneath a different overlay', async () => {
  const { target, operation } = setup()
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:white'
  document.body.append(overlay)
  const dispatch = vi.fn(async () => {})
  await expect(operation.run('add', '加入餐點', 'cart', () => target, dispatch, async () => {})).rejects.toThrow('遮住')
  expect(dispatch).not.toHaveBeenCalled()
  expect(operation.snapshot().steps[0].dispatchMs).toBeUndefined()
})

it('scrolls a viewport-visible control away from a sticky header before dispatch', async () => {
  const { target, operation } = setup()
  document.body.style.minHeight = '3000px'
  target.style.cssText = 'display:block;margin-top:600px;height:100px;width:200px'
  const header = document.createElement('header')
  header.style.cssText = 'position:fixed;top:0;left:0;right:0;height:140px;background:white;z-index:1000'
  document.body.append(header)
  window.scrollTo({ top: 590, behavior: 'instant' })
  const clicked = vi.fn()
  target.addEventListener('click', clicked)
  try {
    expect(target.getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
    await operation.run('navigate', '返回菜單', 'navigation', () => target, async () => target.click(), async () => {})
    expect(clicked).toHaveBeenCalledOnce()
  }
  finally {
    document.body.style.minHeight = ''
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
})

it('waits for a real loading mask to disappear instead of failing or forcing a click', async () => {
  const { target, controller } = setup()
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:white'
  document.body.append(overlay)
  let reached = false
  const operation = createOperation({ documentId: 'doc', operationId: 'loading', signal: controller.signal, follow: async (_target, _label, dispatch) => {
    const pending = dispatch()
    reached = true
    await pending
    return true
  } })
  const clicked = vi.fn()
  target.addEventListener('click', clicked)
  const pending = operation.run('navigate', '返回菜單', 'navigation', () => target, async () => target.click(), async () => {})
  await vi.waitFor(() => expect(reached).toBe(true))
  expect(clicked).not.toHaveBeenCalled()
  overlay.remove()
  await pending
  expect(clicked).toHaveBeenCalledOnce()
})
