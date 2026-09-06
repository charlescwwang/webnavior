import type { Plugin } from 'vue'
import type { RouteRecordRaw } from 'vue-router'

import Tres from '@tresjs/core'

import { autoAnimatePlugin } from '@formkit/auto-animate/vue'
import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import { setupLayouts } from 'virtual:generated-layouts'
import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { routes } from 'vue-router/auto-routes'

import App from './App.vue'

import { i18n } from './modules/i18n'
import { isKioskAdminSessionActive } from './services/admin-session'

import '@proj-airi/font-cjkfonts-allseto/index.css'
import '@proj-airi/font-xiaolai/index.css'
import '@unocss/reset/tailwind.css'
import 'vue-sonner/style.css'
import './styles/main.css'
import 'uno.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: setupLayouts(routes as RouteRecordRaw[]),
})

router.beforeEach((to) => {
  if (to.path.startsWith('/settings') && !isKioskAdminSessionActive.value)
    return '/'
})

createApp(App)
  // NOTICE: Shared chat components use v-auto-animate for message transitions.
  // The directive must be registered by every application entrypoint that
  // renders them; Stage Web and the desktop renderer use the same plugin.
  .use(autoAnimatePlugin as unknown as Plugin)
  .use(createPinia())
  .use(router)
  .use(PiniaColada)
  .use(i18n)
  .use(Tres)
  .mount('#app')
