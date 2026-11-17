<script setup lang="ts">
import type { FalconSettingsInput, FalconSettingsSnapshot } from '@proj-airi/stage-shared/falcon-settings'

import { defaultFalconSettings } from '@proj-airi/stage-shared/falcon-settings'
import { Button, Input } from '@proj-airi/ui'
import { computed, reactive, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { falconSettingsMessages } from '../../../../../packages/i18n/src/falconSettingsMessages'

const props = defineProps<{ busy: boolean, snapshot?: FalconSettingsSnapshot, error?: string, embedded?: boolean }>()
const emit = defineEmits<{ save: [input: FalconSettingsInput], reload: [] }>()
const { locale } = useI18n()
const copy = computed(() => falconSettingsMessages[locale.value.startsWith('zh') ? 'zh-Hant' : 'en'])
const form = reactive({ ...defaultFalconSettings })
const timeoutSeconds = shallowRef(defaultFalconSettings.timeoutMs / 1000)
const plaintextKey = shallowRef('')
const clearApiKey = shallowRef(false)
watch(() => props.snapshot, (snapshot) => {
  if (!snapshot)
    return
  Object.assign(form, snapshot.settings)
  timeoutSeconds.value = snapshot.settings.timeoutMs / 1000
  plaintextKey.value = ''
  clearApiKey.value = false
}, { immediate: true })
watch(() => form.engine, (engine) => {
  if (engine === 'pytorch')
    form.precision = 'fp32'
})
function save() {
  if (props.busy || !props.snapshot)
    return
  emit('save', { ...form, timeoutMs: timeoutSeconds.value * 1000, plaintextKey: clearApiKey.value ? '' : plaintextKey.value, clearApiKey: clearApiKey.value })
}
</script>

<template>
  <section :class="props.embedded ? ['border-t border-slate-200 pt-4 dark:border-slate-800'] : ['rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-950']" aria-labelledby="falcon-settings-title">
    <component :is="props.embedded ? 'h4' : 'h2'" id="falcon-settings-title" :class="['m-0 text-lg font-semibold']">
      {{ copy.title }}
    </component>
    <p :class="['text-sm text-slate-600 dark:text-slate-300']">
      {{ copy.description }}
    </p>
    <p :class="['rounded-xl bg-amber-50 p-3 text-sm text-amber-900', 'dark:bg-amber-950 dark:text-amber-200']">
      {{ copy.pending }}
    </p>
    <form :class="['mt-4 flex flex-col gap-4']" @submit.prevent="save">
      <label :class="['flex flex-col gap-1 text-sm']">
        {{ copy.mode }}
        <select v-model="form.mode" :disabled="props.busy" :class="['rounded-lg border bg-transparent p-2']">
          <option value="legacy">{{ copy.legacy }}</option>
          <option value="falcon">{{ copy.falcon }}</option>
        </select>
      </label>
      <div :class="['grid grid-cols-1 gap-4 md:grid-cols-2']">
        <label :class="['flex flex-col gap-1 text-sm']">{{ copy.baseURL }}<Input v-model="form.baseURL" :disabled="props.busy" type="url" required /></label>
        <label :class="['flex flex-col gap-1 text-sm']">{{ copy.path }}<Input v-model="form.path" :disabled="props.busy" required /></label>
        <label :class="['flex flex-col gap-1 text-sm']">{{ copy.engine }}
          <select v-model="form.engine" :disabled="props.busy" :class="['rounded-lg border bg-transparent p-2']"><option value="onnx">ONNX</option><option value="pytorch">PyTorch</option></select>
        </label>
        <label :class="['flex flex-col gap-1 text-sm']">{{ copy.precision }}
          <select v-model="form.precision" :disabled="props.busy || form.engine === 'pytorch'" :class="['rounded-lg border bg-transparent p-2']"><option value="fp32">FP32</option><option value="fp16">FP16</option><option value="int8">INT8</option></select>
        </label>
        <label :class="['flex flex-col gap-1 text-sm']">{{ copy.timeout }}<Input v-model.number="timeoutSeconds" :disabled="props.busy" type="number" min="1" max="180" step="1" required /></label>
        <label :class="['flex flex-col gap-1 text-sm']">{{ copy.maxDuration }}<Input v-model.number="form.maxUtteranceSeconds" :disabled="props.busy" type="number" min="1" max="30" step="1" required /></label>
      </div>
      <p :class="['m-0 text-xs text-slate-500']">
        {{ copy.durationHint }}
      </p>
      <label :class="['flex flex-col gap-1 text-sm']">{{ copy.apiKey }}<Input v-model="plaintextKey" :disabled="props.busy || clearApiKey" type="password" autocomplete="new-password" :placeholder="props.snapshot?.hasApiKey ? copy.keyKeep : copy.keyEmpty" /></label>
      <label v-if="props.snapshot?.hasApiKey" :class="['flex items-center gap-2 text-sm']"><input v-model="clearApiKey" :disabled="props.busy" type="checkbox">{{ copy.clearKey }}</label>
      <p :class="['m-0 text-sm text-slate-500']">
        {{ copy.response }}
      </p>
      <label :class="['flex flex-col gap-1 text-sm']">{{ copy.responseFormat }}
        <select v-model="form.responseFormat" :disabled="props.busy" :class="['rounded-lg border bg-transparent p-2']"><option value="transcription-json">{{ copy.transcriptJson }}</option><option value="chat-completions">{{ copy.chatJson }}</option></select>
      </label>
      <p :class="['m-0 text-sm text-slate-500']">
        {{ copy.serviceNote }}
      </p>
      <p v-if="props.error" role="alert" :class="['m-0 text-sm text-red-700']">
        {{ props.error }}
      </p>
      <div :class="['flex flex-wrap gap-3']">
        <Button type="submit" :disabled="props.busy || !props.snapshot">
          {{ copy.save }}
        </Button>
        <Button type="button" :disabled="props.busy" @click="emit('reload')">
          {{ copy.reload }}
        </Button>
      </div>
    </form>
  </section>
</template>
