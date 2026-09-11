<script setup lang="ts">
import type { KioskVisitorSessionSummary } from '../../composables/useKioskManagement'

import { computed } from 'vue'

const props = defineProps<{
  selectedId?: string
  selectedIds: string[]
  sessions: KioskVisitorSessionSummary[]
}>()

const emit = defineEmits<{
  select: [visitorSessionId: string]
  selectIds: [visitorSessionIds: string[]]
}>()

const dateTime = new Intl.DateTimeFormat('zh-TW', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function formatDate(value: string) {
  return dateTime.format(new Date(value))
}

function stateLabel(state: KioskVisitorSessionSummary['state']) {
  return {
    active: '進行中',
    cancelled: '已取消',
    completed: '已完成',
    idle: '閒置結束',
  }[state]
}

const sessionGroups = computed(() => {
  const day = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'full' })
  const groups = new Map<string, Map<string, KioskVisitorSessionSummary[]>>()
  for (const session of props.sessions) {
    const date = day.format(new Date(session.createdAt))
    const period = timePeriod(session.createdAt)
    const periods = groups.get(date) ?? new Map<string, KioskVisitorSessionSummary[]>()
    periods.set(period, [...(periods.get(period) ?? []), session])
    groups.set(date, periods)
  }
  return [...groups].map(([label, periods]) => ({
    label,
    periods: [...periods].map(([period, sessions]) => ({ period, sessions })),
  }))
})

function timePeriod(value: string) {
  const hour = new Date(value).getHours()
  if (hour < 6)
    return '凌晨 00:00–05:59'
  if (hour < 12)
    return '上午 06:00–11:59'
  if (hour < 18)
    return '下午 12:00–17:59'
  return '晚上 18:00–23:59'
}

function toggleSelection(visitorSessionId: string, checked: boolean) {
  emit('selectIds', checked
    ? [...new Set([...props.selectedIds, visitorSessionId])]
    : props.selectedIds.filter(id => id !== visitorSessionId))
}
</script>

<template>
  <section :class="['overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm', 'dark:border-slate-800 dark:bg-slate-900']">
    <div :class="['border-b border-slate-200 px-5 py-4 dark:border-slate-800']">
      <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
        接待紀錄
      </h2>
    </div>
    <div v-if="props.sessions.length" :class="['divide-y divide-slate-100 dark:divide-slate-800']">
      <section v-for="group in sessionGroups" :key="group.label">
        <h3 :class="['m-0 bg-slate-50 px-5 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-800/60 dark:text-slate-300']">{{ group.label }}</h3>
        <section v-for="period in group.periods" :key="period.period">
          <h4 :class="['m-0 border-t border-slate-100 px-5 py-2 text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400']">{{ period.period }}</h4>
          <ul :class="['m-0 divide-y divide-slate-100 p-0 dark:divide-slate-800']">
          <li v-for="session in period.sessions" :key="session.id" :class="['flex items-stretch']">
        <label :class="['flex items-center px-3']">
          <input type="checkbox" :checked="props.selectedIds.includes(session.id)" aria-label="選取此筆接待紀錄" @change="toggleSelection(session.id, ($event.target as HTMLInputElement).checked)">
        </label>
        <button
          type="button"
          :class="['flex min-w-0 flex-1 items-start gap-3 py-4 pr-5 text-left transition-colors', props.selectedId === session.id ? 'bg-cyan-50 dark:bg-cyan-400/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60']"
          @click="emit('select', session.id)"
        >
          <span :class="['i-solar:chat-round-dots-bold-duotone mt-0.5 rounded-lg bg-cyan-50 p-2 text-lg text-cyan-700', 'dark:bg-cyan-400/10 dark:text-cyan-300']" />
          <span :class="['min-w-0 flex-1']">
            <span :class="['flex items-center justify-between gap-3']">
              <span :class="['truncate text-sm font-semibold text-slate-950 dark:text-white']">{{ session.deviceLabel }}</span>
              <span :class="['shrink-0 text-xs text-slate-500 dark:text-slate-400']">{{ stateLabel(session.state) }}</span>
            </span>
            <span :class="['mt-1 block text-xs text-slate-500 dark:text-slate-400']">{{ formatDate(session.createdAt) }} · {{ session.interactionCount }} 個事件</span>
          </span>
        </button>
      </li>
        </ul>
        </section>
      </section>
    </div>
    <p v-else :class="['m-0 px-5 py-8 text-sm text-slate-500 dark:text-slate-400']">
      此店別目前沒有保留中的接待紀錄。
    </p>
  </section>
</template>
