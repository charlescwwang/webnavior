import messages from '@proj-airi/i18n/locales'

import { resolveSupportedLocale } from '@proj-airi/i18n'
import { isAccountFeaturesEnabled } from '@proj-airi/stage-shared'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { onMounted } from 'vue'

export const useSettingsGeneral = defineStore('settings-general', () => {
  const language = useLocalStorageManualReset<string>('settings/language', '')

  const disableTransitions = useLocalStorageManualReset<boolean>('settings/disable-transitions', true)
  const usePageSpecificTransitions = useLocalStorageManualReset<boolean>('settings/use-page-specific-transitions', true)

  const websocketSecureEnabled = useLocalStorageManualReset<boolean>('settings/websocket/secure-enabled', false)
  const accountFeaturesEnabled = useLocalStorageManualReset<boolean>('settings/account-features-enabled', isAccountFeaturesEnabled())

  function getLanguage() {
    let language = localStorage.getItem('settings/language')

    if (!language) {
      // Fallback to browser language
      language = navigator.language || 'en'
    }

    return resolveSupportedLocale(language, Object.keys(messages!))
  }

  function resetState() {
    language.reset()
    disableTransitions.reset()
    usePageSpecificTransitions.reset()
    websocketSecureEnabled.reset()
    accountFeaturesEnabled.reset()
  }

  onMounted(() => language.value = getLanguage())

  return {
    language,
    disableTransitions,
    usePageSpecificTransitions,
    websocketSecureEnabled,
    accountFeaturesEnabled,
    getLanguage,
    resetState,
  }
})
