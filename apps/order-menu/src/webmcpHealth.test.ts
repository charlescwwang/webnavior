import { webMcpHealthTool } from '@proj-airi/stage-shared/webmcp'
import { afterEach, expect, it, vi } from 'vitest'

import { createMenuToolRuntime } from './webmcp'

afterEach(() => vi.unstubAllGlobals())

it('registers a transport-only probe with the service allowlist and registration lifetime', async () => {
  const registrations: Array<{
    tool: { name: string, execute: (input: Record<string, unknown>) => Promise<unknown> }
    options: { exposedTo?: string[], signal?: AbortSignal }
  }> = []
  vi.stubGlobal('document', {
    modelContext: {
      registerTool: vi.fn(async (tool, options) => { registrations.push({ tool, options }) }),
    },
  })
  const onAction = vi.fn()
  const onCartChange = vi.fn()
  const onMenuSelection = vi.fn()
  const runtime = createMenuToolRuntime({ onAction, onCartChange, onMenuSelection })
  const before = await runtime.invoke('kiosk_interaction_state')
  const dispose = await runtime.registerNativeWebMcp({ exposedTo: ['https://kiosk.example'] })
  const registration = registrations.find(entry => entry.tool.name === webMcpHealthTool.name)
  if (!registration || !dispose)
    throw new Error('Expected the native compatibility probe registration.')

  await expect(registration.tool.execute({ challenge: 'page:1' })).resolves.toEqual({ version: 1, challenge: 'page:1' })
  expect(await runtime.invoke('kiosk_interaction_state')).toEqual(before)
  expect(onAction).not.toHaveBeenCalled()
  expect(onCartChange).not.toHaveBeenCalled()
  expect(onMenuSelection).not.toHaveBeenCalled()
  expect(registration.options.exposedTo).toEqual(['https://kiosk.example'])
  expect(runtime.toolDefinitions.some(tool => tool.name === webMcpHealthTool.name)).toBe(false)

  dispose()
  expect(registration.options.signal?.aborted).toBe(true)
})
