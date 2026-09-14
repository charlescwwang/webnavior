<script setup lang="ts">
import { DeviceSettingsPanel } from '@proj-airi/stage-ui/components/scenarios/kiosk/deviceSettings'
import { onMounted, shallowRef } from 'vue'

import KioskAdminPanel from '../../components/KioskAdminPanel.vue'

import { useKioskCameraPreview } from '../../composables/useKioskCameraPreview'
import { useKioskDeviceRegistration } from '../../composables/useKioskDeviceRegistration'

const endpoint = new URL('/api/kiosk/settings', import.meta.env.VITE_API_SERVER_URL ?? 'http://localhost:5168').href
const paused = shallowRef(false)
const cameraPreviewEnabled = useKioskCameraPreview()
const { bootstrap, device } = useKioskDeviceRegistration()
onMounted(() => void bootstrap())
</script>

<template>
  <KioskAdminPanel
    v-model:paused="paused"
    v-model:camera-preview-enabled="cameraPreviewEnabled"
    :device="device"
    :session-ending="false"
    @close="$router.push('/')"
  >
    <template #device-settings>
      <DeviceSettingsPanel :endpoint="endpoint" mode="local" />
    </template>
  </KioskAdminPanel>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: Kiosk 現場設定
  subtitle: 設定
  description: 設定此裝置的主動互動與已核准的互動服務
  icon: i-solar:shop-2-bold-duotone
  settingsEntry: true
  order: 100
</route>
