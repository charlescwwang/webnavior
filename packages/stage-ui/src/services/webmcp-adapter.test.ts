import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWebMcpAdapter } from './webmcp-adapter'

describe('createWebMcpAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('executes discovered cross-origin tools through the browser handle rather than a postMessage bridge', async () => {
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
    const executions = vi.fn()
    adapter.onExecution(executions)
    adapter.activate('https://menu.example/ordering')
    await adapter.refresh()
    const [tool] = adapter.tools.value
    if (!tool)
      throw new Error('Expected a discovered WebMCP tool.')

    await expect(adapter.execute(tool, { quantity: 1 })).resolves.toEqual({ cart: { itemCount: 1 } })
    expect(tool).not.toBe(registeredTool)
    expect(executeTool).toHaveBeenCalledWith(registeredTool, '{"quantity":1}')
    expect(executions).toHaveBeenNthCalledWith(1, {
      input: { quantity: 1 },
      phase: 'called',
      tool,
    })
    expect(executions).toHaveBeenNthCalledWith(2, {
      input: { quantity: 1 },
      phase: 'resolved',
      result: { cart: { itemCount: 1 } },
      tool,
    })
  })

  it('exposes native JSON-string schemas as objects for Main Agent tools', async () => {
    vi.stubGlobal('document', {
      modelContext: {
        executeTool: vi.fn(),
        getTools: vi.fn().mockResolvedValue([{
          description: 'Add an item.',
          inputSchema: '{"type":"object","properties":{"quantity":{"type":"integer"}},"required":["quantity"]}',
          name: 'cart_add_item',
          origin: 'https://menu.example',
        }]),
      },
    })
    const adapter = createWebMcpAdapter()
    adapter.activate('https://menu.example/ordering')
    await adapter.refresh()

    expect(adapter.tools.value[0]?.inputSchema).toEqual({
      properties: { quantity: { type: 'integer' } },
      required: ['quantity'],
      type: 'object',
    })
  })

  it('keeps Stage Web mountable when the browser omits the optional toolchange event', async () => {
    vi.stubGlobal('document', {
      modelContext: {
        executeTool: vi.fn(),
        getTools: vi.fn().mockResolvedValue([]),
      },
    })

    expect(() => createWebMcpAdapter()).not.toThrow()
  })

  it('reports a completion declared by the native WebMCP tool result', async () => {
    const registeredTool = {
      description: 'Confirm an interaction.',
      inputSchema: { type: 'object' },
      name: 'order_confirm',
      origin: 'https://menu.example',
    }
    vi.stubGlobal('document', {
      modelContext: {
        executeTool: vi.fn().mockResolvedValue('{"interaction":{"status":"completed"}}'),
        getTools: vi.fn().mockResolvedValue([registeredTool]),
      },
    })
    const adapter = createWebMcpAdapter()
    adapter.activate('https://menu.example/ordering')
    await adapter.refresh()
    const [tool] = adapter.tools.value
    if (!tool)
      throw new Error('Expected a discovered WebMCP tool.')

    await adapter.execute(tool, {})

    expect(adapter.completionRevision.value).toBe(1)
  })
})
