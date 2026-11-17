import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { useKioskManagement } from './useKioskManagement'

afterEach(() => vi.restoreAllMocks())

// Report: this chat Nov17 — live monitoring must preserve the operator's view without touching kiosk work.
it('refreshes in the background and ignores a late response after the operator changes sessions', async () => {
  let completeOld!: (response: Response) => void
  let hold = false
  let recognized = false
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/visitor-sessions?'))
      return Response.json([])
    if (url.endsWith('/visitor-sessions/a') && hold)
      return new Promise<Response>(resolve => completeOld = resolve)
    return Response.json({ session: { id: url.endsWith('/a') ? 'a' : 'b' }, entries: recognized ? [{ id: 'transcript', kind: 'asr_transcript', content: '已辨識文字', sequence: 1, metadata: {}, createdAt: '2026-11-17T00:00:00Z' }] : [], media: [] })
  })
  let management!: ReturnType<typeof useKioskManagement>
  const screen = render(defineComponent({ setup() {
    management = useKioskManagement()
    return () => h('div')
  } }), { global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] } })
  try {
    management.selectedSiteId.value = 'site'
    await management.selectVisitorSession('a')
    recognized = true
    await management.refreshVisitorHistory('device', new AbortController().signal)
    expect(management.visitorSessionDetail.value?.entries[0].content).toBe('已辨識文字')
    hold = true
    const updating = management.refreshVisitorHistory('device', new AbortController().signal)
    await vi.waitFor(() => expect(completeOld).toBeTypeOf('function'))
    expect(management.visitorHistoryLoading.value).toBe(false)
    expect(management.visitorSessionDetail.value?.session.id).toBe('a')
    await management.selectVisitorSession('b')
    completeOld(Response.json({ session: { id: 'a' }, entries: [], media: [] }))
    await updating
    expect(management.visitorSessionDetail.value?.session.id).toBe('b')
    expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  }
  finally {
    management.selectedSiteId.value = ''
    screen.unmount()
  }
})
