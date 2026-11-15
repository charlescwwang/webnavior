import type { KioskCharacterSettings } from '@proj-airi/stage-shared/kiosk-character-package'

import type { KioskProfileDraft } from '../../composables/useKioskManagement'

import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import stage from '../../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import ProfilesPage from './profiles.vue'

const initialDraft: KioskProfileDraft = {
  id: 'draft-a',
  name: 'PB avatar test',
  snapshot: {
    version: 1,
    characterName: 'PB 助手',
    greetingPrompt: '歡迎',
    assistanceReminderPrompt: '需要協助嗎？',
    agentInstructions: '保留 PB 指示',
    interactiveService: { id: 'pb', title: 'PB', description: '點餐', url: 'https://app.esgpb.com/order/store/1kgJeql/pick_up/menu' },
    characterAsset: { id: 'old-vrm', format: 'vrm', name: '原角色.vrm', sha256: 'old-hash' },
    characterCard: { description: '原介紹', personality: '原個性', postHistoryInstructions: '原規則', scenario: '原情境', systemPrompt: '原人設' },
    voiceConversationOnly: false,
    surveyUrl: '',
  },
}

async function fixture(gate?: Promise<void>, packageCharacter?: KioskCharacterSettings, packageError = false) {
  let submitted: KioskProfileDraft | undefined
  let exported: KioskProfileDraft['snapshot'] | undefined
  let uploadCount = 0
  let publishCount = 0
  const asset = { id: 'uploaded', sha256: 'uploaded-hash', name: '新素材', format: 'vrm' }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname
    const method = init?.method ?? 'GET'
    if (path === '/api/admin/kiosk/sites')
      return Response.json([{ id: 'site-a', name: 'Alpha', interactionRetentionDays: 180 }, { id: 'site-b', name: 'Beta', interactionRetentionDays: 180 }])
    if (path.endsWith('/capabilities'))
      return Response.json({ canEditExperience: true, canPublishExperience: true, canEditTechnicalSettings: false, canManageDevices: false })
    if (path.endsWith('/devices'))
      return Response.json([])
    if (path.endsWith('/profile'))
      return Response.json({ drafts: [{ ...initialDraft, id: path.includes('/site-a/') ? 'draft-a' : 'draft-b', name: path.includes('/site-a/') ? initialDraft.name : 'Beta avatar test' }] })
    if (method === 'POST' && path.endsWith('/character-package/export')) {
      exported = JSON.parse(String(init?.body))
      return new Response('synthetic zip', { headers: { 'Content-Type': 'application/zip' } })
    }
    if (method === 'POST' && path.endsWith('/character-package/import')) {
      uploadCount++
      await gate
      if (packageError)
        return Response.json({ message: '角色套件已損壞' }, { status: 400 })
      return Response.json({ character: packageCharacter ?? { characterName: '套件角色', greetingPrompt: '套件招呼' } }, { status: 201 })
    }
    if (method === 'POST' && /\/(?:character|background|motion)-assets$/.test(path)) {
      uploadCount++
      await gate
      const format = path.endsWith('/motion-assets') ? 'vrma' : path.endsWith('/background-assets') ? 'png' : 'vrm'
      return Response.json({ asset: { ...asset, format }, card: { name: '新角色卡', first_mes: '角色卡招呼', description: '角色卡介紹', system_prompt: '角色卡指示' } })
    }
    if (method === 'PUT' && path.endsWith('/profile-draft')) {
      submitted = JSON.parse(String(init?.body)) as KioskProfileDraft
      return Response.json(submitted)
    }
    if (method === 'POST' && path.endsWith('/profile-draft/publish')) {
      publishCount++
      return new Response(null, { status: 204 })
    }
    return new Response('Unexpected fixture request', { status: 404 })
  })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/kiosk/profiles', component: ProfilesPage }] })
  await router.push('/admin/kiosk/profiles')
  const screen = render(ProfilesPage, { global: { plugins: [router, createPinia(), createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage } } })] } })
  await expect.element(screen.getByRole('button', { name: '發布到此店別', exact: true })).toBeEnabled()
  return { screen, router, submitted: () => submitted, exported: () => exported, uploadCount: () => uploadCount, publishCount: () => publishCount }
}

afterEach(() => vi.restoreAllMocks())

// User request (2026-11-11): connect PB's Admin character assets to its experience.
it.each([
  { kind: 'avatar', label: /更換虛擬角色/, name: 'avatar.vrm' },
  { kind: 'card', label: /匯入角色卡/, name: 'card.zip' },
  { kind: 'background', label: /自訂場景背景/, name: 'scene.png' },
  { kind: 'motion', label: /待機動作/, name: 'idle.vrma' },
])('preserves unsaved PB fields when uploading $kind, then explicitly publishes the merged draft', async ({ kind, label, name }) => {
  const { screen, submitted, publishCount } = await fixture()
  try {
    await screen.getByText('角色卡與虛擬角色', { exact: true }).click()
    await screen.getByLabelText('顧客看到的服務員名稱', { exact: true }).fill('編輯中的服務員')
    await screen.getByLabelText('角色介紹', { exact: true }).fill('編輯中的介紹')
    if (kind === 'background')
      await screen.getByText('服務場景', { exact: true }).click()
    await screen.getByLabelText(label).upload(new File(['synthetic asset'], name))
    await expect.element(screen.getByRole('button', { name: '發布到此店別', exact: true })).toBeEnabled()
    expect(publishCount()).toBe(0)
    await expect.element(screen.getByLabelText('顧客看到的服務員名稱', { exact: true })).toHaveValue(kind === 'card' ? '新角色卡' : '編輯中的服務員')
    await expect.element(screen.getByLabelText('角色介紹', { exact: true })).toHaveValue(kind === 'card' ? '角色卡介紹' : '編輯中的介紹')
    await screen.getByRole('button', { name: '發布到此店別', exact: true }).click()
    await expect.poll(publishCount).toBe(1)
    const saved = submitted()!
    expect(saved.snapshot.interactiveService).toEqual(initialDraft.snapshot.interactiveService)
    expect(saved.snapshot.agentInstructions).toBe('保留 PB 指示')
    expect(saved.snapshot.voiceConversationOnly).toBe(false)
    if (kind === 'avatar' || kind === 'card')
      expect(saved.snapshot.characterAsset?.id).toBe('uploaded')
    if (kind === 'background')
      expect(saved.snapshot.sceneBackground?.id).toBe('uploaded')
    if (kind === 'motion') {
      expect(saved.snapshot.motionPack?.idle?.id).toBe('uploaded')
      expect(saved.snapshot.idleMotion?.id).toBe('uploaded')
    }
  }
  finally { screen.unmount() }
})

it('does not attach a late upload to another selected Site', async () => {
  const gate = Promise.withResolvers<void>()
  const { screen, router, uploadCount, submitted } = await fixture(gate.promise)
  try {
    await screen.getByText('角色卡與虛擬角色', { exact: true }).click()
    await screen.getByLabelText(/更換虛擬角色/).upload(new File(['synthetic asset'], 'avatar.vrm'))
    await expect.poll(uploadCount).toBe(1)
    await router.push('/admin/kiosk/profiles?site=site-b')
    await expect.element(screen.getByRole('button', { name: /Beta avatar test/ })).toBeVisible()
    gate.resolve()
    await expect.element(screen.getByRole('button', { name: '儲存草稿', exact: true })).toBeEnabled()
    await screen.getByRole('button', { name: '儲存草稿', exact: true }).click()
    await expect.poll(() => submitted()?.id).toBe('draft-b')
    expect(submitted()?.snapshot.characterAsset?.id).toBe('old-vrm')
  }
  finally {
    gate.resolve()
    screen.unmount()
  }
})

it('downloads current unsaved character edits without saving or publishing', async () => {
  const downloads: Array<{ href: string, name: string }> = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ href: this.href, name: this.download })
  })
  const { screen, exported, submitted, publishCount } = await fixture()
  try {
    await screen.getByText('角色卡與虛擬角色', { exact: true }).click()
    await screen.getByLabelText('顧客看到的服務員名稱', { exact: true }).fill('尚未儲存的角色')
    await screen.getByLabelText('角色介紹', { exact: true }).fill('尚未儲存的人設')
    await screen.getByRole('button', { name: '下載角色套件', exact: true }).click()
    await expect.poll(() => downloads.length).toBe(1)
    expect(downloads[0].href).toMatch(/^blob:/)
    expect(downloads[0].name).toBe('尚未儲存的角色.webnavior-character.zip')
    expect(exported()?.characterName).toBe('尚未儲存的角色')
    expect(exported()?.characterCard?.description).toBe('尚未儲存的人設')
    expect(submitted()).toBeUndefined()
    expect(publishCount()).toBe(0)
  }
  finally { screen.unmount() }
})

it('imports a complete character while retaining local merchant settings and unsaved edits until explicit publish', async () => {
  const character: KioskCharacterSettings = {
    characterName: '套件角色',
    greetingPrompt: '套件招呼',
    greetingPhrases: ['套件歡迎詞'],
    characterCard: { description: '套件介紹', personality: '套件個性', scenario: '套件情境', systemPrompt: '套件指示', postHistoryInstructions: '套件規則' },
    characterAsset: { id: 'site-owned-import', format: 'live2d_zip', name: '角色.zip', sha256: 'a'.repeat(64) },
    sceneBackground: { id: 'imported-background', format: 'png', name: '背景.png', sha256: 'b'.repeat(64) },
  }
  const { screen, submitted, publishCount } = await fixture(undefined, character)
  try {
    await screen.getByText('角色卡與虛擬角色', { exact: true }).click()
    await screen.getByText('互動服務', { exact: true }).click()
    await screen.getByLabelText('服務名稱', { exact: true }).fill('未儲存的店別服務')
    await screen.getByLabelText(/上傳角色套件 ZIP/).upload(new File(['package'], 'character.zip'))
    await expect.element(screen.getByLabelText('顧客看到的服務員名稱', { exact: true })).toHaveValue('套件角色')
    expect(submitted()).toBeUndefined()
    expect(publishCount()).toBe(0)
    await screen.getByRole('button', { name: '發布到此店別', exact: true }).click()
    await expect.poll(publishCount).toBe(1)
    expect(submitted()?.snapshot.characterAsset?.id).toBe('site-owned-import')
    expect(submitted()?.snapshot.characterCard).toEqual(character.characterCard)
    expect(submitted()?.snapshot.sceneBackground?.id).toBe('imported-background')
    expect(submitted()?.snapshot.interactiveService).toEqual({ ...initialDraft.snapshot.interactiveService, title: '未儲存的店別服務' })
    expect(submitted()?.snapshot.agentInstructions).toBe('保留 PB 指示')
    expect(submitted()?.snapshot.assistanceReminderPrompt).toBe(initialDraft.snapshot.assistanceReminderPrompt)
    expect(submitted()?.snapshot.voiceConversationOnly).toBe(false)
  }
  finally { screen.unmount() }
})

it('clears the old model and card when importing a text-only character', async () => {
  const { screen, submitted } = await fixture()
  try {
    await screen.getByText('角色卡與虛擬角色', { exact: true }).click()
    await screen.getByLabelText(/上傳角色套件 ZIP/).upload(new File(['package'], 'character.zip'))
    await expect.element(screen.getByLabelText('顧客看到的服務員名稱', { exact: true })).toHaveValue('套件角色')
    await screen.getByRole('button', { name: '儲存草稿', exact: true }).click()
    await expect.poll(() => submitted()?.snapshot.characterName).toBe('套件角色')
    expect(submitted()?.snapshot.characterAsset).toBeUndefined()
    expect(submitted()?.snapshot.characterCard).toBeUndefined()
    expect(submitted()?.snapshot.interactiveService).toEqual(initialDraft.snapshot.interactiveService)
  }
  finally { screen.unmount() }
})

it('retains the original editor draft when a package import fails', async () => {
  const { screen, submitted } = await fixture(undefined, undefined, true)
  try {
    await screen.getByText('角色卡與虛擬角色', { exact: true }).click()
    await screen.getByLabelText('角色介紹', { exact: true }).fill('保留我的編輯')
    await screen.getByLabelText(/上傳角色套件 ZIP/).upload(new File(['bad package'], 'character.zip'))
    await expect.element(screen.getByRole('button', { name: '儲存草稿', exact: true })).toBeEnabled()
    await expect.element(screen.getByLabelText('角色介紹', { exact: true })).toHaveValue('保留我的編輯')
    await screen.getByRole('button', { name: '儲存草稿', exact: true }).click()
    await expect.poll(() => submitted()?.snapshot.characterCard?.description).toBe('保留我的編輯')
    expect(submitted()?.snapshot.characterAsset?.id).toBe('old-vrm')
  }
  finally { screen.unmount() }
})

it('does not apply a package response after switching Sites', async () => {
  const gate = Promise.withResolvers<void>()
  const { screen, router, uploadCount, submitted } = await fixture(gate.promise)
  try {
    await screen.getByText('角色卡與虛擬角色', { exact: true }).click()
    await screen.getByLabelText(/上傳角色套件 ZIP/).upload(new File(['package'], 'character.zip'))
    await expect.poll(uploadCount).toBe(1)
    await router.push('/admin/kiosk/profiles?site=site-b')
    await expect.element(screen.getByRole('button', { name: /Beta avatar test/ })).toBeVisible()
    gate.resolve()
    await expect.element(screen.getByRole('button', { name: '儲存草稿', exact: true })).toBeEnabled()
    await screen.getByRole('button', { name: '儲存草稿', exact: true }).click()
    await expect.poll(() => submitted()?.id).toBe('draft-b')
    expect(submitted()?.snapshot.characterName).toBe('PB 助手')
    expect(submitted()?.snapshot.characterAsset?.id).toBe('old-vrm')
  }
  finally {
    gate.resolve()
    screen.unmount()
  }
})
