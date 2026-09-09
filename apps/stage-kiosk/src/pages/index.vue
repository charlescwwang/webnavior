<script setup lang="ts">
import { onMounted, watch } from 'vue'

import KioskEnrollment from '../components/kioskEnrollment.vue'
import KioskScene from '../components/KioskScene.vue'
import KioskStandby from '../components/kioskStandby.vue'

import { useKioskDeviceRegistration } from '../composables/useKioskDeviceRegistration'
import { applyKioskProfile } from '../composables/useKioskInteractiveServices'

const {
  bootstrap,
  device,
  error,
  profile,
  registerDevelopmentDevice,
  state,
} = useKioskDeviceRegistration()

onMounted(() => void bootstrap())

watch(profile, (assignedProfile) => {
  if (assignedProfile)
    applyKioskProfile(assignedProfile)
}, { immediate: true })
</script>

<template>
  <KioskScene v-if="state === 'registered' && device && profile" />
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
