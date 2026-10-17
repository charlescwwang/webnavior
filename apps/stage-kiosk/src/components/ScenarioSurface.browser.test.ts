import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'

import ScenarioSurface from './ScenarioSurface.vue'

import { scenarioRegistry } from '../services/scenario-registry'
import { webMcpAdapter } from '../services/webmcp-adapter'

afterEach(() => {
  scenarioRegistry.setServices([])
  webMcpAdapter.activate(undefined)
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
  await expect.poll(() => webMcpAdapter.availability.value).not.toBe('idle')

  scenarioRegistry.reloadActive()
  expect(webMcpAdapter.availability.value).toBe('idle')
  expect(webMcpAdapter.tools.value).toEqual([])
  await expect.poll(() => webMcpAdapter.availability.value).not.toBe('idle')

  screen.unmount()
  expect(webMcpAdapter.availability.value).toBe('idle')
  expect(webMcpAdapter.tools.value).toEqual([])
})
