import type { ServiceConnection } from '@proj-airi/stage-shared/interactive-service'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/window-message'
import { discoverService, executeServiceTool, inspectService, interactiveServiceChannel } from '@proj-airi/stage-shared/interactive-service'

/** Binds RPC to the approved iframe source and origin for one client activation. */
export function connectWindow(serviceUrl: string, frameWindow: Window): ServiceConnection {
  const origin = new URL(serviceUrl).origin
  const peer = createContext({ channel: interactiveServiceChannel, currentWindow: window, targetWindow: () => frameWindow, expectedSource: () => frameWindow, targetOrigin: origin, expectedOrigin: origin })
  return {
    signal: peer.context.signal,
    discover: (request, signal) => defineInvoke(peer.context, discoverService)(request, { signal }),
    execute: (request, signal) => defineInvoke(peer.context, executeServiceTool)(request, { signal }),
    inspect: (request, signal) => defineInvoke(peer.context, inspectService)(request, { signal }),
    dispose: reason => peer.dispose(reason),
  }
}
