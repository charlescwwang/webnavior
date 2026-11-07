import { createPbService } from './pbBrowserService'

// Loaded only in the desktop host's isolated world. No Electron/preload APIs
// enter the vendor page; the host selects a finite method and validated envelope.
Object.defineProperty(globalThis, '__webnaviorPbService', { value: createPbService() })
