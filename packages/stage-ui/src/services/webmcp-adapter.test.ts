import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWebMcpAdapter } from './webmcp-adapter'

describe('createWebMcpAdapter', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('executes discovered cross-origin tools through the browser handle rather than a postMessage bridge', async () => {
    // NOTICE: Chrome 155 rejects JSON strings before invoking the page tool.
    // https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/webmcp/agentic-javascript-tools.md#invoking-tools-with-executetool
    const executeTool = vi.fn(async (_tool: object, input: unknown) => {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new TypeError('Failed to execute \'executeTool\' on \'ModelContext\': invalid input object: value is not an object')
      return '{"cart":{"itemCount":1}}'
    })
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
    expect(executeTool).toHaveBeenCalledWith(registeredTool, { quantity: 1 })
    expect(executeTool).toHaveBeenCalledTimes(1)
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
  it('revokes ready state when the active document removes its tools', async () => {
    const getTools = vi.fn().mockResolvedValue([{
      name: 'cart_read',
      description: 'Read cart',
      origin: 'https://menu.example',
      inputSchema: { type: 'object' },
    }])
    vi.stubGlobal('document', { modelContext: { getTools, executeTool: vi.fn() } })
    const adapter = createWebMcpAdapter()
    adapter.activate('https://menu.example')
    await adapter.refresh()
    expect(adapter.availability.value).toBe('ready')

    getTools.mockResolvedValue([])
    await adapter.refresh()

    expect(adapter.tools.value).toEqual([])
    expect(adapter.availability.value).toBe('unavailable')
  })

  it('settles readiness waiters when their document is deactivated', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { modelContext: { getTools: vi.fn().mockResolvedValue([]), executeTool: vi.fn() } })
    const adapter = createWebMcpAdapter()
    adapter.activate('https://menu.example')
    const settled = vi.fn()
    const waiting = adapter.waitUntilReady().then(() => settled('ready'), () => settled('cancelled'))

    adapter.activate(undefined)
    await vi.advanceTimersByTimeAsync(5_001)

    expect(settled).toHaveBeenCalledWith('cancelled')
    await waiting
  })
})
