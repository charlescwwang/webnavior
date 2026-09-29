<script setup lang="ts">
import type { SystemOneImplementation, SystemOneProfile } from '../../composables/useWebnaviorAiControl'

import { Button, DoubleCheckButton } from '@proj-airi/ui'

const props = defineProps<{ busy: boolean, profiles: readonly SystemOneProfile[] }>()
const emit = defineEmits<{
  activate: [profileId: string]
  create: []
  delete: [profileId: string]
  deactivate: [profileId: string]
  edit: [profile: SystemOneProfile]
  readiness: [profileId: string]
}>()

function implementationLabel(implementation: SystemOneImplementation) {
  return implementation === 'dasein' ? 'Dasein open-jev' : 'lookski/openjev'
}
</script>

<template>
  <section :class="['flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
    <div :class="['flex flex-wrap items-start justify-between gap-3']">
      <div>
        <h2 :class="['m-0 text-lg font-semibold text-slate-950 dark:text-white']">
          System One 快速決策
        </h2>
        <p :class="['mb-0 mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300']">
          可選擇 Dasein open-jev 或 lookski/openjev 作為 Kiosk Fast Path；兩者都不會取代對話 AI 或 POS。readiness 會以真實決策確認所選部署可用。
        </p>
      </div>
      <Button :disabled="props.busy" @click="emit('create')">
        新增 System One profile
      </Button>
    </div>

    <p v-if="!props.profiles.length" :class="['m-0 rounded-lg bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300']">
      尚未保存 System One profile。
    </p>

    <article v-for="profile in props.profiles" :key="profile.id" :class="['flex flex-col gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800']">
      <div :class="['flex flex-wrap items-start justify-between gap-3']">
        <div>
          <h3 :class="['m-0 font-semibold text-slate-950 dark:text-white']">
            {{ profile.name }}
          </h3>
          <p :class="['mb-0 mt-1 break-all text-sm text-slate-600 dark:text-slate-300']">
            {{ implementationLabel(profile.implementation) }} · {{ profile.modelId }} · {{ profile.baseURL }}
          </p>
        </div>
        <span :class="['rounded-full px-3 py-1 text-xs font-semibold', profile.isActive ? 'bg-emerald-100 text-emerald-800' : profile.verifiedAt ? 'bg-cyan-100 text-cyan-800' : 'bg-amber-100 text-amber-900']">{{ profile.isActive ? '目前啟用' : profile.verifiedAt ? '已就緒' : '待驗證' }}</span>
      </div>
      <p v-if="profile.lastCheckError" :class="['m-0 text-sm text-red-600 dark:text-red-300']">
        {{ profile.lastCheckError }}
      </p>
      <div :class="['flex flex-wrap gap-2']">
        <Button variant="secondary" :disabled="props.busy" @click="emit('edit', profile)">
          編輯
        </Button>
        <Button :disabled="props.busy" @click="emit('readiness', profile.id)">
          執行 readiness
        </Button>
        <Button :disabled="props.busy || !profile.verifiedAt || profile.isActive" @click="emit('activate', profile.id)">
          設為啟用
        </Button>
        <DoubleCheckButton v-if="profile.isActive" variant="caution" :disabled="props.busy" @confirm="emit('deactivate', profile.id)">
          停用 Fast Path
          <template #confirm>
            確認停用
          </template>
          <template #cancel>
            取消
          </template>
        </DoubleCheckButton>
        <DoubleCheckButton :disabled="props.busy || profile.isActive" @confirm="emit('delete', profile.id)">
          移除
          <template #confirm>
            確認移除
          </template>
          <template #cancel>
            取消
          </template>
        </DoubleCheckButton>
      </div>
      <p v-if="profile.isActive" :class="['m-0 text-xs leading-5 text-slate-500 dark:text-slate-400']">
        使用中的 profile 不可移除；可先停用 Fast Path，或啟用另一個已就緒 profile。
      </p>
    </article>
  </section>
</template>
