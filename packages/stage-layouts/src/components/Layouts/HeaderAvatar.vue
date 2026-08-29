<script setup lang="ts">
import { isAccountFeaturesEnabled } from '@proj-airi/stage-shared'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const accountFeaturesEnabled = isAccountFeaturesEnabled()
const { t } = useI18n()
const authStore = useAuthStore()
const { isAuthenticated, user } = storeToRefs(authStore)

function requestLogin() {
  authStore.needsLogin = true
}
</script>

<template>
  <div :class="['flex', 'items-center', 'gap-2']">
    <RouterLink
      border="2 solid neutral-100/60 dark:neutral-800/30"
      bg="neutral-50/70 dark:neutral-800/70"
      w-fit flex items-center justify-center rounded-xl p-2 backdrop-blur-md
      title="Settings"
      to="/settings"
    >
      <div i-solar:settings-minimalistic-bold-duotone size-5 text="neutral-500 dark:neutral-400" />
    </RouterLink>

    <RouterLink
      v-if="accountFeaturesEnabled && isAuthenticated"
      border="2 solid neutral-100/60 dark:neutral-800/30"
      bg="neutral-50/70 dark:neutral-800/70"
      :class="['max-w-40', 'flex', 'items-center', 'gap-2', 'rounded-xl', 'px-3', 'py-2', 'text-sm', 'backdrop-blur-md']"
      title="Account settings"
      to="/settings/account"
    >
      <div i-solar:user-circle-bold-duotone size-5 text="neutral-500 dark:neutral-400" />
      <span truncate text="neutral-600 dark:neutral-300">{{ user?.email ?? user?.name }}</span>
    </RouterLink>

    <button
      v-else-if="accountFeaturesEnabled"
      type="button"
      border="2 solid neutral-100/60 dark:neutral-800/30"
      bg="neutral-50/70 dark:neutral-800/70"
      :class="['flex', 'items-center', 'gap-2', 'rounded-xl', 'px-3', 'py-2', 'text-sm', 'backdrop-blur-md']"
      @click="requestLogin"
    >
      <div i-solar:login-3-bold-duotone size-5 text="neutral-500 dark:neutral-400" />
      <span text="neutral-600 dark:neutral-300">{{ t('settings.dialogs.onboarding.loginAction') }}</span>
    </button>
  </div>
</template>
