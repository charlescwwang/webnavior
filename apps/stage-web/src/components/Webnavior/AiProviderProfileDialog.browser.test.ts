import type { AiProviderProfile } from '../../composables/useWebnaviorAiControl'

import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import settings from '../../../../../packages/i18n/src/locales/zh-Hant/settings.yaml'
import AiCapabilityCards from './AiCapabilityCards.vue'
import AiProviderProfileDialog from './AiProviderProfileDialog.vue'

const profile: AiProviderProfile = {
  id: 'chat',
  capability: 'chat',
  kind: 'openai-compatible',
  name: 'Chat',
  baseURL: 'https://models.example/v1',
  modelId: 'chat',
  timeoutMs: 5000,
  responseMode: 'auto',
  enableThinking: false,
  hasApiKey: false,
  discoveredModels: [{ id: 'chat' }],
  lastCheckError: null,
  lastVerificationError: null,
  verifiedAt: null,
  voice: null,
  speed: null,
}

it.each(['json', 'sse'] as const)('saves the selected %s response mode without changing the source profile', async (responseMode) => {
  const onVerifyAndSave = vi.fn()
  const screen = render(AiProviderProfileDialog, {
    props: { busy: false, capability: 'chat', open: true, profiles: [profile], discoverModels: async () => ({ catalogAvailable: true, models: [{ id: 'chat' }] }), onVerifyAndSave },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { settings } } })] },
  })
  try {
    await expect.element(screen.getByText('對話回應方式：沿用目前方式', { exact: true })).toBeVisible()
    await screen.getByRole('button', { name: '編輯', exact: true }).click()
    await screen.getByRole('combobox', { name: '對話回應方式', exact: true }).selectOptions(responseMode)
    await screen.getByRole('button', { name: '測試連線與讀取模型', exact: true }).click()
    await screen.getByRole('button', { name: '驗證並儲存 Provider', exact: true }).click()
    expect(onVerifyAndSave).toHaveBeenCalledWith('chat', expect.objectContaining({ responseMode, modelId: 'chat' }), 'chat')
    expect(profile.responseMode).toBe('auto')
  }
  finally { screen.unmount() }
})

it.each(['auto', 'json', 'sse'] as const)('shows the selected %s policy on the outer LLM card', async (responseMode) => {
  const selected = { ...profile, responseMode }
  const labels = { auto: '沿用目前方式', json: '一次回傳（JSON）', sse: '串流回傳（SSE）' }
  const screen = render(AiCapabilityCards, {
    props: { busy: false, profiles: [selected], selections: [{ capability: 'chat', providerProfileId: selected.id, providerProfile: selected }] },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { settings } } })] },
  })
  try {
    await expect.element(screen.getByText(`對話回應方式：${labels[responseMode]}`, { exact: true })).toBeVisible()
  }
  finally { screen.unmount() }
})

// Report: this chat, Nov14 — response mode must also be selectable during creation.
it('allows selecting SSE before creating an OpenAI-compatible provider', async () => {
  const onVerifyAndSave = vi.fn()
  const screen = render(AiProviderProfileDialog, {
    props: { busy: false, capability: 'chat', open: true, profiles: [], discoverModels: async () => ({ catalogAvailable: true, models: [{ id: 'qwen36' }] }), onVerifyAndSave },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { settings } } })] },
  })
  try {
    await screen.getByRole('button', { name: '新增對話 LLM Provider', exact: true }).click()
    await screen.getByRole('combobox', { name: 'Provider 類型', exact: true }).selectOptions('openai-compatible')
    await screen.getByRole('combobox', { name: '對話回應方式', exact: true }).selectOptions('sse')
    await screen.getByRole('textbox', { name: '顯示名稱', exact: true }).fill('vLLM')
    await screen.getByRole('textbox', { name: 'Base URL', exact: true }).fill('http://192.168.8.64:8000/v1')
    await screen.getByRole('button', { name: '測試連線與讀取模型', exact: true }).click()
    await screen.getByRole('combobox', { name: '模型', exact: true }).selectOptions('qwen36')
    await screen.getByRole('button', { name: '驗證並儲存 Provider', exact: true }).click()
    expect(onVerifyAndSave).toHaveBeenCalledWith('chat', expect.objectContaining({ responseMode: 'sse', modelId: 'qwen36', baseURL: 'http://192.168.8.64:8000/v1' }), undefined)
  }
  finally { screen.unmount() }
})
