import { describe, expect, it, vi } from 'vitest'

import { createScenarioRegistry } from './scenario-registry'

describe('createScenarioRegistry', () => {
  it('accepts lifecycle events only from the active approved iframe origin', () => {
    const messageTarget = new EventTarget()
    const registry = createScenarioRegistry({ messageTarget })
    const activeFrame = new MessageChannel().port1
    const staleFrame = new MessageChannel().port1
    const activity = vi.fn()
    const completed = vi.fn()
    registry.on('activity', activity)
    registry.on('completed', completed)
    registry.setServices([{
      id: 'restaurant-ordering',
      title: '點餐',
      description: '餐點點餐',
      serviceUrl: 'https://menu.example/order',
      enabled: true,
    }])
    registry.attachActiveFrame(activeFrame)

    messageTarget.dispatchEvent(new MessageEvent('message', {
      data: { source: 'airi-interaction-lifecycle', type: 'activity' },
      origin: 'https://attacker.example',
      source: activeFrame,
    }))
    messageTarget.dispatchEvent(new MessageEvent('message', {
      data: { source: 'airi-interaction-lifecycle', type: 'activity' },
      origin: 'https://menu.example',
      source: staleFrame,
    }))
    expect(activity).not.toHaveBeenCalled()

    messageTarget.dispatchEvent(new MessageEvent('message', {
      data: { source: 'airi-interaction-lifecycle', type: 'completed' },
      origin: 'https://menu.example',
      source: activeFrame,
    }))
    expect(completed).toHaveBeenCalledOnce()
  })

  it('forwards a validated non-personal order result only from the active approved iframe', () => {
    const messageTarget = new EventTarget()
    const registry = createScenarioRegistry({ messageTarget })
    const activeFrame = new MessageChannel().port1
    const completed = vi.fn()
    registry.on('completed', completed)
    registry.setServices([{
      id: 'restaurant-ordering',
      title: '點餐',
      description: '餐點點餐',
      serviceUrl: 'https://menu.example/order',
      enabled: true,
    }])
    registry.attachActiveFrame(activeFrame)

    messageTarget.dispatchEvent(new MessageEvent('message', {
      data: {
        source: 'airi-interaction-lifecycle',
        type: 'completed',
        orderResult: { environment: 'test', fulfillmentMode: 'takeout', id: 'demo-1', itemCount: 2, status: 'accepted', total: 180 },
      },
      origin: 'https://menu.example',
      source: activeFrame,
    }))

    expect(completed).toHaveBeenCalledWith({
      id: 'demo-1',
      fulfillmentMode: 'takeout',
      itemCount: 2,
      environment: 'test',
      status: 'accepted',
      total: 180,
    })
  })

  it('rejects the retired simulated order payload instead of completing a customer session', () => {
    const messageTarget = new EventTarget()
    const registry = createScenarioRegistry({ messageTarget })
    const activeFrame = new MessageChannel().port1
    const completed = vi.fn()
    registry.on('completed', completed)
    registry.setServices([{
      id: 'restaurant-ordering',
      title: '點餐',
      description: '餐點點餐',
      serviceUrl: 'https://menu.example/order',
      enabled: true,
    }])
    registry.attachActiveFrame(activeFrame)

    messageTarget.dispatchEvent(new MessageEvent('message', {
      data: {
        source: 'airi-interaction-lifecycle',
        type: 'completed',
        orderResult: { id: 'demo-1', fulfillmentMode: 'takeout', itemCount: 2, simulated: true, total: 180 },
      },
      origin: 'https://menu.example',
      source: activeFrame,
    }))

    expect(completed).not.toHaveBeenCalled()
  })

  it('does not register disabled, malformed, or duplicate service definitions', () => {
    const registry = createScenarioRegistry({ messageTarget: new EventTarget() })
    registry.setServices([
      { id: 'restaurant-ordering', title: '點餐', description: '餐點點餐', serviceUrl: 'https://menu.example/order', enabled: true },
      { id: 'restaurant-ordering', title: '重複', description: '不可用', serviceUrl: 'https://other.example/order', enabled: true },
      { id: 'disabled-service', title: '停用', description: '不可用', serviceUrl: 'https://menu.example/disabled', enabled: false },
      { id: 'bad id', title: '無效', description: '不可用', serviceUrl: 'javascript:alert(1)', enabled: true },
    ])

    expect(registry.registeredScenarios.value).toEqual([
      expect.objectContaining({ id: 'restaurant-ordering', serviceUrl: 'https://menu.example/order' }),
    ])
  })
})
