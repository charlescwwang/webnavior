import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/window-message'
import { discoverService, executeServiceTool, inspectService, interactiveServiceChannel } from '@proj-airi/stage-shared/interactive-service'

import { createPbService } from './pbBrowserService'

// Local controller installs only this approved store peer; PB does not ship it.
const hostOrigin = 'http://localhost:5169'
// Firefox may omit referrer on a reload after Storage Access. It is optional
// metadata: the Eventa peer below still admits only the exact parent window
// sending from hostOrigin. A contradictory supplied referrer is rejected.
if (window.parent === window || (document.referrer && new URL(document.referrer).origin !== hostOrigin))
  throw new Error('PB prototype requires the approved local Kiosk parent.')
const service = createPbService()
const connection = createContext({ channel: interactiveServiceChannel, currentWindow: window, targetWindow: () => window.parent, expectedSource: () => window.parent, targetOrigin: hostOrigin, expectedOrigin: hostOrigin })
defineInvokeHandler(connection.context, discoverService, request => service.discover(request))
defineInvokeHandler(connection.context, executeServiceTool, request => service.execute(request))
defineInvokeHandler(connection.context, inspectService, request => service.inspect(request))
window.addEventListener('pagehide', () => connection.dispose(), { once: true })
