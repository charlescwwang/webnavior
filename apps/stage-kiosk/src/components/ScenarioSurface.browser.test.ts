import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'

import ScenarioSurface from './ScenarioSurface.vue'

import { interactiveServiceClient } from '../services/interactiveServiceClient'
import { scenarioRegistry } from '../services/scenario-registry'

afterEach(() => {
  scenarioRegistry.setServices([])
  interactiveServiceClient.activate(undefined)
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
  // A customer may have navigated within the entry document. Reload must use
  // deployment configuration, not retain that customer's current location.
  frame!.contentWindow!.location.hash = 'previous-customer-menu'
  await expect.poll(() => frame!.contentWindow!.location.hash).toBe('#previous-customer-menu')

  scenarioRegistry.reloadActive()
  expect(interactiveServiceClient.availability.value).toBe('idle')
  expect(interactiveServiceClient.tools.value).toEqual([])
  await expect.poll(() => interactiveServiceClient.availability.value).not.toBe('idle')
  const replacement = screen.container.querySelector('iframe')
  expect(replacement).not.toBe(frame)
  expect(replacement?.src).toBe(new URL('/favicon.ico', location.origin).href)
  expect(replacement?.contentWindow?.location.hash).toBe('')

  screen.unmount()
  expect(interactiveServiceClient.availability.value).toBe('idle')
  expect(interactiveServiceClient.tools.value).toEqual([])
})
