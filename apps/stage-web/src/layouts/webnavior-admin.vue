<script setup lang="ts">
import { useBuildInfo } from '@proj-airi/stage-ui/composables/use-build-info'
import { signOut, triggerSignIn } from '@proj-airi/stage-ui/libs/auth'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterView } from 'vue-router'

import AdminSidebar from '../components/Webnavior/AdminSidebar.vue'
import WebnaviorNoticeCenter from '../components/Webnavior/WebnaviorNoticeCenter.vue'

import { useKioskManagement } from '../composables/useKioskManagement'

const { t } = useI18n()
const buildInfo = useBuildInfo()
const signingOut = shallowRef(false)
const { user } = storeToRefs(useAuthStore())
const { selectedSite } = useKioskManagement()

async function signOutAndSwitchAccount() {
  if (signingOut.value)
    return

  signingOut.value = true
  try {
    await signOut()
    await triggerSignIn()
  }
  catch {
    // The current page remains usable if a network problem prevents the new
    // authorization flow from starting. The previous local credentials are
    // already cleared by signOut().
    signingOut.value = false
  }
}
</script>

<template>
  <div :class="['min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100', 'lg:flex']">
    <WebnaviorNoticeCenter />
    <AdminSidebar />
    <main :class="['min-w-0 flex-1']">
      <header :class="['flex min-h-18 items-center justify-between border-b border-slate-200 bg-white px-5 py-4', 'dark:border-slate-800 dark:bg-slate-900 lg:px-8']">
        <div>
          <p :class="['m-0 text-sm font-semibold text-slate-950 dark:text-white']">
            Webnavior Control Center
          </p>
          <p :class="['m-0 text-xs text-slate-500 dark:text-slate-400']">
            {{ selectedSite && $route.path !== '/admin/kiosk/devices' ? `管理店別：${selectedSite.name}` : '集中管理 Kiosk 與互動服務' }}
          </p>
        </div>
        <div :class="['flex items-center gap-3']">
          <div :class="['hidden text-right sm:block']">
            <p :class="['m-0 text-sm font-semibold text-slate-900 dark:text-white']">
              {{ user?.name ?? '未登入' }}
            </p>
            <p :class="['m-0 text-xs text-slate-500 dark:text-slate-400']">
              {{ user?.email ?? '登入資訊載入中' }}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            :disabled="signingOut"
            @click="signOutAndSwitchAccount"
          >
            <span :class="['i-solar:logout-2-bold-duotone text-base']" />
            {{ signingOut ? '登出中…' : '登出／切換帳號' }}
          </Button>
        </div>
      </header>
      <div :class="['mx-auto w-full max-w-7xl p-5 lg:p-8']">
        <RouterView />
        <footer :class="['mt-8 text-xs text-slate-500 dark:text-slate-400']" data-build-info>
          {{ t('stage.kiosk.release.loaded') }}：{{ buildInfo.commit }} · {{ buildInfo.builtOn }}
          <a href="/kiosk/admin-recover.html" :class="['ml-3 underline']">{{ t('stage.kiosk.release.recover') }}</a>
        </footer>
      </div>
    </main>
  </div>
</template>
