<script setup lang="ts">
defineProps<{
  total: string
}>()

const emit = defineEmits<{
  back: []
  skip: []
}>()
</script>

<template>
  <section class="checkout-step" aria-labelledby="membership-heading">
    <header class="checkout-header">
      <button type="button" aria-label="返回訂單內容" @click="emit('back')">
        ‹
      </button>
      <div>
        <span>結帳 1／4</span><h2 id="membership-heading">
          掃描會員條碼
        </h2>
      </div>
    </header>
    <div class="checkout-content">
      <div class="scan-mark" aria-hidden="true">
        ▥
      </div>
      <h3>請顧客出示會員條碼</h3>
      <p>請將手機條碼靠近掃描器。若不使用會員，可直接略過。</p>
      <p class="checkout-total">
        本次訂單 {{ total }}
      </p>
    </div>
    <footer class="checkout-footer">
      <button class="secondary-action" type="button" @click="emit('skip')">
        略過會員
      </button>
    </footer>
  </section>
</template>

<style scoped>
.checkout-step { display:flex; min-height:calc(100vh - 48px); flex-direction:column; border-radius:20px; background:#fff; box-shadow:0 12px 26px #7a3b141a; }.checkout-header { display:flex; align-items:center; gap:12px; border-bottom:1px solid #f0e4da; padding:18px 20px; }.checkout-header button { width:34px; height:34px; border:1px solid #ead7c9; border-radius:50%; color:#803813; background:#fff9f3; font-size:24px; line-height:1; }.checkout-header span { color:#ba5724; font-size:12px; font-weight:800; }.checkout-header h2 { margin:3px 0 0; color:#3d281c; font-size:21px; }.checkout-content { display:grid; flex:1; place-content:center; justify-items:center; padding:32px; text-align:center; }.scan-mark { display:grid; width:92px; height:92px; place-items:center; border:2px dashed #d95327; border-radius:18px; color:#d95327; font-size:54px; }.checkout-content h3 { margin:22px 0 8px; color:#3d281c; font-size:18px; }.checkout-content p { max-width:300px; margin:0; color:#876; font-size:14px; line-height:1.6; }.checkout-content .checkout-total { margin-top:22px; color:#3d281c; font-weight:800; }.checkout-footer { border-top:1px solid #f0e4da; padding:16px 20px 20px; }.secondary-action { width:100%; border:1px solid #d95327; padding:14px; color:#803813; background:#fff9f3; font-weight:800; }
</style>
