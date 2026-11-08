import { createApp } from 'vue'

import App from './App.vue'
import OrderContinuation from './components/orderContinuation.vue'
import PosBridgeConfigurationError from './components/PosBridgeConfigurationError.vue'

import { continuationToken } from './continuation'

import './styles.css'

const base = import.meta.env.VITE_ORDER_MENU_SERVER_URL?.trim()
const bridgeUrl = base ? `${base.replace(/\/$/, '')}/supplier` : undefined
const query = new URL(window.location.href).searchParams
const isContinuation = query.has('continuation') || query.has('table')
// Merchant-scoped storage prevents an old shop's table scan from resuming here.
const storageKey = 'webnavior-pending-order/shalun-simulation'
createApp(!base ? PosBridgeConfigurationError : isContinuation ? OrderContinuation : App, isContinuation
  ? { bridgeUrl, storageKey, simulation: true, token: continuationToken(query, localStorage, storageKey), scannedTable: query.get('table') ?? undefined }
  : { variant: 'supplier', bridgeUrl, merchant: { id: 'shalun-simulation', operatorName: '周氏蝦捲', paymentPolicy: 'cashless' } }).mount('#app')
