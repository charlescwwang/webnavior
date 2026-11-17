import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/window-message'
import { discoverService, executeServiceTool, inspectService, interactiveServiceChannel } from '@proj-airi/stage-shared/interactive-service'
import { isPbSimulatorHost } from '@proj-airi/stage-shared/pb-journey'

import { createPbService } from './pbBrowserService'

/** Installs only in the owned simulator iframe. Parent source/origin and service journals isolate requests. */
export function installSimulatorBridge() {
  if (window.parent === window || !isPbSimulatorHost(location.href, document.referrer))
    return
  const hostOrigin = new URL(document.referrer).origin
  const service = createPbService()
  const connection = createContext({ channel: interactiveServiceChannel, currentWindow: window, targetWindow: () => window.parent, expectedSource: () => window.parent, targetOrigin: hostOrigin, expectedOrigin: hostOrigin })
  defineInvokeHandler(connection.context, discoverService, request => service.discover(request))
  defineInvokeHandler(connection.context, executeServiceTool, request => service.execute(request))
  defineInvokeHandler(connection.context, inspectService, request => service.inspect(request))
  // One iframe document owns the peer; navigation retires pending RPCs without replaying writes.
  window.addEventListener('pagehide', () => connection.dispose(), { once: true })
}
