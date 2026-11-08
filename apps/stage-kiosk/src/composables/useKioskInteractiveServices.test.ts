import type { KioskProfile } from '../services/kiosk-device'

import { expect, it } from 'vitest'

import { applyKioskProfile, applyPendingOrderingSite, hasPendingOrderingSite, kioskInteractionProfile, queueOrderingSite } from './useKioskInteractiveServices'

const first = { id: 'original', title: '原店家', description: '', url: 'https://menu.test/menu/' }
const second = { id: 'supplier', title: '新店家', description: '', url: 'https://menu.test/menu/supplier.html' }
const profile: KioskProfile = { releaseId: 'release', name: 'Store bindings', snapshot: { assistanceReminderPrompt: '', agentInstructions: '', characterName: '點餐助手', greetingPrompt: '您好', interactiveService: first, orderingSites: [second], surveyUrl: 'https://survey.test/', version: 1, voiceConversationOnly: false } }

it('queues the saved merchant until the old ordering round has crossed its reset barrier', () => {
  applyKioskProfile(profile)
  queueOrderingSite(second)
  expect(hasPendingOrderingSite()).toBe(true)
  expect(kioskInteractionProfile.services.value[0]?.id).toBe(first.id)
  applyPendingOrderingSite()
  expect(kioskInteractionProfile.services.value[0]?.id).toBe(second.id)
  expect(kioskInteractionProfile.services.value).toHaveLength(1)
  expect(hasPendingOrderingSite()).toBe(false)
  queueOrderingSite(second)
  expect(hasPendingOrderingSite()).toBe(false)
  // A browser refresh restores the saved merchant directly, rather than reverting to the default.
  applyKioskProfile(profile, second.id)
  expect(kioskInteractionProfile.services.value[0]?.serviceUrl).toBe(second.url)
})

it('keeps the active merchant when a saved choice disappears instead of selecting another', () => {
  applyKioskProfile(profile, second.id)
  queueOrderingSite(undefined)
  expect(hasPendingOrderingSite()).toBe(true)
  expect(() => applyPendingOrderingSite()).toThrow('no longer published')
  expect(kioskInteractionProfile.services.value[0]?.id).toBe(second.id)
  queueOrderingSite(first)
  applyPendingOrderingSite()
  expect(kioskInteractionProfile.services.value[0]?.id).toBe(first.id)
})
