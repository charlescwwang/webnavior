import type { KioskProfileDraft, KioskSiteManagementCapabilities } from '../../composables/useKioskManagement'

import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import deviceSettings from '../../../../../packages/i18n/src/locales/zh-Hant/deviceSettings.yaml'
import stage from '../../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskProfileEditor from './kioskProfileEditor.vue'

const capabilities: KioskSiteManagementCapabilities = { canManageDevices: true, canEditTechnicalSettings: true, canEditExperience: true, canPublishExperience: true }
const draft: KioskProfileDraft = {
  id: 'pb-draft',
  name: 'PB test',
  snapshot: {
    version: 1,
    characterName: 'PB 助手',
    agentInstructions: '保留 PB 指示',
    greetingPrompt: '歡迎',
    assistanceReminderPrompt: '需要協助嗎？',
    interactiveService: { id: 'pb', title: 'PB', description: '點餐', url: 'https://app.esgpb.com/order/store/1kgJeql/pick_up/menu' },
    surveyUrl: '',
    voiceConversationOnly: false,
    orderingSites: [],
  },
}
const global = { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage, deviceSettings } } })] }

it('edits and publishes discovery labels without changing the source draft or merchant facts', async () => {
  const onSave = vi.fn()
  const screen = render(KioskProfileEditor, { props: { busy: false, capabilities, draft, onSave }, global })
  try {
    await screen.getByText('互動服務', { exact: true }).click()
    await screen.getByRole('button', { name: '新增餐點別名／類別', exact: true }).click()
    await screen.getByLabelText('餐點完整品名', { exact: true }).fill('炸雞腿便當')
    await screen.getByLabelText('常用別名（例如：雞腿飯、雞腿）', { exact: true }).fill('雞腿飯、雞腿')
    await screen.getByLabelText('選餐類別（例如：便當、麵食）', { exact: true }).fill('便當')
    await screen.getByRole('button', { name: '儲存草稿', exact: true }).click()
    expect(onSave.mock.calls[0][0].draft.snapshot.interactiveService).toEqual({ ...draft.snapshot.interactiveService, catalogLabels: [{ name: '炸雞腿便當', aliases: ['雞腿飯', '雞腿'], category: '便當' }] })
    expect(draft.snapshot.interactiveService).not.toHaveProperty('catalogLabels')
  }
  finally { screen.unmount() }
})

// User report (2026-11-11): PB Admin needs the master's virtual-character integration.
it('shows site avatar, role-card and background uploads by default and retains PB settings when saving', async () => {
  const onSave = vi.fn()
  const screen = render(KioskProfileEditor, { props: { busy: false, capabilities, draft, onSave }, global })
  try {
    await screen.getByText('角色卡與虛擬角色', { exact: true }).click()
    expect(screen.container.querySelectorAll('input[type="file"]').length).toBe(4)
    await expect.element(screen.getByRole('button', { name: '下載角色套件', exact: true })).toBeVisible()
    await expect.element(screen.getByLabelText(/匯入角色卡/)).toBeVisible()
    await expect.element(screen.getByLabelText(/更換虛擬角色/)).toBeVisible()
    await screen.getByRole('button', { name: '儲存草稿', exact: true }).click()
    expect(onSave).toHaveBeenCalledWith({ draft, publish: false })
  }
  finally { screen.unmount() }
})

it.each([
  { name: 'template without an asset owner', allowAssetUpload: false, canEditExperience: true },
  { name: 'read-only site', allowAssetUpload: true, canEditExperience: false },
])('hides every asset upload for $name, including motion slots on an existing VRM', ({ allowAssetUpload, canEditExperience }) => {
  const screen = render(KioskProfileEditor, { props: {
    busy: false,
    capabilities: { ...capabilities, canEditExperience },
    allowAssetUpload,
    draft: { ...draft, snapshot: { ...draft.snapshot, characterAsset: { id: 'vrm', sha256: 'hash', format: 'vrm', name: '角色.vrm' } } },
  }, global })
  try {
    expect(screen.container.querySelectorAll('input[type="file"]').length).toBe(0)
    expect(screen.getByRole('button', { name: '下載角色套件', exact: true }).elements()).toHaveLength(0)
  }
  finally { screen.unmount() }
})
