import { createApp } from 'vue'

import App from './App.vue'
import OrderContinuation from './components/orderContinuation.vue'
import PosBridgeConfigurationError from './components/PosBridgeConfigurationError.vue'

import { continuationToken } from './continuation'

import './styles.css'

const isPosBridgeConfigured = Boolean(import.meta.env.VITE_ORDER_MENU_SERVER_URL?.trim())

const query = new URL(window.location.href).searchParams
const isContinuation = query.has('continuation') || query.has('table')
const token = continuationToken(query, localStorage)
createApp(!isPosBridgeConfigured ? PosBridgeConfigurationError : isContinuation ? OrderContinuation : App, isContinuation ? { token, scannedTable: query.get('table') ?? undefined } : undefined).mount('#app')
