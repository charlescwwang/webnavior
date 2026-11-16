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
    props: { busy: false, profiles: [selected], selections: [{ capability: 'chat', providerProfileId: selected.id, providerProfile: selected, fallbackProviderProfileId: null, fallbackProviderProfile: null }] },
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

// Report: this chat, Nov15 — native OpenAI and the existing compatible connection must coexist.
it('creates a native OpenAI Responses provider with SSE and without local thinking settings', async () => {
  const onVerifyAndSave = vi.fn()
  const screen = render(AiProviderProfileDialog, {
    props: { busy: false, capability: 'chat', open: true, profiles: [], discoverModels: async () => ({ catalogAvailable: true, models: [{ id: 'test-openai' }] }), onVerifyAndSave },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { settings } } })] },
  })
  try {
    await screen.getByRole('button', { name: '新增對話 LLM Provider', exact: true }).click()
    await screen.getByRole('combobox', { name: 'Provider 類型', exact: true }).selectOptions('openai-responses')
    await expect.element(screen.getByRole('textbox', { name: 'Base URL', exact: true })).toHaveValue('https://api.openai.com/v1')
    await expect.element(screen.getByRole('checkbox')).not.toBeInTheDocument()
    await screen.getByRole('combobox', { name: '對話回應方式', exact: true }).selectOptions('sse')
    await screen.getByRole('button', { name: '測試連線與讀取模型', exact: true }).click()
    await screen.getByRole('combobox', { name: '模型', exact: true }).selectOptions('test-openai')
    await screen.getByRole('button', { name: '驗證並儲存 Provider', exact: true }).click()
    expect(onVerifyAndSave).toHaveBeenCalledWith('chat', expect.objectContaining({ kind: 'openai-responses', responseMode: 'sse', baseURL: 'https://api.openai.com/v1', modelId: 'test-openai' }), undefined)
    expect(onVerifyAndSave.mock.calls[0]?.[1]).not.toHaveProperty('enableThinking')
  }
  finally { screen.unmount() }
})

// Report: this chat, Nov16 — Qwen must stay primary while a verified OpenAI source is configured as automatic fallback.
it('selects only a verified different chat source as fallback without changing the primary source', async () => {
  const primary = { ...profile, verifiedAt: '2026-11-16T00:00:00.000Z' }
  const backup: AiProviderProfile = { ...primary, id: 'openai', name: 'OpenAI', kind: 'openai-responses', modelId: 'openai-model', discoveredModels: [{ id: 'openai-model' }] }
  const onFallback = vi.fn()
  const screen = render(AiCapabilityCards, {
    props: {
      busy: false,
      profiles: [primary, backup, { ...backup, id: 'unverified', name: '未驗證來源', verifiedAt: null }, { ...backup, id: 'wrong-model', name: '模型未驗證', discoveredModels: [] }, { ...backup, id: 'vision-only', name: '視覺來源', capability: 'vision' }],
      selections: [{ capability: 'chat', providerProfileId: primary.id, providerProfile: primary, fallbackProviderProfileId: null, fallbackProviderProfile: null }],
      onFallback,
    },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { settings } } })] },
  })
  try {
    await screen.getByRole('combobox', { name: 'Main 自動備援來源', exact: true }).click()
    await expect.element(screen.getByRole('option', { name: 'OpenAI · openai-model', exact: true })).toBeVisible()
    await expect.element(screen.getByRole('option', { name: /未驗證來源|模型未驗證|視覺來源|Chat · chat/ })).not.toBeInTheDocument()
    await screen.getByRole('option', { name: 'OpenAI · openai-model', exact: true }).click()
    expect(onFallback).toHaveBeenCalledWith('openai')
    expect(primary.id).toBe('chat')
  }
  finally { screen.unmount() }
})

it('shows the configured fallback and explicitly clears it', async () => {
  const primary = { ...profile, verifiedAt: '2026-11-16T00:00:00.000Z' }
  const backup = { ...primary, id: 'openai', name: 'OpenAI' }
  const onFallback = vi.fn()
  const screen = render(AiCapabilityCards, {
    props: { busy: false, profiles: [primary, backup], selections: [{ capability: 'chat', providerProfileId: primary.id, providerProfile: primary, fallbackProviderProfileId: backup.id, fallbackProviderProfile: backup }], onFallback },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { settings } } })] },
  })
  try {
    await expect.element(screen.getByRole('combobox', { name: 'Main 自動備援來源', exact: true })).toHaveTextContent('OpenAI · chat')
    await screen.getByRole('combobox', { name: 'Main 自動備援來源', exact: true }).click()
    await screen.getByRole('option', { name: '停用自動備援', exact: true }).click()
    expect(onFallback).toHaveBeenCalledWith(null)
  }
  finally { screen.unmount() }
})

it('keeps fallback unavailable until a primary source is selected', async () => {
  const screen = render(AiCapabilityCards, {
    props: { busy: false, profiles: [profile], selections: [] },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { settings } } })] },
  })
  try {
    await expect.element(screen.getByRole('combobox', { name: 'Main 自動備援來源', exact: true })).toBeDisabled()
  }
  finally { screen.unmount() }
})

it('keeps an invalidated fallback visible while busy and explains that it needs verification', async () => {
  const primary = { ...profile, verifiedAt: '2026-11-16T00:00:00.000Z' }
  const backup = { ...profile, id: 'openai', name: 'OpenAI', verifiedAt: null }
  const screen = render(AiCapabilityCards, {
    props: { busy: true, profiles: [primary, backup], selections: [{ capability: 'chat', providerProfileId: primary.id, providerProfile: primary, fallbackProviderProfileId: backup.id, fallbackProviderProfile: backup }] },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { settings } } })] },
  })
  try {
    await expect.element(screen.getByRole('combobox', { name: 'Main 自動備援來源', exact: true })).toBeDisabled()
    await expect.element(screen.getByRole('combobox', { name: 'Main 自動備援來源', exact: true })).toHaveTextContent('OpenAI · 需要重新驗證')
    await expect.element(screen.getByText('目前備援來源需要重新驗證。請先驗證、改選其他來源，或停用備援，再套用設定。', { exact: true })).toBeVisible()
  }
  finally { screen.unmount() }
})

it('protects the configured fallback from removal or direct promotion to primary', async () => {
  const backup = { ...profile, id: 'openai', name: 'OpenAI', verifiedAt: '2026-11-16T00:00:00.000Z' }
  const screen = render(AiProviderProfileDialog, {
    props: { busy: false, capability: 'chat', open: true, profiles: [backup], selectedProfileId: 'qwen', selectedFallbackProfileId: backup.id, discoverModels: async () => ({ catalogAvailable: true, models: [] }) },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { settings } } })] },
  })
  try {
    await expect.element(screen.getByText('Main 備援', { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: '設為啟用', exact: true })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: '移除', exact: true })).toBeDisabled()
  }
  finally { screen.unmount() }
})
