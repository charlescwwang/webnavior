import type { AiProviderProfile } from '../../../stage-web/src/composables/useWebnaviorAiControl'

import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import messages from '../../../../packages/i18n/src/locales/zh-Hant/settings.yaml'
import AiProviderProfileDialog from '../../../stage-web/src/components/Webnavior/AiProviderProfileDialog.vue'

const profile: AiProviderProfile = {
  id: 'tts-speed',
  capability: 'tts',
  kind: 'openai-compatible',
  baseURL: 'https://tts.example/v1',
  name: 'TTS',
  modelId: 'tts',
  voice: 'voice',
  speed: 1.2,
  timeoutMs: 30000,
  enableThinking: false,
  hasApiKey: false,
  discoveredModels: [{ id: 'tts' }],
  lastCheckError: null,
  lastVerificationError: null,
  verifiedAt: '2026-11-06T00:00:00Z',
}

it('lets admins edit a saved synthesis multiplier and rejects invalid values before saving', async () => {
  const onVerifyAndSave = vi.fn()
  const view = render(AiProviderProfileDialog, {
    props: { busy: false, open: true, capability: 'tts', profiles: [profile], discoverModels: async () => ({ catalogAvailable: true, models: [{ id: 'tts' }] }), onVerifyAndSave },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { settings: messages } } })] },
  })
  try {
    await view.getByRole('button', { name: '編輯', exact: true }).click()
    const speed = view.getByRole('spinbutton', { name: /合成語速/ })
    await expect.element(speed).toHaveValue(1.2)
    await speed.fill('0.85')
    await view.getByRole('button', { name: '測試連線與讀取模型' }).click()
    const save = view.getByRole('button', { name: '驗證並儲存 Provider' })
    await expect.element(save).toBeEnabled()
    await save.click()
    expect(onVerifyAndSave).toHaveBeenCalledWith('tts', expect.objectContaining({ speed: 0.85 }), profile.id)
    await speed.fill('4.1')
    await expect.element(save).toBeDisabled()
    await speed.fill('')
    await expect.element(save).toBeDisabled()
  }
  finally { view.unmount() }
})
