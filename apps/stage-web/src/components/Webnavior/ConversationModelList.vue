<script setup lang="ts">
const props = defineProps<{ endpoints: Record<string, string | undefined>, loading: boolean, models: string[] }>()
const emit = defineEmits<{ remove: [modelId: string] }>()
</script>

<template>
  <section v-if="props.models.length" :class="['overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900']">
    <div :class="['flex items-baseline justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800']">
      <div>
        <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
          已加入的對話／影像模型
        </h2><p :class="['mb-0 mt-1 text-sm text-slate-600 dark:text-slate-300']">
          {{ props.models.length }} 個可供系統或店別選用的模型；請只將支援圖片輸入的模型選為 Kiosk VLM。
        </p>
      </div>
    </div>
    <ul :class="['m-0 divide-y divide-slate-200 p-0 dark:divide-slate-800']">
      <li v-for="model in props.models" :key="model" :class="['flex items-center gap-3 px-5 py-3']">
        <span :class="['i-solar:cpu-bolt-bold-duotone text-slate-400']" /><div :class="['min-w-0 flex-1']">
          <code :class="['block break-all text-sm text-slate-800 dark:text-slate-100']">{{ model }}</code><span :class="['mt-1 block break-all font-mono text-xs text-slate-500 dark:text-slate-400']">{{ props.endpoints[model] ?? '尚未設定連線位址' }}</span>
        </div><button :disabled="props.loading" :class="['text-sm text-slate-500 hover:text-red-600 disabled:opacity-50 dark:text-slate-400']" type="button" @click="emit('remove', model)">
          移除
        </button>
      </li>
    </ul>
  </section>
</template>
