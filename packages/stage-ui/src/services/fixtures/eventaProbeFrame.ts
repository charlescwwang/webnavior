import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/window-message'
import { discoverService, executeServiceTool, interactiveServiceChannel } from '@proj-airi/stage-shared/interactive-service'

import { probe } from './eventaProbe'

const origin = new URL(document.referrer).origin
const connection = createContext({
  channel: 'test:interactive-service',
  currentWindow: window,
  targetWindow: () => window.parent,
  expectedSource: () => window.parent,
  targetOrigin: origin,
  expectedOrigin: origin,
})
defineInvokeHandler(connection.context, probe, async ({ mode }) => {
  if (mode === 'error')
    throw new Error('probe rejection')
  if (mode === 'wait')
    return await new Promise<string>(() => {})
  return 'cross-origin reply'
})
window.addEventListener('pagehide', () => connection.dispose(), { once: true })

// A minimal cooperating service exercises client completion and malformed discovery
// independently of Menu business rules. It never offers commerce operations.
const service = createContext({
  channel: interactiveServiceChannel,
  currentWindow: window,
  targetWindow: () => window.parent,
  expectedSource: () => window.parent,
  targetOrigin: origin,
  expectedOrigin: origin,
})
defineInvokeHandler(service.context, discoverService, request => ({
  ...request,
  documentId: 'probe-document',
  toolsRevision: 1,
  tools: [{ name: 'complete', description: 'Protocol probe completion', inputSchema: { type: new URL(window.location.href).searchParams.has('malformed') ? 'array' : 'object' } }],
}))
defineInvokeHandler(service.context, executeServiceTool, request => ({
  connectionId: request.connectionId,
  documentId: request.documentId,
  operationId: request.operationId,
  result: { interaction: { status: 'completed' } },
}))
window.addEventListener('pagehide', () => service.dispose(), { once: true })
