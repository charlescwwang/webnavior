<script setup lang="ts">
import { onMounted, shallowRef } from 'vue'

import KioskAdminPanel from '../../components/KioskAdminPanel.vue'

import { useFeedbackInvitationSettings } from '../../composables/useFeedbackInvitationSettings'
import { useKioskDeviceRegistration } from '../../composables/useKioskDeviceRegistration'
import { useKioskInteractiveServiceAgentInstructions, useKioskInteractiveServices } from '../../composables/useKioskInteractiveServices'
import { useKioskProactiveSettings } from '../../composables/useKioskProactiveSettings'

const paused = shallowRef(false)
const proactiveSettings = useKioskProactiveSettings()
const interactiveServices = useKioskInteractiveServices()
const interactiveServiceAgentInstructions = useKioskInteractiveServiceAgentInstructions()
const feedbackInvitationSettings = useFeedbackInvitationSettings()
const { bootstrap, device } = useKioskDeviceRegistration()

onMounted(() => void bootstrap())
</script>

<template>
  <KioskAdminPanel
    v-model:paused="paused"
    v-model:proactive-settings="proactiveSettings"
    v-model:interactive-services="interactiveServices"
    v-model:interactive-service-agent-instructions="interactiveServiceAgentInstructions"
    v-model:feedback-invitation-settings="feedbackInvitationSettings"
    :device="device"
    :session-ending="false"
    proactive-status="idle"
    @close="$router.push('/')"
  />
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
