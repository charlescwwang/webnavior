<script setup lang="ts">
import { RouterView } from 'vue-router'

import AdminSidebar from '../components/Webnavior/AdminSidebar.vue'
</script>

<template>
  <div :class="['min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100', 'lg:flex']">
    <AdminSidebar />
    <main :class="['min-w-0 flex-1']">
      <header :class="['flex min-h-18 items-center justify-between border-b border-slate-200 bg-white px-5 py-4', 'dark:border-slate-800 dark:bg-slate-900 lg:px-8']">
        <div>
          <p :class="['m-0 text-sm font-semibold text-slate-950 dark:text-white']">
            Webnavior Control Center
          </p>
          <p :class="['m-0 text-xs text-slate-500 dark:text-slate-400']">
            集中管理 Kiosk 與互動服務
          </p>
        </div>
        <span :class="['rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700', 'dark:bg-emerald-400/10 dark:text-emerald-300']">POC</span>
      </header>
      <div :class="['mx-auto w-full max-w-7xl p-5 lg:p-8']">
        <RouterView />
      </div>
    </main>
  </div>
</template>
