import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import { useDineInSeating } from '../../../order-menu/src/composables/useDineInSeating'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('seating background synchronization', () => {
  it('does not query seats before choosing dine-in or after switching to pickup', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const fetchSeat = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ seating: { revision: 1, tables: [] } })))
    const enabled = shallowRef(false)
    let seating!: ReturnType<typeof useDineInSeating>
    const screen = render(defineComponent({
      setup() {
        seating = useDineInSeating('http://localhost:5167', () => enabled.value)
        return () => h('p', '菜單')
      },
    }))
    await nextTick()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchSeat).not.toHaveBeenCalled()
    enabled.value = true
    await nextTick()
    expect(fetchSeat).toHaveBeenCalledTimes(1)
    const enabledAt = Date.now()
    await expect.poll(() => seating.busy.value).toBe(false)
    // NOTICE: Browser polling assertions can advance fake time while native Response
    // parsing finishes; measure that time instead of moving the boundary.
    await vi.advanceTimersByTimeAsync(29_999 - (Date.now() - enabledAt))
    expect(fetchSeat).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchSeat).toHaveBeenCalledTimes(2)
    enabled.value = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchSeat).toHaveBeenCalledTimes(2)
    await seating.refresh()
    expect(fetchSeat).toHaveBeenCalledTimes(3)
    screen.unmount()
    enabled.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchSeat).toHaveBeenCalledTimes(3)
  })

  it('does not query POS when resetting a round that never held seats', async () => {
    const fetchSeat = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ seating: { revision: 1, tables: [] } })))
    let seating!: ReturnType<typeof useDineInSeating>
    render(defineComponent({
      setup() {
        seating = useDineInSeating('http://localhost:5167', () => false)
        return () => h('p', '自取')
      },
    }))
    await seating.reset()
    expect(fetchSeat).not.toHaveBeenCalled()
    expect(seating.context().ready).toBe(false)
  })
})
