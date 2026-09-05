<script setup lang="ts">
import { IconItem, RippleGrid } from '@proj-airi/stage-ui/components'
import { useRippleGridState } from '@proj-airi/stage-ui/composables/use-ripple-grid-state'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { lastClickedIndex, setLastClickedIndex } = useRippleGridState()

const settings = computed(() => [
  {
    title: t('settings.pages.system.general.title'),
    description: t('settings.pages.system.general.description'),
    icon: 'i-solar:emoji-funny-square-bold-duotone',
    to: '/settings/system/general',
  },
  {
    title: t('settings.pages.system.color-scheme.title'),
    description: t('settings.pages.system.color-scheme.description'),
    icon: 'i-solar:pallete-2-bold-duotone',
    to: '/settings/system/color-scheme',
  },
  {
    title: t('settings.pages.system.developer.title'),
    description: t('settings.pages.system.developer.description'),
    icon: 'i-solar:code-bold-duotone',
    to: '/settings/system/developer',
  },
  {
    title: '主動互動',
    description: '安裝與設定 kiosk 主動互動 POC 模組',
    icon: 'i-solar:eye-bold-duotone',
    to: '/settings/system/kiosk-proactive',
  },
  {
    title: '點餐服務',
    description: '設定嵌入式 WebMCP 點餐頁面的網址',
    icon: 'i-solar:shop-2-bold-duotone',
    to: '/settings/system/ordering-service',
  },
  {
    title: '完成後問卷',
    description: '設定互動完成後顯示的 QR Code 問卷邀請',
    icon: 'i-solar:qr-code-bold-duotone',
    to: '/settings/system/feedback-invitation',
  },
])
</script>

<template>
  <div flex="~ col gap-4" font-normal>
    <div />
    <div flex="~ col gap-4">
      <RippleGrid
        :items="settings"
        :get-key="item => item.to"
        :columns="1"
        :origin-index="lastClickedIndex"
        @item-click="({ globalIndex }) => setLastClickedIndex(globalIndex)"
      >
        <template #item="{ item }">
          <IconItem
            :title="item.title"
            :description="item.description"
            :icon="item.icon"
            :to="item.to"
          />
        </template>
      </RippleGrid>
    </div>
    <div
      v-motion
      text="neutral-200/50 dark:neutral-600/20" pointer-events-none
      fixed top="[calc(100dvh-12rem)]" bottom-0 right--10 z--1
      :initial="{ scale: 0.9, opacity: 0, rotate: 180 }"
      :enter="{ scale: 1, opacity: 1, rotate: 0 }"
      :duration="500"
      size-60
      flex items-center justify-center
    >
      <div v-motion text="60" i-solar:settings-bold-duotone />
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.system.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.system.description
  icon: i-solar:filters-bold-duotone
  settingsEntry: true
  order: 9
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
