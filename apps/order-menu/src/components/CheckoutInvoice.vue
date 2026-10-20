<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

import type { CheckoutSnapshot } from '../domain/checkout-flow'

import { computed, shallowRef, useTemplateRef, watch } from 'vue'

const props = defineProps<{ checkout: CheckoutSnapshot, total: string, locked?: boolean }>()
const emit = defineEmits<{
  back: []
  registerControl: [id: string, element: Element | ComponentPublicInstance | null]
  choose: [method: 'carrier' | 'citizen' | 'donation']
  details: [method: 'carrier' | 'citizen' | 'donation', code: string]
  taxId: []
}>()
const input = useTemplateRef<HTMLInputElement>('invoiceInput')
// Inert Agent-controlled pages cannot take keyboard focus. Wait for the DOM
// unlock, including when the voice action changed the invoice option meanwhile.
watch([input, () => props.checkout, () => props.locked], ([field, , locked]) => {
  if (locked)
    field?.blur()
  else
    field?.focus({ preventScroll: true })
}, { flush: 'post' })

const code = shallowRef('')
const method = computed(() => props.checkout.invoiceMethod === 'citizen' || props.checkout.invoiceMethod === 'donation' ? props.checkout.invoiceMethod : 'carrier')
const title = computed(() => ({ carrier: '手機條碼', citizen: '自然人憑證條碼', donation: '捐贈碼' })[method.value])
const valid = computed(() => ({ carrier: /^\/[0-9A-Z+.-]{7}$/, citizen: /^[A-Z]{2}\d{14}$/, donation: /^\d{3,7}$/ })[method.value].test(code.value.trim().toUpperCase()))
watch([method, () => props.checkout.carrierCode, () => props.checkout.citizenCode, () => props.checkout.donationCode], ([selected, carrier, citizen, donation]) => {
  code.value = ({ carrier, citizen, donation })[selected] ?? ''
}, { immediate: true })
</script>

<template>
  <section :class="['checkout-step']" aria-labelledby="invoice-heading">
    <header>
      <h2 id="invoice-heading">
        選擇發票方式
      </h2>
    </header>
    <p>可填寫載具或統編；不需要時請選擇「略過，捐贈發票」，直接選擇付款方式。</p>
    <div :class="['invoice-options']">
      <button v-for="choice in (['carrier', 'citizen'] as const)" :key="choice" :ref="element => emit('registerControl', `checkout:invoice:${choice}`, element)" type="button" :aria-pressed="method === choice" @click="emit('choose', choice)">
        {{ { carrier: '手機載具', citizen: '自然人憑證' }[choice] }}
      </button>
      <button :ref="element => emit('registerControl', 'checkout:tax-id:request', element)" type="button" @click="emit('taxId')">
        公司統一編號
      </button>
    </div>
    <form v-if="method !== 'donation'" @submit.prevent="valid && emit('details', method, code)">
      <label for="invoice-code">{{ title }}</label>
      <input id="invoice-code" ref="invoiceInput" v-model="code" :disabled="props.locked" autocomplete="off" inputmode="text" :maxlength="method === 'citizen' ? 16 : 8" :placeholder="method === 'carrier' ? '/ABC1234' : 'AB12345678901234'">
      <small>測試僅驗證資料格式，尚未串接正式發票開立或受贈單位查詢。</small>
      <strong>本次訂單 {{ total }}</strong>
      <button type="submit" :disabled="!valid">
        確認發票資料，選擇付款方式
      </button>
    </form>
    <footer>
      <button :ref="element => emit('registerControl', 'checkout:invoice:donation', element)" type="button" @click="emit('choose', 'donation')">
        略過，捐贈發票
      </button>
      <button :ref="element => emit('registerControl', 'checkout:cancel', element)" type="button" @click="emit('back')">
        返回上一頁
      </button>
    </footer>
  </section>
</template>

<style scoped>
.checkout-step {
  display: flex;
  flex-direction: column;
  gap: 22px;
  min-height: calc(100vh - 48px);
  align-content: start;
  padding: 28px;
  border-radius: 20px;
  background: #fff;
  color: #3d281c;
  box-shadow: 0 12px 26px #7a3b141a;
}

.checkout-step header {
  display: flex;
  align-items: center;
  gap: 18px;
}

.checkout-step footer {
  display: grid;
  gap: 12px;
  margin-top: auto;
  border-top: 1px solid #ead7c9;
  padding-top: 20px;
}

.checkout-step footer button {
  width: 100%;
}

.checkout-step h2 {
  margin: 0;
  font-size: 24px;
}

.checkout-step p {
  line-height: 1.7;
  color: #786655;
}

.invoice-options {
  display: grid;
  grid-template-columns: repeat(2,minmax(0,1fr));
  gap: 12px;
}

.checkout-step button {
  border: 1px solid #ddcbbd;
  border-radius: 12px;
  padding: 16px;
  background: #fff8ee;
  color: #72351c;
  font-weight: 700;
}

.checkout-step [aria-pressed=true] {
  border-color: #d95327;
  background: #d95327;
  color: #fff;
}

.checkout-step form {
  display: grid;
  gap: 16px;
}

.checkout-step input {
  min-width: 0;
  border: 1px solid #ddcbbd;
  border-radius: 12px;
  padding: 18px;
  font-size: 22px;
  text-transform: uppercase;
}

.checkout-step small {
  line-height: 1.6;
  color: #786655;
}

.checkout-step button[type=submit] {
  background: #d95327;
  color: #fff;
}

.checkout-step button:disabled {
  background: #c6b8ae;
  border-color: #c6b8ae;
  color: #fff;
}
</style>
