import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/window-message'
import { expect, it } from 'vitest'

import { probe } from '../../test/fixtures/eventaProbe'

it('uses the installed Eventa across real origins and settles pending calls on dispose without WebMCP', async () => {
  expect('modelContext' in document).toBe(false)
  const url = new URL('/test/fixtures/eventaProbe.html', window.location.href)
  url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost'
  expect(url.origin).not.toBe(window.location.origin)
  const frame = document.createElement('iframe')
  const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }))
  frame.src = url.href
  document.body.append(frame)
  await loaded
  const connection = createContext({
    channel: 'test:interactive-service',
    currentWindow: window,
    targetWindow: () => frame.contentWindow,
    expectedSource: () => frame.contentWindow,
    targetOrigin: url.origin,
    expectedOrigin: url.origin,
  })
  try {
    const invoke = defineInvoke(connection.context, probe)
    expect(await invoke({ mode: 'echo' }, { signal: AbortSignal.timeout(2000) })).toBe('cross-origin reply')
    await expect(invoke({ mode: 'error' })).rejects.toThrow('probe rejection')
    const pending = expect(invoke({ mode: 'wait' })).rejects.toBeDefined()
    connection.dispose(new Error('page replaced'))
    await pending
  }
  finally {
    connection.dispose()
    frame.remove()
  }
})
