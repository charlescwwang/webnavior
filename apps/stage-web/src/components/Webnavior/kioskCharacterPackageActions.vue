<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

defineProps<{ busy: boolean }>()
const emit = defineEmits<{ download: [], upload: [file: File] }>()
const { t } = useI18n()

function selectPackage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.item(0)
  if (file)
    emit('upload', file)
  input.value = ''
}
</script>

<template>
  <div :class="['grid gap-3 rounded-lg border border-cyan-200 bg-cyan-50 p-4', 'dark:border-cyan-800 dark:bg-cyan-950/30']">
    <p :class="['m-0 text-sm font-semibold text-slate-900 dark:text-white']">
      {{ t('stage.kiosk.character-package.title') }}
    </p>
    <p :class="['m-0 text-xs leading-5 text-slate-600 dark:text-slate-300']">
      {{ t('stage.kiosk.character-package.description') }}
    </p>
    <div :class="['flex flex-wrap items-center gap-3']">
      <Button variant="secondary" :disabled="busy" @click="emit('download')">
        {{ t('stage.kiosk.character-package.download') }}
      </Button>
      <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        {{ t('stage.kiosk.character-package.upload') }}
        <input type="file" accept=".zip" :disabled="busy" @change="selectPackage">
      </label>
    </div>
    <p :class="['m-0 text-xs leading-5 text-slate-600 dark:text-slate-300']">
      {{ t('stage.kiosk.character-package.hint') }}
    </p>
  </div>
</template>
