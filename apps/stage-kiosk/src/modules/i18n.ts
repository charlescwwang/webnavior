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

/** Applies the shared UI-language setting without requiring a Kiosk reload. */
export function setKioskLocale(language: string) {
  const locale = resolveSupportedLocale(language, Object.keys(messages!))
  if (locale === 'en' || locale === 'es' || locale === 'fr' || locale === 'ja' || locale === 'ko' || locale === 'ru' || locale === 'vi' || locale === 'zh-Hans' || locale === 'zh-Hant')
    i18n.global.locale.value = locale
}
