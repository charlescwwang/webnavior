<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

import type { PaymentMethod, PaymentStatus } from '../pos-bridge'

import { computed, onMounted } from 'vue'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { usePaymentSimulation } from '../composables/usePaymentSimulation'
import { paymentLabels, testPaymentMethods } from '../pos-bridge'

const props = defineProps<{ error?: string, method?: PaymentMethod, status?: PaymentStatus, total: string }>()
const emit = defineEmits<{ registerControl: [id: string, element: Element | ComponentPublicInstance | null], cancel: [], back: [], changeMethod: [], select: [method: PaymentMethod], simulate: [] }>()
const copy = orderingMessages['zh-Hant'].payment
const selection = computed(() => props.method && props.status === undefined && !props.error ? { method: props.method, total: props.total } : undefined)
const { qr, error: qrError, remaining, start } = usePaymentSimulation(() => selection.value, () => emit('simulate'))
onMounted(start)
</script>

<template>
  <section :class="['checkout-step']" aria-labelledby="payment-heading">
    <header>
      <h2 id="payment-heading">
        {{ method ? copy.scanTitle.replace('{method}', paymentLabels[method]) : copy.chooseTitle }}
      </h2>
    </header>
    <p v-if="error" role="alert">
      {{ error }}
    </p>
    <template v-if="status !== 'pending' && status !== 'uncertain' && status !== 'authorized'">
      <template v-if="!method">
        <p>{{ copy.methodHint }}</p>
      </template>
      <!-- Keep the same controls available while the unpaid QR is visible so
           touch and voice can both change the selected method. -->
      <div :class="['payment-options']">
        <button v-for="choice in testPaymentMethods" :key="choice" :ref="element => emit('registerControl', `checkout:payment:${choice}`, element)" type="button" :aria-pressed="method === choice" @click="emit('select', choice)">
          {{ paymentLabels[choice] }}
        </button>
      </div>
      <template v-if="method">
        <p role="status">
          {{ copy.waiting }}
        </p>
        <p>{{ copy.scanHint }}</p>
        <figure v-if="!status && !error" :class="['test-payment-qr']">
          <strong>{{ copy.testOnly }}</strong>
          <img v-if="qr" :src="qr" width="240" height="240" :alt="copy.qrAlt">
          <p v-else-if="!qrError">
            {{ copy.generatingQr }}
          </p>
          <figcaption>{{ copy.simulationHint }}</figcaption>
          <p v-if="qr" role="status" aria-live="polite">
            {{ copy.countdown.replace('{seconds}', String(remaining)) }}
          </p>
          <p v-if="qrError" role="alert">
            {{ copy.qrError }}
          </p>
        </figure>
        <button type="button" @click="emit('changeMethod')">
          {{ copy.changeMethod }}
        </button>
      </template>
    </template>
    <template v-else-if="status === 'uncertain'">
      <h3>{{ copy.uncertainTitle }}</h3><p>{{ copy.uncertainHint }}</p>
    </template>
    <template v-else>
      <h3>{{ copy.processing }}</h3>
    </template>
    <strong>{{ copy.total }} {{ total }}</strong>
    <footer>
      <button :ref="element => emit('registerControl', 'checkout:cancel', element)" type="button" :disabled="status === 'pending' || status === 'uncertain' || status === 'authorized'" @click="emit('cancel')">
        {{ orderingMessages['zh-Hant'].checkout.returnToOrder }}
      </button>
      <button type="button" :disabled="status === 'pending' || status === 'uncertain' || status === 'authorized'" @click="emit('back')">
        {{ copy.back }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.checkout-step {
  display: flex;
  flex-direction: column;
  gap: 22px;
  align-content: start;
  min-height: calc(100vh - 48px);
  padding: 28px;
  border-radius: 20px;
  background: #fff;
  color: #3d281c;
  box-shadow: 0 12px 26px #7a3b141a;
}

.checkout-step header {
  display: flex;
  gap: 18px;
  align-items: center;
}

.checkout-step footer {
  margin-top: auto;
  border-top: 1px solid #ead7c9;
  padding-top: 20px;
}

.checkout-step footer button {
  width: 100%;
  margin-top: 12px;
}

.checkout-step h2 {
  margin: 0;
  font-size: 24px;
}

.checkout-step p {
  line-height: 1.7;
}

.payment-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.test-payment-qr {
  display: grid;
  justify-items: center;
  gap: 12px;
  margin: 0;
  border: 2px dashed #d95327;
  border-radius: 16px;
  padding: 20px;
  background: #fff8ee;
  text-align: center;
}

.test-payment-qr img {
  max-width: 100%;
  height: auto;
}

.test-payment-qr strong {
  margin: 0;
  color: #a72717;
}

.test-payment-qr figcaption {
  line-height: 1.7;
}

.checkout-step button {
  border: 1px solid #ddcbbd;
  border-radius: 12px;
  padding: 18px;
  background: #fff8ee;
  color: #72351c;
  font-weight: 700;
  font-size: 16px;
}

.checkout-step button:disabled {
  opacity: .5;
}

.checkout-step small {
  color: #786655;
  line-height: 1.7;
}

.checkout-step [role=alert] {
  color: #a72717;
}

.checkout-step strong {
  margin-top: 20px;
  font-size: 22px;
}
</style>
