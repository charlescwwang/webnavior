<script setup lang="ts">
import type { KioskProfileDraft, KioskSite } from '../../composables/useKioskManagement'

import { onMounted, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  draft: KioskProfileDraft
  site?: KioskSite
}>()

const kioskFrame = useTemplateRef<HTMLIFrameElement>('kioskFrame')

const kioskPreviewUrl = `${(import.meta.env.VITE_KIOSK_PREVIEW_URL ?? 'http://localhost:5169').replace(/\/$/u, '')}/?preview=webnavior`

function sendDraft() {
  const target = kioskFrame.value?.contentWindow
  if (!target)
    return
  target.postMessage({
    type: 'webnavior:kiosk-draft-preview',
    profile: {
      name: props.draft.name,
      releaseId: 'draft-preview',
      snapshot: props.draft.snapshot,
    },
  }, new URL(kioskPreviewUrl).origin)
}

onMounted(sendDraft)
watch(() => props.draft, sendDraft, { deep: true })
</script>

<template>
  <section :class="['flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
    <div :class="['flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between']">
      <div>
        <p :class="['mb-2 mt-0 text-sm font-semibold tracking-wide text-cyan-700 dark:text-cyan-300']">
          DRAFT PREVIEW
        </p>
        <h2 :class="['m-0 text-xl font-semibold text-slate-950 dark:text-white']">
          {{ draft.name }}
        </h2>
        <p :class="['mb-0 mt-1 text-sm text-slate-500 dark:text-slate-400']">
          {{ site ? `${site.name} 的未發布草稿` : '未發布草稿' }}；這裡的操作不會發布或更新任何 Kiosk 設備。
        </p>
      </div>
      <span :class="['rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-400/10 dark:text-amber-200']">
        草稿預覽
      </span>
    </div>

    <section :class="['rounded-xl bg-slate-950 p-5 text-slate-100 dark:bg-slate-950']">
      <p :class="['m-0 text-sm text-cyan-200']">
        下方為完整 Kiosk 畫面；包含服務員、對話區與互動服務，不是單獨的菜單預覽。
      </p>
    </section>

    <div :class="['overflow-hidden rounded-xl border border-slate-200 bg-slate-950 dark:border-slate-800']">
      <iframe ref="kioskFrame" :src="kioskPreviewUrl" :title="`${props.draft.name} Kiosk 草稿預覽`" :class="['h-[min(78vh,52rem)] w-full border-0']" @load="sendDraft" />
    </div>

    <p :class="['m-0 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300']">
      此模式只渲染草稿，不會註冊裝置、建立顧客會話或發布設定；互動服務仍會依其自身正常行為載入。
    </p>
  </section>
</template>
