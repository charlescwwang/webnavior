<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  taxId: string
}>()

const emit = defineEmits<{
  back: []
  confirm: []
  updateTaxId: [taxId: string]
}>()

const isValid = computed(() => /^\d{8}$/.test(props.taxId))

function append(digit: string) {
  if (props.taxId.length < 8)
    emit('updateTaxId', `${props.taxId}${digit}`)
}
</script>

<template>
  <section :class="['checkout-step']">
    <header :class="['checkout-header']">
      <div><span>發票資料</span><h2>輸入統一編號</h2></div>
    </header>
    <div :class="['checkout-content']">
      <p :class="['checkout-timer']">
        請確認統編後繼續；不會自動改成捐贈。
      </p>
      <p>可按鍵輸入，或直接口說統編由 Agent 帶入；送出前請確認完整 8 碼。</p>
      <output :class="['tax-id-value']">{{ taxId || '請輸入統一編號' }}</output>
      <p :class="['voice-hint']">
        說出「統編是……」即可帶入畫面
      </p>
      <div :class="['tax-keypad']">
        <button v-for="digit in ['1', '2', '3', '4', '5', '6', '7', '8', '9']" :key="digit" type="button" @click="append(digit)">
          {{ digit }}
        </button>
        <button type="button" @click="emit('updateTaxId', '')">
          清除
        </button>
        <button type="button" @click="append('0')">
          0
        </button>
        <button type="button" @click="emit('updateTaxId', taxId.slice(0, -1))">
          ⌫
        </button>
      </div>
    </div>
    <footer :class="['checkout-footer']">
      <button :class="['primary-action']" type="button" :disabled="!isValid" @click="emit('confirm')">
        確認統編
      </button>
      <button :class="['back-action']" type="button" @click="emit('back')">
        返回上一頁
      </button>
    </footer>
  </section>
</template>

<style scoped>
.back-action {
  width: 100%;
  margin-top: 12px;
  padding: 14px;
  border: 1px solid #ddcbbd;
  border-radius: 12px;
  background: #fff8ee;
  color: #72351c;
  font-weight: 700;
}

.checkout-step{display:flex;min-height:calc(100vh - 48px);flex-direction:column;border-radius:20px;background:#fff;box-shadow:0 12px 26px #7a3b141a}.checkout-header{display:flex;align-items:center;gap:12px;border-bottom:1px solid #f0e4da;padding:18px 20px}.checkout-header button{width:34px;height:34px;border:1px solid #ead7c9;border-radius:50%;color:#803813;background:#fff9f3;font-size:24px}.checkout-header span{color:#ba5724;font-size:12px;font-weight:800}.checkout-header h2{margin:3px 0 0;color:#3d281c;font-size:21px}.checkout-content{display:grid;flex:1;place-content:center;justify-items:center;padding:26px;text-align:center}.checkout-content p{max-width:300px;margin:0;color:#876;font-size:14px;line-height:1.6}.checkout-timer{margin-bottom:18px!important;color:#ba5724!important;font-size:12px!important;font-weight:800}.tax-id-value{width:100%;margin-top:18px;border:1px solid #d95327;border-radius:12px;padding:14px;color:#3d281c;font-size:20px;letter-spacing:.18em}.voice-hint{margin-top:12px!important;color:#803813!important;font-weight:700}.tax-keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;width:100%;margin-top:14px}.tax-keypad button{min-height:38px;border:1px solid #ead7c9;color:#3d281c;background:#fff9f3}.checkout-footer{border-top:1px solid #f0e4da;padding:16px 20px 20px}.primary-action{width:100%;padding:14px;color:#fff;background:#d95327;font-weight:800}.primary-action:disabled{background:#c6b8ae}
</style>
