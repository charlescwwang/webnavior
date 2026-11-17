import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'
import { createI18n, useI18n } from 'vue-i18n'

import stageMessages from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskConversation from './KioskConversation.vue'

import { useKioskDecisionProgress } from '../composables/useKioskDecisionProgress'

it('paints text progress and elapsed time before the delayed model finishes, then removes the pending state', async () => {
  let progress!: ReturnType<typeof useKioskDecisionProgress>
  let complete!: () => void
  const delayedModel = new Promise<void>(resolve => complete = resolve)
  const screen = render(defineComponent({ setup() {
    const { t } = useI18n()
    progress = useKioskDecisionProgress()
    return () => h(KioskConversation, {
      assistantPresence: { mode: 'listening', title: '歡迎', description: '請點餐' },
      fontSize: 20,
      messages: [],
      sending: false,
      voiceConversationOnly: false,
      activityStatus: progress.state.value ? t(`stage.kiosk.service-recovery.${progress.state.value.messageKey}`) : undefined,
      executionDurationMs: progress.state.value?.elapsedMs,
      retryAvailable: progress.state.value?.retryable,
      onSimulateAsr: async () => {
        progress.start(1, 'simulation')
        await delayedModel
        progress.finish(1, { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' })
      },
    })
  } }), { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: stageMessages } } })] } })
  await screen.getByRole('textbox').fill('這個怎麼選')
  const submittedAt = performance.now()
  await screen.getByRole('button', { name: '模擬辨識並執行' }).click()
  // The floating test console repeats status text. Assert the customer's
  // conversation region so two valid status copies do not make this ambiguous.
  const conversation = screen.getByRole('region', { name: '與虛擬服務員對話' })
  await expect.element(conversation.getByText('正在確認您的意思…')).toBeVisible()
  expect(performance.now() - submittedAt).toBeLessThan(1000)
  expect(progress.state.value?.pending).toBe(true)
  // Hold the provider open while the actual browser paints and advances the clock.
  await expect.poll(() => progress.state.value?.elapsedMs).toBeGreaterThanOrEqual(250)
  await expect.element(screen.getByLabelText('本輪對話處理耗時')).toBeVisible()
  complete()
  await expect.element(conversation.getByText('剛才沒有理解清楚，請再說一次您的需求。')).toBeVisible()
  expect(progress.state.value?.pending).toBe(false)
  await expect.element(conversation.getByText('正在確認您的意思…')).not.toBeInTheDocument()
})
