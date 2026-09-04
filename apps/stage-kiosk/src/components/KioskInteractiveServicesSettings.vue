<script setup lang="ts">
import type { KioskInteractiveService } from '../composables/useKioskInteractiveServices'

import { Checkbox, FieldInput } from '@proj-airi/ui'
import { shallowRef } from 'vue'

const services = defineModel<KioskInteractiveService[]>({ required: true })
const newServiceId = shallowRef(1)

function addService() {
  const id = `interactive-service-${newServiceId.value++}`
  services.value = [...services.value, {
    enabled: false,
    id,
    title: '新的互動服務',
    description: '',
    serviceUrl: '',
  }]
}

function removeService(id: string) {
  services.value = services.value.filter(service => service.id !== id)
}
</script>

<template>
  <section class="admin-section">
    <div class="section-heading">
      <div>
        <h3>互動服務</h3>
        <p>只有啟用且填妥名稱、用途與網址的服務，才會顯示 iframe 並可由 AIRI 開啟。</p>
      </div>
      <button type="button" class="add-button" @click="addService">
        新增服務
      </button>
    </div>

    <article v-for="service in services" :key="service.id" class="service-card">
      <div class="service-heading">
        <strong>{{ service.title || service.id }}</strong>
        <Checkbox v-model="service.enabled" :aria-label="`啟用 ${service.title || service.id}`" />
      </div>
      <div class="service-fields">
        <FieldInput v-model="service.id" label="服務 ID" description="固定的小寫 kebab-case ID，供 Agent 安全選擇。" placeholder="line-sticker-customizer" required />
        <FieldInput v-model="service.title" label="顯示名稱" description="Kiosk 畫面顯示的服務名稱。" placeholder="客製 LINE 貼圖" required />
        <FieldInput v-model="service.serviceUrl" label="iframe 網址" description="只接受此處設定的 HTTP(S) 網址。" placeholder="https://example.com/stickers" required />
        <FieldInput v-model="service.description" label="提供給 AIRI 的用途描述" description="說明何時可開啟此服務、它能完成什麼。" placeholder="協助顧客製作客製 LINE 貼圖。" :single-line="false" required />
      </div>
      <button type="button" class="remove-button" @click="removeService(service.id)">
        移除此服務
      </button>
    </article>
  </section>
</template>

<style scoped>
.section-heading { display: flex; align-items: start; justify-content: space-between; gap: 1rem; }
.section-heading h3, .section-heading p { margin: 0; }
.section-heading p { margin-top: .35rem; color: rgb(217 250 246 / 70%); font-size: .84rem; line-height: 1.5; }
.add-button, .remove-button { border: 0; border-radius: .7rem; padding: .55rem .75rem; cursor: pointer; }
.add-button { flex: none; color: #063437; background: #78e1d1; }
.service-card { display: grid; gap: .8rem; border: 1px solid rgb(255 255 255 / 12%); border-radius: .85rem; padding: .85rem; background: rgb(1 17 20 / 25%); }
.service-heading { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
.service-fields { display: grid; gap: .75rem; }
.remove-button { justify-self: start; color: #ffd0b0; background: rgb(133 55 28 / 45%); }
</style>
