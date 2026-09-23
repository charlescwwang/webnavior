<script setup lang="ts">
import type { PaymentMethod, PaymentStatus } from '../pos-bridge'

defineProps<{
  error?: string
  method?: PaymentMethod
  status?: PaymentStatus
  total: string
}>()

const emit = defineEmits<{
  back: []
  select: [method: PaymentMethod]
}>()
</script>

<template>
  <section class="checkout-step" aria-labelledby="payment-heading">
    <header class="checkout-header">
      <button type="button" aria-label="返回訂單內容" :disabled="status === 'pending' || status === 'uncertain'" @click="emit('back')">
        ‹
      </button>
      <div>
        <span>結帳 4／4</span><h2 id="payment-heading">
          付款
        </h2>
      </div>
    </header>
    <div class="checkout-content">
      <template v-if="!method || status === 'rejected'">
        <p class="checkout-timer">
          30 秒未選擇將返回訂單內容
        </p>
        <h3>{{ status === 'rejected' ? '付款未完成，請重新選擇' : '請選擇付款方式' }}</h3>
        <p v-if="error" class="payment-error" role="alert">
          {{ error }}
        </p>
        <p v-else>
          付款成功後，系統會自動送出訂單，不需要再按一次。
        </p>
        <div class="payment-options">
          <button type="button" @click="emit('select', 'mobile')">
            <strong>行動支付</strong><span>由顧客掃描付款 QR Code</span>
          </button>
          <button type="button" @click="emit('select', 'card')">
            <strong>信用卡</strong><span>至刷卡機感應、插卡或刷卡</span>
          </button>
        </div>
      </template>
      <template v-else-if="status === 'uncertain'">
        <div class="payment-state is-warning">
          !
        </div>
        <h3>付款結果待確認</h3>
        <p class="payment-error" role="alert">
          {{ error || '為避免重複扣款，訂單已鎖定。請由門市人員查詢支付終端。' }}
        </p>
      </template>
      <template v-else>
        <div class="payment-state">
          {{ method === 'mobile' ? '▦' : '▣' }}
        </div>
        <h3>{{ method === 'mobile' ? '請使用手機完成付款' : '請依刷卡機指示付款' }}</h3>
        <p>{{ method === 'mobile' ? '請掃描支付終端顯示的 QR Code。' : '可感應、插卡或刷卡；完成前請勿離開。' }}</p>
        <p class="terminal-status" aria-live="polite">
          正在等待支付終端結果…
        </p>
      </template>
      <p class="checkout-total">
        應付金額 {{ total }}
      </p>
    </div>
    <footer class="checkout-footer">
      <p>{{ status === 'uncertain' ? '此筆交易不可重新付款' : '實際付款由顧客在支付終端完成' }}</p>
    </footer>
  </section>
</template>

<style scoped>
.checkout-step { display:flex; min-height:calc(100vh - 48px); flex-direction:column; border-radius:20px; background:#fff; box-shadow:0 12px 26px #7a3b141a; }.checkout-header { display:flex; align-items:center; gap:12px; border-bottom:1px solid #f0e4da; padding:18px 20px; }.checkout-header button { width:34px; height:34px; border:1px solid #ead7c9; border-radius:50%; color:#803813; background:#fff9f3; font-size:24px; line-height:1; }.checkout-header button:disabled { cursor:not-allowed; opacity:.35; }.checkout-header span { color:#ba5724; font-size:12px; font-weight:800; }.checkout-header h2 { margin:3px 0 0; color:#3d281c; font-size:21px; }.checkout-content { display:grid; flex:1; place-content:center; justify-items:center; padding:32px; text-align:center; }.checkout-content h3 { margin:18px 0 8px; color:#3d281c; font-size:18px; }.checkout-content p { max-width:320px; margin:0; color:#876; font-size:14px; line-height:1.6; }.checkout-timer { color:#ba5724!important; font-size:12px!important; font-weight:800; }.payment-options { display:grid; gap:10px; width:100%; margin-top:18px; }.payment-options button { display:grid; gap:4px; border:1px solid #ead7c9; border-radius:14px; padding:16px; color:#3d281c; background:#fff9f3; text-align:left; }.payment-options span { color:#876; font-size:12px; }.payment-state { display:grid; width:92px; height:92px; place-items:center; border-radius:24px; color:#fff; background:#ba5724; font-size:40px; }.payment-state.is-warning { background:#9d4a35; }.terminal-status { margin-top:16px!important; color:#ba5724!important; font-weight:800; }.payment-error { color:#9d3a25!important; }.checkout-content .checkout-total { margin-top:22px; color:#3d281c; font-weight:800; }.checkout-footer { border-top:1px solid #f0e4da; padding:16px 20px 20px; text-align:center; }.checkout-footer p { margin:0; color:#876; font-size:13px; }
</style>
