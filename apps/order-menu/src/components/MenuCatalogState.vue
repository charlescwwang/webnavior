<script setup lang="ts">
const props = defineProps<{
  error?: string
  state: 'error' | 'idle' | 'loading'
}>()

const emit = defineEmits<{
  retry: []
}>()
</script>

<template>
  <main class="catalog-state" aria-live="polite">
    <div class="catalog-state-card">
      <span class="catalog-state-icon" aria-hidden="true">{{ props.state === 'error' ? '!' : '…' }}</span>
      <h1>{{ props.state === 'error' ? 'POS 菜單無法載入' : '正在載入 POS 菜單' }}</h1>
      <p>{{ props.state === 'error' ? props.error : '正在向 POS Bridge 取得目前可供應的餐點與價格。' }}</p>
      <button v-if="props.state === 'error'" type="button" @click="emit('retry')">
        重新載入
      </button>
    </div>
  </main>
</template>

<style scoped>
.catalog-state {
  display: grid;
  min-height: 100dvh;
  place-items: center;
  padding: 24px;
  background: #fff7f0;
}

.catalog-state-card {
  max-width: 480px;
  padding: 32px;
  border: 1px solid #ead7c9;
  border-radius: 20px;
  background: #fff;
  color: #5b3824;
  text-align: center;
}

.catalog-state-icon {
  display: inline-grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 50%;
  background: #803813;
  color: #fff;
  font-weight: 800;
}

button {
  margin-top: 10px;
  background: #d95327;
  color: #fff;
  font-weight: 800;
}
</style>
