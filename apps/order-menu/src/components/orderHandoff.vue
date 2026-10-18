<script setup lang="ts">
import QRCode from 'qrcode'

import { errorMessageFrom } from '@moeru/std'
import { shallowRef, watch } from 'vue'

const props = defineProps<{ url: string }>()
const emit = defineEmits<{ done: [] }>()
const qr = shallowRef('')
const error = shallowRef<string>()
watch(() => props.url, async (url, _, onCleanup) => {
  let current = true
  onCleanup(() => current = false)
  qr.value = ''
  error.value = undefined
  try {
    const image = await QRCode.toDataURL(url, { width: 240, margin: 4, errorCorrectionLevel: 'M' })
    if (current)
      qr.value = image
  }
  catch (cause) {
    if (current)
      error.value = errorMessageFrom(cause) ?? 'QR Code 無法產生，請使用下方連結。'
  }
}, { immediate: true })
</script>

<template>
  <section :class="['order-handoff']" aria-labelledby="handoff-heading">
    <h2 id="handoff-heading">
      把訂單帶到手機
    </h2>
    <p>先掃這個 QR Code，入座後再掃桌碼，確認送餐桌號。</p>
    <img v-if="qr" :src="qr" width="240" height="240" alt="本筆訂單接續 QR Code">
    <p v-if="error" role="alert">
      {{ error }}
    </p>
    <a :href="url" rel="noopener noreferrer">在電腦開啟接續頁</a>
    <button type="button" @click="emit('done')">
      已帶走訂單，結束本次操作
    </button>
    <small>測試訂單連結有效 30 分鐘；不會實際派送機器人。</small>
  </section>
</template>

<style scoped>
.order-handoff {
  display: grid;
  justify-items: center;
  gap: 12px;
  border: 1px solid #e6c7ae;
  border-radius: 18px;
  margin-top: 20px;
  padding: 24px;
  background: #fff9ef;
  text-align: center;
}

.order-handoff h2 {
  font-size: 20px;
}

.order-handoff p {
  line-height: 1.6;
}

.order-handoff img {
  max-width: 100%;
  height: auto;
  border-radius: 12px;
}

.order-handoff a {
  display: block;
  border-radius: 10px;
  padding: 14px 20px;
  background: #d95327;
  color: #fff;
  font-weight: 700;
  text-decoration: none;
}

.order-handoff button {
  padding: 12px 18px;
  background: #fff;
  border: 1px solid #d9cbbf;
  color: #72351c;
}

.order-handoff small {
  color: #786655;
}
</style>
