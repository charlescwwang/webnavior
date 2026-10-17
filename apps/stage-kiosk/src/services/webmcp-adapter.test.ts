import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWebMcpAdapter } from './webmcp-adapter'

describe('createWebMcpAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes transcript objects to the native kiosk_fast_path_context tool', async () => {
    const executeTool = vi.fn().mockResolvedValue('{"candidates":[]}')
    const registeredTool = {
      description: 'Read semantic ordering context.',
      inputSchema: { type: 'object' },
      name: 'kiosk_fast_path_context',
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

    await expect(adapter.execute(tool, { transcript: '有麵嗎' })).resolves.toEqual({ candidates: [] })
    expect(tool).not.toBe(registeredTool)
    expect(executeTool).toHaveBeenCalledWith(registeredTool, { transcript: '有麵嗎' })
    expect(executeTool).toHaveBeenCalledTimes(1)
  })
})
