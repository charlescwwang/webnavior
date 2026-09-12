<script setup lang="ts">
import { Checkbox } from '@proj-airi/ui'

const enabled = defineModel<boolean>({ required: true })
</script>

<template>
  <section class="admin-section">
    <div class="section-heading">
      <div><h3>相機預覽浮動視窗</h3><p>只在這台 Kiosk 顯示目前的本機相機畫面；可拖曳位置，不會改變保存或傳送設定。</p></div>
      <Checkbox v-model="enabled" aria-label="顯示相機預覽浮動視窗" />
    </div>
  </section>
</template>

<style scoped>
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.section-heading h3, .section-heading p { margin: 0; }
.section-heading p { margin-top: .35rem; color: rgb(217 250 246 / 70%); font-size: .84rem; line-height: 1.5; }
</style>
