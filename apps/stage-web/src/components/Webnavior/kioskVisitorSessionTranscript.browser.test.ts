import type { KioskInteractionEntry, KioskVisitorMedia } from '../../composables/useKioskManagement'

import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import KioskVisitorSessionTranscript from './kioskVisitorSessionTranscript.vue'

// Report: Nov14 user audit; time/position matching attached recordings to the wrong transcript.
it('retains repeated customer phrases and only attaches explicitly linked audio', async () => {
  const createdAt = '2026-11-14T00:00:00Z'
  const entries: KioskInteractionEntry[] = [
    { id: 'text-1', kind: 'asr_transcript', content: '兩份', metadata: { utteranceId: 1 }, sequence: 1, createdAt },
    { id: 'user-1', kind: 'user_text', content: '兩份', metadata: { utteranceId: 1 }, sequence: 2, createdAt },
    { id: 'text-2', kind: 'asr_transcript', content: '兩份', metadata: { utteranceId: 2 }, sequence: 3, createdAt },
    { id: 'user-2', kind: 'user_text', content: '兩份', metadata: { utteranceId: 2 }, sequence: 4, createdAt },
  ]
  const base = { byteSize: 100, createdAt, endedAt: null, startedAt: null, kind: 'audio_recording' as const, mimeType: 'audio/wav' }
  const media: KioskVisitorMedia[] = [{ ...base, id: 'old-unlinked', interactionEntryId: 'activity' }, { ...base, id: 'correct', interactionEntryId: 'text-1' }]
  const screen = render(KioskVisitorSessionTranscript, { props: { detail: { session: { id: 'visitor' }, entries, media } }, global: { plugins: [createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: { stage: { kiosk: { 'media-unlinked': 'Unlinked audio', 'media-audio-list': 'Original recordings', 'media-play': 'Play original' } } } } })] } })
  expect(screen.container.querySelectorAll('pre')).toHaveLength(2)
  expect([...screen.container.querySelectorAll('button')].filter(button => button.textContent?.includes('聽顧客原始語音'))).toHaveLength(1)
  await expect.element(screen.getByText('Unlinked audio')).toBeVisible()
  expect([...screen.container.querySelectorAll('button')].filter(button => button.textContent === 'Play original')).toHaveLength(2)
})
