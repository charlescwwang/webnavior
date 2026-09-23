import { createApp } from 'vue'

import App from './App.vue'
import PosBridgeConfigurationError from './components/PosBridgeConfigurationError.vue'

import './styles.css'

const isPosBridgeConfigured = Boolean(import.meta.env.VITE_ORDER_MENU_SERVER_URL?.trim())

createApp(isPosBridgeConfigured ? App : PosBridgeConfigurationError).mount('#app')
