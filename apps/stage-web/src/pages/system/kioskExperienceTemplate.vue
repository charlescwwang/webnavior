<script setup lang="ts">
import { onMounted } from 'vue'

import KioskProfileEditor from '../../components/Webnavior/kioskProfileEditor.vue'

import { useKioskManagement } from '../../composables/useKioskManagement'

const {
  loadOwnerExperienceTemplate,
  loading,
  ownerTemplateDraft,
  publishedOwnerTemplate,
  saveOwnerExperienceTemplate,
  saving,
} = useKioskManagement()

const templateCapabilities = {
  canEditExperience: true,
  canEditTechnicalSettings: true,
  canManageDevices: true,
  canPublishExperience: true,
}

onMounted(() => void loadOwnerExperienceTemplate())
</script>

<template>
  <div :class="['flex flex-col gap-6']">
    <section>
      <p :class="['mb-2 mt-0 text-sm font-semibold tracking-wide text-cyan-700 dark:text-cyan-300']">
        DEFAULT EXPERIENCE
      </p>
      <h1 :class="['m-0 text-3xl font-bold tracking-tight text-slate-950 dark:text-white']">
        新店別預設互動體驗
      </h1>
      <p :class="['mb-0 mt-2 text-sm text-slate-600 dark:text-slate-300']">
        發布後，這份版本會在新店別建立時複製為該店自己的初始發布版本；不會覆蓋既有店別。
      </p>
    </section>
    <p v-if="publishedOwnerTemplate" :class="['m-0 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-100']">
      目前已發布：{{ publishedOwnerTemplate.name }} · 模板 v{{ publishedOwnerTemplate.revision ?? 1 }}
    </p>
    <KioskProfileEditor
      v-if="ownerTemplateDraft"
      :busy="loading || saving"
      :capabilities="templateCapabilities"
      :draft="ownerTemplateDraft"
      :allow-asset-upload="false"
      @save="saveOwnerExperienceTemplate($event.draft, $event.publish)"
    />
  </div>
</template>

<route lang="yaml">
path: /admin/system/kiosk-experience-template
meta:
  layout: webnavior-admin
  title: 新店別預設互動體驗
</route>
