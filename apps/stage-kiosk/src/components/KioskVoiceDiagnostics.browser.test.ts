import type { KioskVoiceDiagnosticEntry } from './KioskVoiceDiagnostics.vue'

import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import zhHant from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskVoiceDiagnostics from './KioskVoiceDiagnostics.vue'

// Report: this chat,2026-11-05 — VAD5/5,all starts blocked,but voice diagnostics empty.
it('shows received speech before ASR and keeps one row when the same speech is blocked', async () => {
  const entries = shallowRef<KioskVoiceDiagnosticEntry[]>([{ id: 1, status: 'capturing' }])
  const view = render(defineComponent({ setup: () => () => h(KioskVoiceDiagnostics, { entries: entries.value }) }), { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  await expect.element(view.getByText('已偵測到語音，等待句尾')).toBeVisible()
  await expect.element(view.getByText('最近 1 段')).toBeVisible()
  entries.value = [{ id: 1, status: 'blocked', reason: 'low_quality', stage: 'speech_start' }]
  await expect.element(view.getByText('已收到語音，尚未送出 ASR')).toBeVisible()
  await expect.element(view.getByText('人物偵測品質未達放行門檻')).toBeVisible()
  await expect.element(view.getByText('最近 1 段')).toBeVisible()
})

it('distinguishes pre-ASR blocking from a completed ASR result rejected later', async () => {
  const view = render(KioskVoiceDiagnostics, { props: { entries: [{ id: 1, status: 'blocked', reason: 'outside_zone', stage: 'speech_end' }, { id: 2, status: 'ignored', text: '水餃一份', reason: 'stale', stage: 'after_asr' }] }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  await expect.element(view.getByText('已收到語音，尚未送出 ASR')).toBeVisible()
  await expect.element(view.getByText('語音放行檢查未通過，已忽略')).toBeVisible()
  await expect.element(view.getByText('有效人物觀測已過期')).toBeVisible()
  await expect.element(view.getByText('「水餃一份」')).toBeVisible()
})

it('reports queue/capture rejection without calling it an absence of people', async () => {
  const view = render(KioskVoiceDiagnostics, { props: { entries: [{ id: 1, status: 'blocked', reason: 'queue_full', stage: 'speech_end' }, { id: 2, status: 'blocked', reason: 'capture_stopped', stage: 'capture' }] }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  await expect.element(view.getByText('語音處理佇列已滿')).toBeVisible()
  await expect.element(view.getByText('收音已停止或重新啟動')).toBeVisible()
})
