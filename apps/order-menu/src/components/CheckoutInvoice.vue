<script setup lang="ts">
defineProps<{ carrierCode?: string, total: string }>()
const emit = defineEmits<{ back: [], carrier: [], donation: [], taxId: [] }>()
</script>

<template>
  <section class="checkout-step">
    <header class="checkout-header">
      <button type="button" aria-label="返回會員掃碼" @click="emit('back')">
        ‹
      </button><div><span>結帳 2／4</span><h2>確認發票資料</h2></div>
    </header><div class="checkout-content">
      <p class="checkout-timer">
        30 秒後{{ carrierCode ? '使用此載具' : '自動捐贈發票' }}
      </p><h3>{{ carrierCode ? '確認雲端發票載具' : '掃描雲端發票載具' }}</h3><p>{{ carrierCode ? '會員已帶入載具，仍可改填統編或捐贈。' : '請使用實體掃描器，或選擇其他開立方式。' }}</p><strong v-if="carrierCode" class="carrier-code">{{ carrierCode }}</strong><p class="checkout-total">
        本次訂單 {{ total }}
      </p>
    </div><footer class="checkout-footer">
      <button v-if="carrierCode" class="primary-action" type="button" @click="emit('carrier')">
        使用此載具
      </button><div class="checkout-choice-actions">
        <button type="button" @click="emit('taxId')">
          改填統編
        </button><button type="button" @click="emit('donation')">
          捐贈發票
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.checkout-step{display:flex;min-height:calc(100vh - 48px);flex-direction:column;border-radius:20px;background:#fff;box-shadow:0 12px 26px #7a3b141a}.checkout-header{display:flex;align-items:center;gap:12px;border-bottom:1px solid #f0e4da;padding:18px 20px}.checkout-header button{width:34px;height:34px;border:1px solid #ead7c9;border-radius:50%;color:#803813;background:#fff9f3;font-size:24px}.checkout-header span{color:#ba5724;font-size:12px;font-weight:800}.checkout-header h2{margin:3px 0 0;color:#3d281c;font-size:21px}.checkout-content{display:grid;flex:1;place-content:center;justify-items:center;padding:32px;text-align:center}.checkout-content h3{margin:16px 0 8px;color:#3d281c;font-size:18px}.checkout-content p{max-width:300px;margin:0;color:#876;font-size:14px;line-height:1.6}.checkout-timer{color:#ba5724!important;font-size:12px!important;font-weight:800}.carrier-code{width:100%;margin-top:18px;border:1px solid #ead7c9;border-radius:12px;padding:14px;color:#3d281c;background:#fff8ee;font-size:19px;letter-spacing:.08em}.checkout-total{margin-top:20px!important;color:#3d281c!important;font-weight:800}.checkout-footer{border-top:1px solid #f0e4da;padding:16px 20px 20px}.primary-action{width:100%;margin-bottom:10px;padding:14px;color:#fff;background:#d95327;font-weight:800}.checkout-choice-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.checkout-choice-actions button{border:1px solid #ead7c9;padding:12px;color:#803813;background:#fff9f3;font-weight:800}
</style>
