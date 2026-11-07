<script setup lang="ts">
import type { InteractiveServiceOrderResult } from '@proj-airi/stage-shared/interaction-lifecycle'

import type { FeedbackInvitationSettings } from '../feedback-invitation/settings'

import QRCode from 'qrcode'

import { errorMessageFrom } from '@moeru/std'
import { formatOrderingPrice } from '@proj-airi/stage-shared/kiosk-conversation'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { canShowFeedbackInvitation, normalizeFeedbackInvitationDuration } from '../feedback-invitation/settings'

const props = defineProps<{
  settings: FeedbackInvitationSettings
  orderResult?: InteractiveServiceOrderResult
  /** Transient order capability, kept separate from the configured static survey URL. */
  orderContinuationUrl?: string
}>()

const emit = defineEmits<{
  finish: []
}>()

const { t } = useI18n()
const qrCodeDataUrl = shallowRef('')
const qrCodeError = shallowRef('')
const orderQrCodeDataUrl = shallowRef('')
const orderQrCodeError = shallowRef('')
const hasSurvey = computed(() => canShowFeedbackInvitation(props.settings))
const durationSeconds = computed(() => hasSurvey.value || props.orderContinuationUrl
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
watch(() => props.orderContinuationUrl, async (url, _previous, onCleanup) => {
  let current = true
  onCleanup(() => current = false)
  orderQrCodeDataUrl.value = ''
  orderQrCodeError.value = ''
  if (!url)
    return
  try {
    const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 512 })
    if (current)
      orderQrCodeDataUrl.value = dataUrl
  }
  catch {
    if (current)
      orderQrCodeError.value = t('stage.customer-session.completion.order-qr-error')
  }
}, { immediate: true })
watch(durationSeconds, startCountdown, { immediate: true })
onScopeDispose(clearCountdown)
</script>

<template>
  <Teleport to="body">
    <section class="customer-session-completion" role="dialog" aria-modal="true" :aria-label="t('stage.customer-session.completion.title')">
      <article :class="['completion-card', { 'has-order-continuation': orderContinuationUrl }]">
        <div class="i-solar:check-circle-bold-duotone completion-icon" aria-hidden="true" />
        <h2>{{ t('stage.customer-session.completion.title') }}</h2>
        <p class="completion-description">
          {{ t('stage.customer-session.completion.description') }}
        </p>

        <section v-if="orderResult" :class="['completion-option']" aria-live="polite">
          <template v-if="orderResult.serviceMode === 'table-service'">
            <h3>{{ t('stage.customer-session.completion.table-number') }} <strong :class="['table-number']">{{ orderResult.table?.label.toUpperCase() }}</strong></h3>
            <ul :class="['text-left']">
              <li v-for="(line, index) in orderResult.lines" :key="index">
                {{ line.name }} × {{ line.quantity }} · {{ formatOrderingPrice(line.total) }}
              </li>
            </ul>
            <strong>{{ t('stage.customer-session.completion.total') }} {{ formatOrderingPrice(orderResult.total) }}</strong>
          </template>
          <template v-else-if="orderResult.pickupNumber">
            <h3>{{ t('stage.customer-session.completion.pickup-number') }}</h3>
            <strong :class="['text-6xl font-bold tabular-nums']">{{ orderResult.pickupNumber }}</strong>
          </template>
          <details v-if="orderResult.posOrderId" :class="['order-reference']">
            <summary>{{ t('stage.customer-session.completion.order-number') }}</summary>
            <span>{{ orderResult.posOrderId }}</span>
          </details>
          <p v-if="orderResult.serviceMode !== 'table-service' && !orderResult.pickupNumber" :class="['survey-description']">
            {{ t('stage.customer-session.completion.pickup-unavailable') }}
          </p>
          <p v-if="orderResult.environment === 'test'" :class="['simulation-notice']">
            {{ t('stage.customer-session.completion.simulated-notice') }}
          </p>
        </section>

        <div v-if="hasSurvey || orderContinuationUrl" :class="['completion-options']">
          <section v-if="hasSurvey" :class="['completion-option']">
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
          </section>
          <section v-if="orderContinuationUrl" :class="['completion-option']">
            <h3>{{ t('stage.customer-session.completion.order-title') }}</h3>
            <p :class="['survey-description']">
              {{ t('stage.customer-session.completion.order-description') }}
            </p>
            <div :class="['qr-code-frame']">
              <img v-if="orderQrCodeDataUrl" :class="['qr-code']" :src="orderQrCodeDataUrl" :alt="t('stage.customer-session.completion.order-qr-alt')">
              <p v-else :class="['qr-code-status']" role="status">
                {{ orderQrCodeError || t('stage.customer-session.completion.order-qr-loading') }}
              </p>
            </div>
            <a :href="orderContinuationUrl" target="_blank" rel="noopener noreferrer" :class="['order-link']">{{ t('stage.customer-session.completion.order-link') }}</a>
          </section>
        </div>

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
.completion-card.has-order-continuation {
  width: min(52rem, 100%);
}

.completion-card {
  max-height: calc(100dvh - 2.5rem);
  overflow-y: auto;
}

.completion-options {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
  gap: 1.5rem;
  border-top: 1px solid rgb(23 48 50 / 12%);
  padding-top: 1rem;
}

.completion-option {
  display: grid;
  justify-items: center;
  align-content: start;
  gap: .85rem;
}

.order-link {
  color: #a9401f;
  text-decoration: underline;
}

.customer-session-completion { position: fixed; z-index: 200; inset: 0; display: grid; place-items: center; padding: 1.25rem; background: rgb(2 12 14 / 76%); backdrop-filter: blur(.7rem); }
.completion-card { display: grid; width: min(31rem, 100%); justify-items: center; gap: .85rem; border: 1px solid rgb(255 255 255 / 22%); border-radius: 1.75rem; padding: 2rem; color: #173032; background: #fffaf2; box-shadow: 0 2rem 6rem rgb(0 0 0 / 45%); text-align: center; }
.completion-icon { color: #3d9e63; font-size: 3rem; }.completion-card h2, .completion-card h3 { margin: 0; }.completion-card h2 { font-size: 1.65rem; }.completion-card h3 { font-size: 1.15rem; }.completion-description, .survey-description { max-width: 26rem; margin: -.2rem 0 0; color: #5a6b69; line-height: 1.6; }.survey-divider { width: 100%; border-top: 1px solid rgb(23 48 50 / 12%); margin-top: .2rem; }.qr-code-frame { display: grid; width: min(15rem, 100%); min-height: 15rem; place-items: center; border-radius: 1rem; padding: .8rem; background: #fff; box-shadow: inset 0 0 0 1px rgb(23 48 50 / 8%); }.qr-code { display: block; width: 100%; height: auto; image-rendering: pixelated; }.qr-code-status { margin: 0; color: #8b3f25; line-height: 1.5; }.countdown { margin: 0; color: #6a7c79; font-size: .9rem; }.finish-button { width: min(20rem, 100%); border: 0; border-radius: .9rem; padding: .8rem 1rem; color: #fff; background: #df5529; box-shadow: 0 .45rem 1rem rgb(191 62 24 / 24%); cursor: pointer; font: inherit; font-weight: 700; }.finish-button:hover, .finish-button:focus-visible { background: #c9451e; }
@media (max-width: 420px) { .completion-card { padding: 1.5rem; }.qr-code-frame { min-height: 13rem; } }
.table-number { display: block; margin-top: .35rem; font-size: 2.5rem; font-variant-numeric: tabular-nums; }.order-reference { max-width: 100%; color: #6a7c79; font-size: .75rem; overflow-wrap: anywhere; }.order-reference summary { cursor: pointer; }.simulation-notice { max-width: 26rem; margin: 0; color: #6a7c79; font-size: .75rem; line-height: 1.5; }
</style>
