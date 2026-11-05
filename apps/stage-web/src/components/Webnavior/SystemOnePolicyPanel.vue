<script setup lang="ts">
import type { SystemOnePolicy, SystemOnePolicyInput } from '../../composables/useWebnaviorAiControl'

import { Button, Textarea } from '@proj-airi/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ busy: boolean, policy: SystemOnePolicy }>()

const emit = defineEmits<{ save: [input: SystemOnePolicyInput] }>()

const { t } = useI18n()

const decisionInstruction = ref(effectiveDecisionInstruction(props.policy))
const storeInstruction = ref(props.policy.storeInstruction)
const usingDefaultInstruction = computed(() => decisionInstruction.value.trim() === props.policy.defaultDecisionInstruction)

watch(() => props.policy, (policy) => {
  decisionInstruction.value = effectiveDecisionInstruction(policy)
  storeInstruction.value = policy.storeInstruction
})

function effectiveDecisionInstruction(policy: SystemOnePolicy) {
  return policy.decisionInstruction || policy.defaultDecisionInstruction
}

function restoreDefaultInstruction() {
  decisionInstruction.value = props.policy.defaultDecisionInstruction
}

function save() {
  emit('save', {
    decisionInstruction: decisionInstruction.value.trim(),
    storeInstruction: storeInstruction.value.trim(),
  })
}
</script>

<template>
  <section :class="['flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
    <div>
      <h2 :class="['m-0 text-lg font-semibold text-slate-950 dark:text-white']">
        System One 點餐規則
      </h2>
      <p :class="['mb-0 mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300']">
        {{ t('stage.system-one.policy-description') }}
      </p>
      <p :class="['mb-0 mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300']">
        {{ t('stage.system-one.policy-hint') }}
      </p>
    </div>

    <label :class="['flex flex-col gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200']">
      System One 語意提示詞
      <Textarea v-model="decisionInstruction" :disabled="props.busy" :rows="14" maxlength="12000" />
      <span :class="['text-xs font-normal leading-5 text-slate-500 dark:text-slate-400']">
        {{ decisionInstruction.length }}/12000。{{ usingDefaultInstruction ? '目前使用系統預設；修改並儲存後會成為此店的版本。' : '目前是此店自訂版本。' }}
      </span>
    </label>

    <label :class="['flex flex-col gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200']">
      店家補充規則（選填）
      <Textarea v-model="storeInstruction" :disabled="props.busy" :rows="4" maxlength="2000" placeholder="例如：顧客說套餐時先開啟套餐分類，不要直接選擇其中一個餐點。" />
      <span :class="['text-xs font-normal leading-5 text-slate-500 dark:text-slate-400']">
        {{ storeInstruction.length }}/2000。留白並儲存可清除補充規則，只保留系統預設策略。
      </span>
    </label>

    <div :class="['flex flex-wrap gap-2']">
      <Button :disabled="props.busy" @click="save">
        儲存 System One 規則
      </Button>
      <Button :disabled="props.busy || usingDefaultInstruction" variant="secondary" @click="restoreDefaultInstruction">
        還原系統預設
      </Button>
    </div>
  </section>
</template>
