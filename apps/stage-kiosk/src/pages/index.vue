<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'

import KioskDraftPreview from '../components/KioskDraftPreview.vue'
import KioskEnrollment from '../components/kioskEnrollment.vue'
import KioskScene from '../components/KioskScene.vue'
import KioskStandby from '../components/kioskStandby.vue'

import { useKioskCharacterAsset } from '../composables/useKioskCharacterAsset'
import { useKioskDeviceRegistration } from '../composables/useKioskDeviceRegistration'
import { applyKioskProfile } from '../composables/useKioskInteractiveServices'
import { waitForKioskRuntime } from '../services/kiosk-runtime-initialization'

const {
  bootstrap,
  device,
  deviceSettings,
  error,
  mediaCaptureMode,
  proactiveVlmEnabled,
  performanceProfile,
  profile,
  registerDevelopmentDevice,
  state,
  voiceVadSettings,
} = useKioskDeviceRegistration()
const route = useRoute()
const isDraftPreview = computed(() => route.query.preview === 'webnavior')
const kioskCharacterAsset = useKioskCharacterAsset()
const profileReady = shallowRef(false)
const profileSyncError = shallowRef<string>()
const voiceConversationOnly = computed(() => Boolean(
  profile.value?.snapshot.voiceConversationOnly,
))

onMounted(async () => {
  await waitForKioskRuntime()
  await bootstrap()
})

watch(profile, async (assignedProfile) => {
  profileReady.value = false
  profileSyncError.value = undefined
  if (!assignedProfile)
    return

  try {
    applyKioskProfile(assignedProfile)
    await kioskCharacterAsset.apply(assignedProfile)
    profileReady.value = true
  }
  catch (error) {
    console.error('Failed to synchronize kiosk character asset:', error)
    profileSyncError.value = '無法套用 Server 發佈的角色設定。請確認角色資產與 Server 連線後重新整理。'
  }
}, { immediate: true })
</script>

<template>
  <KioskDraftPreview v-if="isDraftPreview" />
  <KioskScene v-else-if="state === 'registered' && device && profile && profileReady" :device="device" :device-settings="deviceSettings?.effective" :media-capture-mode="mediaCaptureMode" :performance-profile="performanceProfile" :proactive-vlm-enabled="proactiveVlmEnabled" :voice-conversation-only="voiceConversationOnly" :voice-vad-settings="voiceVadSettings" />
  <main v-else-if="state === 'registered' && device && profileSyncError" :class="['grid h-dvh place-items-center bg-slate-950 p-6 text-center text-slate-200']">
    <div :class="['max-w-xl space-y-3']">
      <h1 :class="['text-2xl font-semibold']">
        角色設定同步失敗
      </h1>
      <p :class="['text-slate-400']">
        {{ profileSyncError }}
      </p>
    </div>
  </main>
  <main v-else-if="state === 'registered' && device && profile" :class="['grid h-dvh place-items-center bg-slate-950 p-6 text-center text-slate-300']">
    正在同步 Server 發佈的角色設定…
  </main>
  <KioskStandby v-else-if="state === 'registered' && device" :device="device" :profile="profile" />
  <KioskEnrollment
    v-else
    :error="error"
    :registering="state === 'registering'"
    @register="registerDevelopmentDevice"
  />
</template>

<route lang="yaml">
meta:
  layout: plain
</route>
