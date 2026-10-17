import { webMcpHealthTool } from '@proj-airi/stage-shared/webmcp'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWebMcpAdapter } from './webmcp-adapter'

const health = { ...webMcpHealthTool, origin: 'https://menu.example' }
const business = { name: 'cart_add_item', description: 'Add item', inputSchema: { type: 'object' }, origin: 'https://menu.example' }

function fixture(probe = async (input: Record<string, unknown>) => JSON.stringify(await webMcpHealthTool.execute(input))) {
  const executeTool = vi.fn(async (tool: { name: string }, input: Record<string, unknown>) => {
    if (tool.name === health.name)
      return await probe(input)
    return '{"cart":{"itemCount":1}}'
  })
  const getTools = vi.fn().mockResolvedValue([health, business])
  vi.stubGlobal('document', { modelContext: { getTools, executeTool } })
  const adapter = createWebMcpAdapter()
  adapter.activate('https://menu.example')
  return { adapter, executeTool, getTools }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('webMCP compatibility admission', () => {
  it('withholds business tools and rejects execution until the transport probe passes', async () => {
    let resolveProbe!: (result: string) => void
    let challenge: unknown
    const pending = new Promise<string>((resolve) => {
      resolveProbe = resolve
    })
    const { adapter, executeTool } = fixture(async (input) => {
      challenge = input.challenge
      return await pending
    })
    const refreshing = adapter.refresh()
    await vi.waitFor(() => expect(executeTool).toHaveBeenCalled())

    expect(adapter.availability.value).toBe('loading')
    expect(adapter.tools.value).toEqual([])
    await expect(adapter.execute(business, {})).rejects.toThrow()
    expect(executeTool.mock.calls.every(([tool]) => tool.name === health.name)).toBe(true)

    resolveProbe(JSON.stringify({ version: 1, challenge }))
    await refreshing
    expect(adapter.availability.value).toBe('ready')
    expect(adapter.tools.value.map(tool => tool.name)).toEqual([business.name])
    await expect(adapter.execute(business, { quantity: 1 })).resolves.toEqual({ cart: { itemCount: 1 } })
    adapter.activate(undefined)
  })

  it('blocks API format rejection without executing or retrying a business tool', async () => {
    const { adapter, executeTool } = fixture(async () => {
      throw new TypeError('invalid input object: value is not an object')
    })
    await adapter.refresh()

    expect(adapter.availability.value).toBe('unavailable')
    expect(adapter.tools.value).toEqual([])
    expect(adapter.error.value).toContain('invalid input object')
    await expect(adapter.execute(business, {})).rejects.toThrow()
    expect(executeTool.mock.calls.every(([tool]) => tool.name === health.name)).toBe(true)
    adapter.activate(undefined)
  })

  it.each([
    ['null', 'null'],
    ['wrong version', '{"version":2,"challenge":"wrong"}'],
    ['wrong challenge', '{"version":1,"challenge":"stale"}'],
    ['invalid JSON', 'not JSON'],
  ])('rejects a %s acknowledgement', async (_label, result) => {
    const { adapter } = fixture(async () => result)
    await adapter.refresh()
    expect(adapter.availability.value).toBe('unavailable')
    expect(adapter.tools.value).toEqual([])
    adapter.activate(undefined)
  })

  it('refuses to substitute a read-only business tool when the probe is missing', async () => {
    const { adapter, executeTool, getTools } = fixture()
    getTools.mockResolvedValue([{ ...business, annotations: { readOnlyHint: true } }])
    await adapter.refresh()
    expect(adapter.availability.value).toBe('unavailable')
    expect(adapter.tools.value).toEqual([])
    expect(executeTool).not.toHaveBeenCalled()
    adapter.activate(undefined)
  })

  it('revokes old tool descriptors when a later discovery loses the probe', async () => {
    const { adapter, executeTool, getTools } = fixture()
    await adapter.refresh()
    const [tool] = adapter.tools.value
    if (!tool)
      throw new Error('Expected an admitted business tool.')
    getTools.mockResolvedValue([business])
    await adapter.refresh()
    expect(adapter.unavailableReason.value).toBe('missing-health-check')
    await expect(adapter.execute(tool, {})).rejects.toThrow()
    expect(executeTool.mock.calls.every(([handle]) => handle.name === health.name)).toBe(true)
    adapter.activate(undefined)
  })

  it('does not discover tools when the browser omits the execution API', async () => {
    const getTools = vi.fn()
    vi.stubGlobal('document', { modelContext: { getTools } })
    const adapter = createWebMcpAdapter()
    adapter.activate('https://menu.example')
    await adapter.refresh()
    expect(adapter.unavailableReason.value).toBe('unsupported-browser')
    expect(getTools).not.toHaveBeenCalled()
    adapter.activate(undefined)
  })

  it('settles a hanging probe and rejects readiness waiters on timeout', async () => {
    vi.useFakeTimers()
    const { adapter } = fixture(async () => await new Promise<string>(() => {}))
    const refreshing = adapter.refresh()
    const waiting = expect(adapter.waitUntilReady()).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(5_001)
    await refreshing
    await waiting
    expect(adapter.availability.value).toBe('unavailable')
    expect(adapter.tools.value).toEqual([])
    adapter.activate(undefined)
  })

  it('cannot restore readiness from an old document probe after iframe replacement', async () => {
    let resolveProbe!: (result: string) => void
    let challenge: unknown
    const pending = new Promise<string>((resolve) => {
      resolveProbe = resolve
    })
    const { adapter, executeTool } = fixture(async (input) => {
      challenge = input.challenge
      return await pending
    })
    const refreshing = adapter.refresh()
    await vi.waitFor(() => expect(executeTool).toHaveBeenCalled())
    adapter.activate(undefined)
    resolveProbe(JSON.stringify({ version: 1, challenge }))
    await refreshing
    expect(adapter.availability.value).toBe('idle')
    expect(adapter.tools.value).toEqual([])
  })
})
