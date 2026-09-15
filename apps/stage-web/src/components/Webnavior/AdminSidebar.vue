<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'

interface NavigationItem {
  icon: string
  label: string
  to: string
}

const route = useRoute()

const navigation: NavigationItem[] = [
  { icon: 'i-solar:widget-5-bold-duotone', label: '儀表板', to: '/admin' },
  { icon: 'i-solar:monitor-smartphone-bold-duotone', label: 'Kiosk 設備', to: '/admin/kiosk/devices' },
  { icon: 'i-solar:history-bold-duotone', label: '使用歷程', to: '/admin/kiosk/history' },
  { icon: 'i-solar:clipboard-list-bold-duotone', label: '互動體驗', to: '/admin/kiosk/profiles' },
  { icon: 'i-solar:play-circle-bold-duotone', label: '體驗預覽', to: '/admin/kiosk/preview' },
  { icon: 'i-solar:cpu-bolt-bold-duotone', label: '系統模型', to: '/admin/system/models' },
]

function isActive(item: NavigationItem) {
  return route.path === item.to
}
</script>

<template>
  <aside :class="['w-full shrink-0 border-b border-slate-800 bg-slate-950 text-slate-200', 'lg:min-h-screen lg:w-64 lg:border-b-0 lg:border-r']">
    <div :class="['flex items-center gap-3 px-5 py-5']">
      <div :class="['flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400 text-slate-950', 'text-xl shadow-lg shadow-cyan-400/20']">
        <span class="i-solar:compass-big-bold-duotone" />
      </div>
      <div>
        <p :class="['m-0 text-lg font-bold tracking-tight text-white']">
          Webnavior
        </p>
        <p :class="['m-0 text-xs text-slate-400']">
          管理後台
        </p>
      </div>
    </div>

    <nav :class="['flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible']" aria-label="Webnavior 管理選單">
      <RouterLink
        v-for="item in navigation"
        :key="item.to"
        :to="item.to"
        :class="[
          'flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
          isActive(item) ? 'bg-cyan-400 text-slate-950' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
        ]"
      >
        <span :class="[item.icon, 'text-lg']" />
        {{ item.label }}
      </RouterLink>
    </nav>

    <div :class="['hidden px-5 py-6 text-xs text-slate-500 lg:block']">
      Webnavior Control Center
    </div>
  </aside>
</template>
