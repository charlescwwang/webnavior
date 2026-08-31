import messages from '@proj-airi/i18n/locales'

import { resolveSupportedLocale } from '@proj-airi/i18n'
import { createI18n } from 'vue-i18n'

const language = localStorage.getItem('settings/language') ?? navigator.language ?? 'zh-TW'

export const i18n = createI18n({
  legacy: false,
  locale: resolveSupportedLocale(language, Object.keys(messages!)),
  fallbackLocale: 'en',
  messages,
})
