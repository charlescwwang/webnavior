import { describe, expect, it, vi } from 'vitest'
import { isProxy, shallowRef } from 'vue'

import { createScenarioRegistry } from './scenario-registry'

const { createBridge } = vi.hoisted(() => ({
  createBridge: vi.fn(),
}))

vi.mock('./scenario-bridge', () => ({
  createScenarioBridge: createBridge,
}))

describe('createScenarioRegistry', () => {
  it('keeps an active bridge raw so its optional manifest remains a ref while the iframe loads', () => {
    const manifest = shallowRef()
    const bridge = {
      attach: vi.fn(),
      manifest,
      on: vi.fn(),
      reset: vi.fn(),
      waitForManifest: vi.fn(),
    }
    createBridge.mockReturnValue(bridge)
    const registry = createScenarioRegistry()

    registry.setServices([{
      id: 'ordering',
      title: '點餐',
      description: '協助顧客點餐',
      enabled: true,
      serviceUrl: 'https://ordering.example.com',
    }])

    const activeBridge = registry.activeBridge.value

    expect(activeBridge).toBe(bridge)
    expect(isProxy(activeBridge)).toBe(false)
    expect(activeBridge?.manifest.value).toBeUndefined()
  })
})
