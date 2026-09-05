import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWebMcpAdapter } from './webmcp-adapter'

describe('createWebMcpAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serializes structured arguments before executing a discovered native WebMCP tool', async () => {
    const executeTool = vi.fn().mockResolvedValue('{"cart":{"itemCount":1}}')
    const registeredTool = {
      description: 'Add an item to the cart.',
      inputSchema: { type: 'object' },
      name: 'cart_add_item',
      origin: 'https://menu.example',
    }
    vi.stubGlobal('document', {
      modelContext: {
        addEventListener: vi.fn(),
        executeTool,
        getTools: vi.fn().mockResolvedValue([registeredTool]),
      },
    })
    const adapter = createWebMcpAdapter()
    adapter.activate('https://menu.example')
    await adapter.refresh()
    const [tool] = adapter.tools.value
    if (!tool)
      throw new Error('Expected a discovered WebMCP tool.')

    await expect(adapter.execute(tool, { quantity: 1 })).resolves.toEqual({ cart: { itemCount: 1 } })
    expect(tool).not.toBe(registeredTool)
    expect(executeTool).toHaveBeenCalledWith(registeredTool, '{"quantity":1}')
  })
})
