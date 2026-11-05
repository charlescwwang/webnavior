<script setup lang="ts">
import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'

const props = defineProps<{ enabled: boolean, mode: 'standard' | 'mask', channelCount?: number, status: string, error: string }>()
const mapping = defineModel<string>('mapping', { required: true })
const radius = defineModel<number>('radius', { required: true })
const text = orderingMessages['zh-Hant'].arrayAudio
</script>

<template>
  <section :class="['rounded border p-3', 'grid gap-2']">
    <h3>{{ text.title }}</h3>
    <p>{{ text.automatic }}</p>
    <p>{{ text.mode }}：{{ props.mode === 'mask' ? text.mask : text.standard }}</p>
    <p>{{ text.status }} {{ props.status }} <span v-if="props.channelCount !== undefined">（{{ props.channelCount }} CH）</span></p>
    <p v-if="props.error" role="alert">
      {{ props.error }}
    </p>
    <details>
      <summary>{{ text.geometry }}</summary>
      <p>{{ text.stopToConfigure }}</p>
      <label>{{ text.mapping }} <input v-model="mapping" :disabled="props.enabled"></label>
      <label>{{ text.radius }} <input v-model.number="radius" type="number" min="10" max="100" :disabled="props.enabled"></label>
      <p>{{ text.front }}</p>
    </details>
    <p>{{ text.localComparison }}</p>
  </section>
</template>
