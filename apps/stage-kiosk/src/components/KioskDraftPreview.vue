<script setup lang="ts">
import type { KioskProfile } from '../services/kiosk-device'

import { defaultKioskVoiceVadSettings } from '@proj-airi/kiosk-proactive'
import { onMounted, onUnmounted, shallowRef } from 'vue'

import KioskScene from './KioskScene.vue'

import { useKioskCharacterAsset } from '../composables/useKioskCharacterAsset'
import { applyKioskProfile } from '../composables/useKioskInteractiveServices'
import { waitForKioskRuntime } from '../services/kiosk-runtime-initialization'

const ready = shallowRef(false)
const profile = shallowRef<KioskProfile>()
const kioskCharacterAsset = useKioskCharacterAsset()
// A draft iframe has no registered kiosk credential, so it cannot use the
// Server-owned audio gateway. Keep its text composer available for preview.
const voiceConversationOnly = false

async function receiveDraft(event: MessageEvent<unknown>) {
  if (event.source !== window.parent || !event.data || typeof event.data !== 'object')
    return
  const payload = event.data as { type?: unknown, profile?: KioskProfile }
  if (payload.type !== 'webnavior:kiosk-draft-preview' || !payload.profile)
    return
  try {
    await waitForKioskRuntime()
    applyKioskProfile(payload.profile)
    await kioskCharacterAsset.apply(payload.profile)
    profile.value = payload.profile
    ready.value = true
  }
  catch (error) {
    console.error('Failed to synchronize preview character asset:', error)
  }
}

onMounted(() => window.addEventListener('message', receiveDraft))
onUnmounted(() => window.removeEventListener('message', receiveDraft))
</script>

<template>
  <KioskScene v-if="ready" media-capture-mode="off" performance-profile="constrained" :proactive-vlm-enabled="false" :voice-conversation-only="voiceConversationOnly" :voice-vad-settings="defaultKioskVoiceVadSettings" />
  <main v-else :class="['grid h-dvh place-items-center bg-slate-950 p-6 text-center text-slate-300']">
    正在載入草稿預覽…
  </main>
</template>
