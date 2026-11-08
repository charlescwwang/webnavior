<script setup lang="ts">
import type { OrderingContext } from '@proj-airi/stage-shared/kiosk-service-mode'
import type { ComponentPublicInstance } from 'vue'

import type { FulfillmentMode, MenuItem } from '../domain/order-machine'

import { formatOrderingPrice } from '@proj-airi/stage-shared/kiosk-conversation'

import { cartOptionControlId, cartRemovalControlId, fulfillmentControlId, quantityStepControlId } from '../webmcp'

interface ReviewLine {
  id: string
  name: string
  options: string
  quantity: number
  total: string
  optionGroups?: MenuItem['optionGroups']
  selectedOptions?: Record<string, string>
}

const props = defineProps<{
  fulfillmentModes: Array<{ id: FulfillmentMode, label: string }>
  serviceContext?: OrderingContext
  submitting?: boolean
  completed: boolean
  fulfillmentMode: FulfillmentMode | undefined
  lines: ReviewLine[]
  orderStatus: string | undefined
  submissionStatus: 'accepted' | 'rejected' | 'uncertain' | undefined
  total: string
  completedLabel: string
  seatingReady: boolean
}>()

const emit = defineEmits<{
  back: []
  checkout: []
  remove: [lineId: string]
  clear: []
  updateOption: [lineId: string, groupId: string, valueId: string]
  registerControl: [id: string, element: Element | ComponentPublicInstance | null]
  setFulfillment: [mode: FulfillmentMode]
  updateQuantity: [lineId: string, quantity: number]
}>()
</script>

<template>
  <section class="order-review" aria-labelledby="order-review-heading">
    <header class="order-review-header">
      <button :ref="element => emit('registerControl', 'order:back', element)" type="button" class="back-button" aria-label="繼續點餐" @click="emit('back')">
        ‹
      </button>
      <div>
        <h2 id="order-review-heading">
          訂單內容
        </h2>
        <p>可調整餐點、客製內容與數量</p>
      </div>
    </header>

    <div v-if="props.serviceContext?.table" :class="['order-table']">
      <span>桌號</span><strong>{{ props.serviceContext.table.label.toUpperCase() }}</strong>
    </div>
    <p v-if="props.serviceContext?.serviceMode === 'table-service' && !props.serviceContext.directSubmissionSupported" role="alert">
      這份訂單無法直接送出。
    </p>
    <p v-if="props.lines.length === 0" class="review-empty">
      尚未加入餐點，返回菜單開始點餐。
    </p>
    <ul v-else class="review-lines">
      <li v-for="line in props.lines" :key="line.id">
        <div class="review-line-copy">
          <strong>{{ line.name }}</strong>
          <span v-if="line.options">{{ line.options }}</span>
        </div>
        <strong class="review-line-total">{{ line.total }}</strong>
        <div class="review-line-actions">
          <button :ref="element => emit('registerControl', cartRemovalControlId(line.id), element)" type="button" :class="['remove-button']" :disabled="props.completed" @click="emit('remove', line.id)">
            移除
          </button>
          <div class="review-quantity" :aria-label="`${line.name} 購物車數量`">
            <button :ref="element => emit('registerControl', quantityStepControlId(line.id, 'decrease', true), element)" type="button" :disabled="line.quantity === 1 || props.completed" aria-label="減少一份" @click="emit('updateQuantity', line.id, line.quantity - 1)">
              −
            </button>
            <output>{{ line.quantity }}</output>
            <button :ref="element => emit('registerControl', quantityStepControlId(line.id, 'increase', true), element)" type="button" :disabled="props.completed || line.quantity >= 20" aria-label="增加一份" @click="emit('updateQuantity', line.id, line.quantity + 1)">
              ＋
            </button>
          </div>
        </div>
        <div v-for="group in line.optionGroups" :key="group.id" :class="['review-line-options', { 'many-options': group.values.length > 12 }]" role="group" :aria-label="`${line.name} ${group.label}`">
          <span>{{ group.label }}</span>
          <button v-for="value in group.values" :key="value.id" :ref="element => emit('registerControl', cartOptionControlId(line.id, group.id, value.id), element)" type="button" :disabled="props.completed" :aria-pressed="line.selectedOptions?.[group.id] === value.id" @click="emit('updateOption', line.id, group.id, value.id)">
            {{ value.label }}<span v-if="value.priceDelta"> {{ value.priceDelta > 0 ? '+' : '' }}{{ formatOrderingPrice(value.priceDelta) }}</span>
          </button>
        </div>
      </li>
    </ul>

    <section v-if="props.lines.length > 0" class="review-total" aria-label="訂單總計">
      <span>總計</span><strong>{{ props.total }}</strong>
    </section>

    <!-- Fulfillment may be chosen before adding food; the Agent and touch UI
         must expose the same legal controls even when the cart is empty. -->
    <section v-if="props.fulfillmentModes.length > 0 && !props.completed" :class="['review-fulfillment']" aria-labelledby="fulfillment-heading">
      <div>
        <h3 id="fulfillment-heading">
          用餐方式
        </h3>
        <p>請選擇店家提供的用餐方式</p>
      </div>
      <div class="fulfillment-actions">
        <button v-for="mode in props.fulfillmentModes" :key="mode.id" :ref="element => emit('registerControl', fulfillmentControlId(mode.id), element)" :class="['fulfillment-button', { 'is-selected': props.fulfillmentMode === mode.id }]" type="button" @click="emit('setFulfillment', mode.id)">
          {{ mode.label }}
        </button>
      </div>
    </section>

    <slot name="seating" />
    <footer class="review-footer">
      <button v-if="!props.completed && props.lines.length" :ref="element => emit('registerControl', 'cart:clear', element)" type="button" :class="['remove-button', 'review-clear']" @click="emit('clear')">
        清空購物車
      </button>
      <button v-if="!props.completed" :ref="element => emit('registerControl', 'checkout:start', element)" :class="['confirm-button']" type="button" :disabled="props.submitting || (props.serviceContext?.serviceMode === 'table-service' && !props.serviceContext.directSubmissionSupported) || props.lines.length === 0 || !props.fulfillmentMode || !props.seatingReady || props.submissionStatus === 'uncertain'" @click="emit('checkout')">
        {{ props.serviceContext?.serviceMode === 'table-service' ? '確認訂單，直接送出' : '確認訂單，進入結帳' }}
      </button>
      <p v-if="props.orderStatus" class="order-status" :class="{ 'is-completed': props.completed }">
        {{ props.orderStatus }}
      </p>
      <section v-if="props.submissionStatus === 'uncertain'" class="order-status" role="alert">
        訂單正在等待 POS 對帳。為避免重複送單，此頁已鎖定送出；請由服務人員以同一筆提交識別資訊確認結果。
      </section>
      <slot v-if="props.completed" name="continuation" />
      <section v-if="props.completed" class="order-completion" role="status" aria-live="polite">
        <div class="i-solar:check-circle-bold-duotone" aria-hidden="true" /><div><strong>{{ props.completedLabel }}</strong><p>訂單已完成確認。</p></div>
      </section>
    </footer>
  </section>
</template>

<style scoped>
.review-line-options { display:flex; grid-column:1 / -1; flex-wrap:wrap; align-items:center; gap:8px; }
.review-line-options.many-options { max-height:240px; overflow:auto; padding:4px; }.review-line-options > span { color:#876; font-size:12px; }
.review-line-options button { min-height:40px; border:1px solid #ead7c9; padding:8px 12px; color:#765; background:#fff9f3; }
.review-line-options button[aria-pressed="true"] { border-color:#d95327; color:#803813; background:#ffe0c5; }
.review-clear { min-height:40px; margin-bottom:8px; }
.order-review { display:flex; min-height:calc(100vh - 48px); flex-direction:column; overflow:hidden; border-radius:20px; background:#fff; box-shadow:0 12px 26px #7a3b141a; }.order-review-header { display:flex; align-items:center; gap:12px; border-bottom:1px solid #f0e4da; padding:18px 20px; }.back-button { width:34px; height:34px; flex:none; border:1px solid #ead7c9; border-radius:50%; color:#803813; background:#fff9f3; font-size:24px; line-height:1; }.order-review h2,.order-review h3,.order-review p { margin:0; }.order-review h2 { color:#3d281c; font-size:21px; }.order-review-header p,.review-fulfillment p { margin-top:4px; color:#876; font-size:12px; }.review-empty { padding:24px 20px; color:#876; }.review-lines { margin:0; padding:0 20px; list-style:none; }.review-lines li { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px 16px; border-bottom:1px solid #f0e4da; padding:16px 0; }.review-line-copy { min-width:0; }.review-line-copy strong,.review-line-copy span { display:block; }.review-line-copy strong { color:#3d281c; font-size:15px; }.review-line-copy span { margin-top:5px; color:#876; font-size:12px; line-height:1.5; }.review-line-total { color:#3d281c; font-size:14px; }.review-line-actions { display:flex; grid-column:1 / -1; align-items:center; justify-content:space-between; }.remove-button { padding:0; color:#b33d21; background:transparent; font-size:12px; text-decoration:underline; }.remove-button:disabled { color:#9f938a; }.review-quantity { display:grid; grid-template-columns:30px 32px 30px; align-items:center; overflow:hidden; border:1px solid #ead7c9; border-radius:8px; background:#fff9f3; }.review-quantity button { height:30px; padding:0; color:#803813; background:transparent; font-size:17px; }.review-quantity button:disabled { cursor:not-allowed; color:#c6b8ae; }.review-quantity output { color:#5b3824; font-size:12px; font-weight:800; text-align:center; }.review-total { display:flex; justify-content:space-between; margin-top:auto; border-top:1px solid #f0e4da; padding:16px 20px; background:#fff8ee; color:#3d281c; }.review-total strong { font-size:18px; }.review-fulfillment { display:grid; gap:10px; padding:16px 20px; border-top:1px solid #f0e4da; }.review-fulfillment h3 { color:#3d281c; font-size:15px; }.fulfillment-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }.fulfillment-button { border:1px solid #ead7c9; padding:11px; color:#72351c; background:#fff9f3; font-weight:800; }.fulfillment-button.is-selected { border-color:#d95327; color:#fff; background:#d95327; }.review-footer { border-top:1px solid #f0e4da; padding:14px 20px 20px; background:#fff; }.confirm-button { width:100%; padding:14px; color:#fff; background:#d95327; font-weight:800; }.confirm-button:disabled { cursor:not-allowed; background:#c6b8ae; }.order-status { margin:12px 0 0; color:#427536; font-weight:700; }.order-completion { display:grid; grid-template-columns:auto 1fr; gap:.75rem; align-items:start; color:#285c28; }.order-completion > div:first-child { font-size:1.65rem; }.order-completion strong { display:block; font-size:1rem; }.order-completion p { margin:.15rem 0; font-size:.82rem; }
.order-table { display: flex; align-items: center; gap: .75rem; margin: 1rem 1.25rem; padding: .75rem 1rem; border-radius: .75rem; background: #fff4e5; color: #72351c; }.order-table span { font-size: .85rem; }.order-table strong { font-size: 1.8rem; font-variant-numeric: tabular-nums; }.order-status { overflow-wrap: anywhere; line-height: 1.6; }.order-status.is-completed { color: #6a6f68; font-size: .78rem; font-weight: 400; margin-bottom: .75rem; }
</style>
