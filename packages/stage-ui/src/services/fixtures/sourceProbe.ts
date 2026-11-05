import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/window-message'
import { executeServiceTool, executionRequestSchema, interactiveServiceChannel } from '@proj-airi/stage-shared/interactive-service'
import { parse } from 'valibot'

const params = new URL(window.location.href).searchParams
const request = parse(executionRequestSchema, JSON.parse(params.get('request')!))
const connection = createContext({
  channel: interactiveServiceChannel,
  currentWindow: window,
  targetWindow: () => window.parent.frames[0],
  expectedSource: () => window.parent.frames[0],
  targetOrigin: params.get('targetOrigin')!,
  expectedOrigin: params.get('targetOrigin')!,
})
void defineInvoke(connection.context, executeServiceTool)(request, { signal: AbortSignal.timeout(200) })
  .catch(() => {
    // Deliberately not the approved parent Window, even when sharing its origin.
  })
  .finally(() => {
    connection.dispose()
    window.parent.postMessage({ source: 'source-probe-finished' }, new URL(document.referrer).origin)
  })
