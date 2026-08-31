import Tres from '@tresjs/core'

import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'

import { i18n } from './modules/i18n'

import '@proj-airi/font-cjkfonts-allseto/index.css'
import '@proj-airi/font-xiaolai/index.css'
import '@unocss/reset/tailwind.css'
import 'vue-sonner/style.css'
import './styles/main.css'
import 'uno.css'

createApp(App)
  .use(createPinia())
  .use(PiniaColada)
  .use(i18n)
  .use(Tres)
  .mount('#app')
