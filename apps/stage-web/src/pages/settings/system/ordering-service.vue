<script setup lang="ts">
import { Button, Checkbox, Input } from '@proj-airi/ui'
import { shallowRef } from 'vue'

import { interactiveServiceAgentInstructions, interactiveServices } from '../../../services/interactive-services'

const nextServiceNumber = shallowRef(1)

function addService() {
  interactiveServices.value = [...interactiveServices.value, {
    description: '',
    enabled: false,
    id: `interactive-service-${nextServiceNumber.value++}`,
    serviceUrl: '',
    title: '新的互動服務',
  }]
}

function removeService(id: string) {
  interactiveServices.value = interactiveServices.value.filter(service => service.id !== id)
}
</script>

<template>
  <div :class="['flex flex-col gap-5', 'pb-12']">
    <section :class="['flex flex-col gap-4', 'rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800']">
      <div>
        <h2 :class="['m-0 text-lg font-semibold']">
          可開啟互動服務
        </h2>
        <p :class="['mb-0 mt-2 text-sm text-neutral-600 dark:text-neutral-300']">
          stage-web 只使用一個 iframe。僅啟用且填妥的服務可由 AIRI 依用途描述切換開啟；Agent 不能開啟清單外網址。
        </p>
      </div>

      <article v-for="service in interactiveServices" :key="service.id" :class="['flex flex-col gap-3', 'rounded-xl border border-neutral-200 p-4 dark:border-neutral-800']">
        <div :class="['flex items-center justify-between gap-3']">
          <strong>{{ service.title || service.id }}</strong>
          <label :class="['flex items-center gap-2 text-sm']"><Checkbox v-model="service.enabled" /> 啟用</label>
        </div>
        <Input v-model="service.id" placeholder="服務 ID，例如 line-sticker-customizer" />
        <Input v-model="service.title" placeholder="顯示名稱" />
        <Input v-model="service.serviceUrl" type="url" placeholder="iframe 網址" />
        <Input v-model="service.description" placeholder="提供給 AIRI 的用途描述：何時應開啟、這個頁面能做什麼。" />
        <Button variant="secondary" :class="['self-start']" @click="removeService(service.id)">
          移除服務
        </Button>
      </article>

      <div :class="['flex flex-wrap gap-3']">
        <Button @click="addService">
          新增服務
        </Button>
      </div>

      <label :class="['flex flex-col gap-2 text-sm font-medium']">
        給 AIRI 的互動服務指示
        <Input v-model="interactiveServiceAgentInstructions" placeholder="補充何時建議服務、品牌語氣或現場流程。" />
      </label>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: 互動服務
  subtitle: 系統設定
  description: 設定唯一 iframe 可由 AIRI 開啟的服務
  icon: i-solar:shop-2-bold-duotone
  settingsEntry: true
  order: 4
  stageTransition:
    name: slide
</route>
