import type { SystemOneProfile } from '../../composables/useWebnaviorAiControl'

import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import stage from '../../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import SystemOneProfileDialog from './SystemOneProfileDialog.vue'
import SystemOneProfilePanel from './SystemOneProfilePanel.vue'

const global = { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage } } })] }

it('selects OpenAI Decisions during creation and saves the native API root without requiring model discovery', async () => {
  const onSave = vi.fn()
  const inspectRuntimeModel = vi.fn(async () => ({ modelId: 'gpt-6-luna', modelIds: ['gpt-6-luna'] }))
  const screen = render(SystemOneProfileDialog, { props: { busy: false, open: true, inspectRuntimeModel, onSave }, global })
  try {
    await screen.getByRole('combobox', { name: 'System One implementation', exact: true }).selectOptions('openai-decisions')
    await expect.element(screen.getByRole('textbox', { name: 'System One Base URL', exact: false })).toHaveValue('https://api.openai.com/v1')
    await expect.element(screen.getByRole('textbox', { name: 'Backend 模型識別', exact: true })).toHaveValue('gpt-6-luna')
    await screen.getByLabelText('OpenAI API Key（新增時必填）', { exact: true }).fill('synthetic-only')
    await screen.getByRole('button', { name: '儲存 System One profile', exact: true }).click()
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ implementation: 'openai-decisions', baseURL: 'https://api.openai.com/v1', modelId: 'gpt-6-luna', plaintextKey: 'synthetic-only' }))
    expect(inspectRuntimeModel).not.toHaveBeenCalled()
  }
  finally { screen.unmount() }
})

it('retains an existing encrypted key by omitting an empty replacement on edit', async () => {
  const profile: SystemOneProfile = { id: 'decision', name: 'OpenAI Decisions', implementation: 'openai-decisions', baseURL: 'https://api.openai.com/v1', modelId: 'gpt-6-luna', timeoutMs: 5000, hasApiKey: true, isActive: false, verifiedAt: null, lastCheckedAt: null, lastCheckError: null }
  const onUpdate = vi.fn()
  const screen = render(SystemOneProfileDialog, { props: { busy: false, open: true, profile, inspectRuntimeModel: async () => ({ modelId: 'gpt-6-luna' }), onUpdate }, global })
  try {
    await expect.element(screen.getByRole('textbox', { name: 'Backend 模型識別', exact: true })).toHaveValue('gpt-6-luna')
    await screen.getByRole('button', { name: '儲存變更', exact: true }).click()
    expect(onUpdate).toHaveBeenCalledWith('decision', expect.objectContaining({ implementation: 'openai-decisions' }))
    expect(onUpdate.mock.calls[0][1]).not.toHaveProperty('plaintextKey')
  }
  finally { screen.unmount() }
  const panel = render(SystemOneProfilePanel, { props: { busy: false, profiles: [profile] }, global })
  try {
    await expect.element(panel.getByText('OpenAI Decisions · gpt-6-luna · https://api.openai.com/v1', { exact: true })).toBeVisible()
  }
  finally { panel.unmount() }
})
