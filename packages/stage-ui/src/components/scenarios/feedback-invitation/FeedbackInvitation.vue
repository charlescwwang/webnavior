<script setup lang="ts">
import type { FeedbackInvitationSettings } from './settings'

import QRCode from 'qrcode'

import { errorMessageFrom } from '@moeru/std'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import { normalizeFeedbackInvitationDuration } from './settings'

const props = defineProps<{
  settings: FeedbackInvitationSettings
}>()

const emit = defineEmits<{
  finish: []
}>()

const qrCodeDataUrl = shallowRef('')
const qrCodeError = shallowRef('')
const secondsRemaining = shallowRef(normalizeFeedbackInvitationDuration(props.settings.displayDurationSeconds))
let countdownTimer: ReturnType<typeof setInterval> | undefined

const durationSeconds = computed(() => normalizeFeedbackInvitationDuration(props.settings.displayDurationSeconds))

function clearCountdown() {
  if (countdownTimer)
    clearInterval(countdownTimer)
  countdownTimer = undefined
}

function finish() {
  clearCountdown()
  emit('finish')
}

async function generateQrCode(url: string) {
  qrCodeError.value = ''
  qrCodeDataUrl.value = ''
  try {
    qrCodeDataUrl.value = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 512,
    })
  }
  catch (error) {
    qrCodeError.value = '問卷 QR Code 暫時無法產生。'
    console.error('[feedback-invitation] failed to generate QR code:', errorMessageFrom(error))
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

watch(() => props.settings.surveyUrl, url => void generateQrCode(url), { immediate: true })
watch(durationSeconds, startCountdown, { immediate: true })
onScopeDispose(clearCountdown)
</script>

<template>
  <Teleport to="body">
    <section class="feedback-invitation" role="dialog" aria-modal="true" :aria-label="settings.title">
      <article class="invitation-card">
        <div class="invitation-icon i-solar:qr-code-bold-duotone" aria-hidden="true" />
        <h2 class="invitation-title">
          {{ settings.title }}
        </h2>
        <p class="invitation-description">
          {{ settings.description }}
        </p>

        <div class="qr-code-frame">
          <img v-if="qrCodeDataUrl" class="qr-code" :src="qrCodeDataUrl" alt="問卷 QR Code">
          <p v-else class="qr-code-status" role="status">
            {{ qrCodeError || '正在準備問卷 QR Code…' }}
          </p>
        </div>

        <p class="countdown" aria-live="polite">
          此畫面將在 {{ secondsRemaining }} 秒後自動結束
        </p>
        <button type="button" class="dismiss-button" @click="finish">
          {{ settings.dismissLabel }}
        </button>
      </article>
    </section>
  </Teleport>
</template>

<style scoped>
.feedback-invitation { position: fixed; z-index: 200; inset: 0; display: grid; place-items: center; padding: 1.25rem; background: rgb(2 12 14 / 76%); backdrop-filter: blur(.7rem); }
.invitation-card { display: grid; width: min(31rem, 100%); justify-items: center; gap: 1rem; border: 1px solid rgb(255 255 255 / 22%); border-radius: 1.75rem; padding: 2rem; color: #173032; background: #fffaf2; box-shadow: 0 2rem 6rem rgb(0 0 0 / 45%); text-align: center; }
.invitation-icon { color: #dd5529; font-size: 2.7rem; }
.invitation-title { margin: 0; font-size: 1.65rem; }
.invitation-description { max-width: 26rem; margin: -.35rem 0 0; color: #5a6b69; line-height: 1.6; }
.qr-code-frame { display: grid; width: min(17rem, 100%); min-height: 17rem; place-items: center; border-radius: 1rem; padding: .8rem; background: #fff; box-shadow: inset 0 0 0 1px rgb(23 48 50 / 8%); }
.qr-code { display: block; width: 100%; height: auto; image-rendering: pixelated; }
.qr-code-status { margin: 0; color: #8b3f25; line-height: 1.5; }
.countdown { margin: -.25rem 0 0; color: #6a7c79; font-size: .9rem; }
.dismiss-button { width: min(20rem, 100%); border: 0; border-radius: .9rem; padding: .8rem 1rem; color: #fff; background: #df5529; box-shadow: 0 .45rem 1rem rgb(191 62 24 / 24%); cursor: pointer; font: inherit; font-weight: 700; }
.dismiss-button:hover, .dismiss-button:focus-visible { background: #c9451e; }
@media (max-width: 420px) { .invitation-card { padding: 1.5rem; } .qr-code-frame { min-height: 14rem; } }
</style>
