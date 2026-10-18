import type { KioskProfileDraft } from '../../../stage-web/src/composables/useKioskManagement'

import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import KioskProfileEditor from '../../../stage-web/src/components/Webnavior/kioskProfileEditor.vue'

const draft: KioskProfileDraft = {
  name: 'Test experience',
  snapshot: {
    version: 1,
    characterName: 'Assistant',
    agentInstructions: '',
    assistanceReminderPrompt: 'Offer help.',
    greetingPrompt: 'VLM opening instructions',
    greetingPhrases: ['Original welcome'],
    interactiveService: { id: 'ordering', title: 'Menu', description: 'Test menu', url: 'https://example.com/menu' },
    surveyUrl: 'https://example.com/survey',
    voiceConversationOnly: false,
  },
}
const capabilities = { canEditExperience: true, canEditTechnicalSettings: true, canManageDevices: false, canPublishExperience: true }
const messages = { en: { stage: { kiosk: { welcome: {
  'section-title': 'Welcome',
  'section-description': 'Choose a mode and edit its content.',
  'content-description': 'Edit both welcome configurations.',
  'mode-label': 'Welcome mode',
  'mode-fixed': 'Fixed phrases',
  'mode-vlm': 'VLM generation',
  'mode-save-hint': 'Mode saves immediately. Publish text changes.',
  'vlm-description': 'Choose fixed or generated welcomes.',
  'editor-label': 'Fixed welcome text',
  'editor-hint': 'One phrase per line.',
  'count': '{count} phrases, up to {limit} allowed.',
  'too-many': 'There are {count} fixed welcome phrases. The limit is {limit}.',
  'too-long': 'Each phrase allows up to {limit} characters.',
  'vlm-prompt-label': 'VLM guidance',
  'vlm-prompt-hint': 'Write opening instructions.',
} } } } }

it('keeps mode and content together while preserving unsaved edits across switches', async () => {
  const vlm = shallowRef(false)
  const changed = vi.fn((enabled: boolean) => {
    vlm.value = enabled
  })
  const saved = vi.fn()
  const screen = render(defineComponent({ setup: () => () => h(KioskProfileEditor, { busy: false, draft, capabilities, proactiveVlmEnabled: vlm.value, onUpdateProactiveVlm: changed, onSave: saved }) }), { global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] } })
  try {
    await screen.getByRole('textbox', { name: /Fixed welcome text/ }).fill('Edited welcome')
    await expect.element(screen.getByRole('textbox', { name: /VLM guidance/ })).not.toBeInTheDocument()
    await screen.getByRole('combobox').click()
    await screen.getByRole('option', { name: 'VLM generation' }).click()
    expect(changed).toHaveBeenLastCalledWith(true)
    await expect.element(screen.getByRole('textbox', { name: /Fixed welcome text/ })).not.toBeInTheDocument()
    await screen.getByRole('textbox', { name: /VLM guidance/ }).fill('Edited VLM instructions')
    await screen.getByRole('combobox').click()
    await screen.getByRole('option', { name: 'Fixed phrases' }).click()
    expect(changed).toHaveBeenLastCalledWith(false)
    await expect.element(screen.getByRole('textbox', { name: /Fixed welcome text/ })).toHaveValue('Edited welcome')
    await screen.getByRole('combobox').click()
    await screen.getByRole('option', { name: 'VLM generation' }).click()
    await expect.element(screen.getByRole('textbox', { name: /VLM guidance/ })).toHaveValue('Edited VLM instructions')
    await screen.getByRole('button', { name: '儲存草稿' }).click()
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ publish: false, draft: expect.objectContaining({ snapshot: expect.objectContaining({ greetingPhrases: ['Edited welcome'], greetingPrompt: 'Edited VLM instructions' }) }) }))
    expect(draft.snapshot.greetingPhrases).toEqual(['Original welcome'])
    expect(draft.snapshot.greetingPrompt).toBe('VLM opening instructions')
  }
  finally {
    screen.unmount()
  }
})

it('lets an experience template edit both phrase banks without a site-owned mode', async () => {
  const screen = render(KioskProfileEditor, { props: { busy: false, draft, capabilities }, global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] } })
  try {
    await expect.element(screen.getByRole('textbox', { name: /Fixed welcome text/ })).toHaveValue('Original welcome')
    await expect.element(screen.getByRole('textbox', { name: /VLM guidance/ })).toHaveValue('VLM opening instructions')
    await expect.element(screen.getByRole('combobox')).not.toBeInTheDocument()
  }
  finally {
    screen.unmount()
  }
})

it('saves twelve phrases and explains limits before submitting invalid content', async () => {
  const saved = vi.fn()
  const screen = render(KioskProfileEditor, { props: { busy: false, draft, capabilities, proactiveVlmEnabled: false, onSave: saved }, global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] } })
  try {
    const phrases = Array.from({ length: 12 }, (_, index) => `Welcome ${index + 1}`)
    await screen.getByRole('textbox', { name: /Fixed welcome text/ }).fill(phrases.join('\n'))
    await expect.element(screen.getByText('12 phrases, up to 50 allowed.', { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: '儲存草稿' })).toBeEnabled()
    await screen.getByRole('button', { name: '儲存草稿' }).click()
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ snapshot: expect.objectContaining({ greetingPhrases: phrases }) }) }))
    await screen.getByRole('textbox', { name: /Fixed welcome text/ }).fill(Array.from({ length: 51 }, (_, index) => `Welcome ${index + 1}`).join('\n'))
    await expect.element(screen.getByRole('alert')).toHaveTextContent('There are 51 fixed welcome phrases. The limit is 50.')
    await expect.element(screen.getByRole('button', { name: '儲存草稿' })).toBeDisabled()
    await screen.getByRole('textbox', { name: /Fixed welcome text/ }).fill('A'.repeat(501))
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Each phrase allows up to 500 characters.')
    await expect.element(screen.getByRole('button', { name: '儲存草稿' })).toBeDisabled()
    await screen.getByRole('textbox', { name: /Fixed welcome text/ }).fill('A valid welcome')
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: '儲存草稿' })).toBeEnabled()
  }
  finally {
    screen.unmount()
  }
})
