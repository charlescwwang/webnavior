<script setup lang="ts">
import type { FeedbackInvitationSettings } from '../feedback-invitation/settings'

import QRCode from 'qrcode'

import { errorMessageFrom } from '@moeru/std'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { canShowFeedbackInvitation, normalizeFeedbackInvitationDuration } from '../feedback-invitation/settings'

const props = defineProps<{
  settings: FeedbackInvitationSettings
}>()

const emit = defineEmits<{
  finish: []
}>()

const { t } = useI18n()
const qrCodeDataUrl = shallowRef('')
const qrCodeError = shallowRef('')
const hasSurvey = computed(() => canShowFeedbackInvitation(props.settings))
const durationSeconds = computed(() => hasSurvey.value
  ? normalizeFeedbackInvitationDuration(props.settings.displayDurationSeconds)
  : 10)
const secondsRemaining = shallowRef(durationSeconds.value)
let countdownTimer: ReturnType<typeof setInterval> | undefined

function clearCountdown() {
  if (countdownTimer)
    clearInterval(countdownTimer)
  countdownTimer = undefined
}

function finish() {
  clearCountdown()
  emit('finish')
}

async function generateQrCode() {
  qrCodeError.value = ''
  qrCodeDataUrl.value = ''
  if (!hasSurvey.value)
    return

  try {
    qrCodeDataUrl.value = await QRCode.toDataURL(props.settings.surveyUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 512,
    })
  }
  catch (error) {
    qrCodeError.value = t('stage.customer-session.completion.qr-error')
    console.error('[customer-session-completion] failed to generate QR code:', errorMessageFrom(error))
  }
}

function startCountdown() {
  clearCountdown()
  secondsRemaining.value = durationSeconds.value
  countdownTimer = setInterval(() => {
    if (secondsRemaining.value <= 1) {
      finish()
      return
    }
    secondsRemaining.value -= 1
  }, 1_000)
}

watch([hasSurvey, () => props.settings.surveyUrl], () => void generateQrCode(), { immediate: true })
watch(durationSeconds, startCountdown, { immediate: true })
onScopeDispose(clearCountdown)
</script>

<template>
  <Teleport to="body">
    <section class="customer-session-completion" role="dialog" aria-modal="true" :aria-label="t('stage.customer-session.completion.title')">
      <article class="completion-card">
        <div class="i-solar:check-circle-bold-duotone completion-icon" aria-hidden="true" />
        <h2>{{ t('stage.customer-session.completion.title') }}</h2>
        <p class="completion-description">
          {{ t('stage.customer-session.completion.description') }}
        </p>
        <p class="completion-notice">
          {{ t('stage.customer-session.completion.simulated-notice') }}
        </p>

        <template v-if="hasSurvey">
          <div class="survey-divider" aria-hidden="true" />
          <h3>{{ settings.title }}</h3>
          <p class="survey-description">
            {{ settings.description }}
          </p>
          <div class="qr-code-frame">
            <img v-if="qrCodeDataUrl" class="qr-code" :src="qrCodeDataUrl" :alt="t('stage.customer-session.completion.qr-alt')">
            <p v-else class="qr-code-status" role="status">
              {{ qrCodeError || t('stage.customer-session.completion.qr-loading') }}
            </p>
          </div>
        </template>

        <p class="countdown" aria-live="polite">
          {{ t('stage.customer-session.completion.countdown', { seconds: secondsRemaining }) }}
        </p>
        <button type="button" class="finish-button" @click="finish">
          {{ hasSurvey ? settings.dismissLabel : t('stage.customer-session.completion.finish') }}
        </button>
      </article>
    </section>
  </Teleport>
</template>

<style scoped>
.customer-session-completion { position: fixed; z-index: 200; inset: 0; display: grid; place-items: center; padding: 1.25rem; background: rgb(2 12 14 / 76%); backdrop-filter: blur(.7rem); }
.completion-card { display: grid; width: min(31rem, 100%); justify-items: center; gap: .85rem; border: 1px solid rgb(255 255 255 / 22%); border-radius: 1.75rem; padding: 2rem; color: #173032; background: #fffaf2; box-shadow: 0 2rem 6rem rgb(0 0 0 / 45%); text-align: center; }
.completion-icon { color: #3d9e63; font-size: 3rem; }.completion-card h2, .completion-card h3 { margin: 0; }.completion-card h2 { font-size: 1.65rem; }.completion-card h3 { font-size: 1.15rem; }.completion-description, .survey-description { max-width: 26rem; margin: -.2rem 0 0; color: #5a6b69; line-height: 1.6; }.completion-notice { margin: 0; border-radius: .7rem; padding: .65rem .8rem; color: #8b3f25; background: #fff0df; font-size: .86rem; line-height: 1.5; }.survey-divider { width: 100%; border-top: 1px solid rgb(23 48 50 / 12%); margin-top: .2rem; }.qr-code-frame { display: grid; width: min(15rem, 100%); min-height: 15rem; place-items: center; border-radius: 1rem; padding: .8rem; background: #fff; box-shadow: inset 0 0 0 1px rgb(23 48 50 / 8%); }.qr-code { display: block; width: 100%; height: auto; image-rendering: pixelated; }.qr-code-status { margin: 0; color: #8b3f25; line-height: 1.5; }.countdown { margin: 0; color: #6a7c79; font-size: .9rem; }.finish-button { width: min(20rem, 100%); border: 0; border-radius: .9rem; padding: .8rem 1rem; color: #fff; background: #df5529; box-shadow: 0 .45rem 1rem rgb(191 62 24 / 24%); cursor: pointer; font: inherit; font-weight: 700; }.finish-button:hover, .finish-button:focus-visible { background: #c9451e; }
@media (max-width: 420px) { .completion-card { padding: 1.5rem; }.qr-code-frame { min-height: 13rem; } }
</style>
