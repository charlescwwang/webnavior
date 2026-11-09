import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'

import ScenarioSurface from './ScenarioSurface.vue'

import { useKioskCustomerSession } from '../composables/useKioskCustomerSession'
import { interactiveServiceClient } from '../services/interactiveServiceClient'
import { scenarioRegistry } from '../services/scenario-registry'

afterEach(() => {
  scenarioRegistry.setServices([])
  interactiveServiceClient.activate(undefined)
})

// Report: this chat Nov8 — verify the real iframe replacement through one visible restart click.
it('returns a fresh order to standby after one click and the replacement document load', async () => {
  scenarioRegistry.setServices([{ enabled: true, id: 'restart-menu', title: 'Menu', description: 'Ordering', serviceUrl: new URL('/favicon.ico', location.origin).href }])
  const resetOrderRound = vi.fn(async () => {})
  const onNewOrder = vi.fn()
  const chatSession = { initialize: vi.fn(), createSession: vi.fn().mockResolvedValue('new-chat'), setActiveSession: vi.fn(), deleteSession: vi.fn() }
  const Harness = defineComponent({
    setup() {
      const session = useKioskCustomerSession({ activeCardId: shallowRef('default'), chatSession, resetOrderRound, onNewOrder })
      return () => h('main', [
        h('button', { onClick: () => session.startNewCustomerSession() }, '重新開始'),
        h('output', session.state.value),
        h(ScenarioSurface),
      ])
    },
  })
  const screen = render(Harness)
  try {
    await expect.poll(() => interactiveServiceClient.availability.value).not.toBe('idle')
    const previous = screen.container.querySelector('iframe')
    await screen.getByRole('button', { name: '重新開始' }).click()
    await expect.poll(() => onNewOrder.mock.calls.length).toBe(1)
    await expect.element(screen.getByText('standby', { exact: true })).toBeVisible()
    expect(screen.container.querySelector('iframe')).not.toBe(previous)
    expect(resetOrderRound).toHaveBeenCalledOnce()
  }
  finally { screen.unmount() }
})

it('revokes assistant handles on same-service reload and unmount without blocking the iframe', async () => {
  scenarioRegistry.setServices([{
    enabled: true,
    id: 'menu',
    title: 'Menu',
    description: 'Ordering',
    // A document with no application scripts keeps this lifecycle test local;
    // it must not create carts or orders on the external service.
    serviceUrl: new URL('/favicon.ico', location.origin).href,
  }])
  const screen = render(ScenarioSurface)
  const frame = screen.container.querySelector('iframe')
  expect(frame?.getAttribute('allow')).toContain('geolocation')
  expect(frame?.getAttribute('sandbox')).toBeNull()
  await expect.poll(() => interactiveServiceClient.availability.value).not.toBe('idle')

  const reloaded = scenarioRegistry.reloadActive()
  expect(interactiveServiceClient.availability.value).toBe('idle')
  expect(interactiveServiceClient.tools.value).toEqual([])
  await expect.poll(() => interactiveServiceClient.availability.value).not.toBe('idle')
  await reloaded

  screen.unmount()
  expect(interactiveServiceClient.availability.value).toBe('idle')
  expect(interactiveServiceClient.tools.value).toEqual([])
})
