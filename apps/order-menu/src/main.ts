import type { ContinuationAccess } from './continuation'

import { createApp } from 'vue'

import App from './App.vue'
import OrderContinuation from './components/orderContinuation.vue'
import PosBridgeConfigurationError from './components/PosBridgeConfigurationError.vue'

import { pendingOrderKey } from './continuation'

import './styles.css'

const isPosBridgeConfigured = Boolean(import.meta.env.VITE_ORDER_MENU_SERVER_URL?.trim())

const query = new URL(window.location.href).searchParams
const isContinuation = query.has('continuation') || query.has('table')
let token = query.get('continuation') ?? ''
if (!query.has('continuation') && query.has('table')) {
  // A phone's native camera may open the table URL in a different tab. Only an
  // unexpired same-origin capability can carry the pending order into that tab.
  try {
    const pending = JSON.parse(localStorage.getItem(pendingOrderKey) ?? 'null') as Partial<ContinuationAccess> | null
    if (typeof pending?.token === 'string' && typeof pending.expiresAt === 'number' && pending.expiresAt > Date.now())
      token = pending.token
  }
  catch {
    // Unavailable or malformed browser storage is not permission to guess an order.
    token = ''
  }
}
createApp(!isPosBridgeConfigured ? PosBridgeConfigurationError : isContinuation ? OrderContinuation : App, isContinuation ? { token, scannedTable: query.get('table') ?? undefined } : undefined).mount('#app')
