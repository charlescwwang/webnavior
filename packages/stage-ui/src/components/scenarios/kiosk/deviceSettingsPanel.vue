<script setup lang="ts">
import type { DeviceSettingsSnapshot, DeviceSettingsValues } from '@proj-airi/kiosk-proactive'

import { useEventListener, useIntervalFn } from '@vueuse/core'
import { onUnmounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import DeviceSettingsEditor from './deviceSettingsEditor.vue'

import { getAuthToken, triggerSignIn } from '../../../libs/auth'

const props = defineProps<{ endpoint: string, mode: 'admin' | 'local' }>()
const emit = defineEmits<{ updated: [snapshot: DeviceSettingsSnapshot] }>()
const { t } = useI18n()
const snapshot = shallowRef<DeviceSettingsSnapshot>()
const message = shallowRef('')
const saving = shallowRef(false)
const dirty = shallowRef(false)
const failureStatus = shallowRef<number>()
let activeRequest: AbortController | undefined

async function request(change?: { version: number, overrides: Partial<DeviceSettingsValues> }, quiet = false) {
  activeRequest?.abort()
  const controller = new AbortController()
  activeRequest = controller
  saving.value = true
  if (!quiet) {
    message.value = ''
    failureStatus.value = undefined
  }
  try {
    const token = props.mode === 'admin' ? getAuthToken() : null
    // Local writes use device + Server-verified PIN cookies. Management writes
    // retain the existing account Bearer/session authorization.
    const response = await fetch(props.endpoint, {
      method: change ? 'PUT' : 'GET',
      credentials: 'include',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: change ? JSON.stringify(change) : undefined,
    })
    if (controller.signal.aborted)
      return
    if (!response.ok) {
      if (!quiet) {
        failureStatus.value = response.status
        if (response.status === 401 && change)
          message.value = t(props.mode === 'local' ? 'deviceSettings.savePinRequired' : 'deviceSettings.saveLoginRequired')
        else if (response.status === 403 && change)
          message.value = t(props.mode === 'local' ? 'deviceSettings.saveLocalForbidden' : 'deviceSettings.saveForbidden')
        else
          message.value = t(response.status === 409 ? 'deviceSettings.conflict' : response.status === 401 ? 'deviceSettings.loginRequired' : 'deviceSettings.failed')
      }
      return
    }
    const next = await response.json() as DeviceSettingsSnapshot
    if (!controller.signal.aborted) {
      if (!change && dirty.value && quiet)
        return
      if (!quiet || JSON.stringify(snapshot.value) !== JSON.stringify(next))
        snapshot.value = next
      emit('updated', next)
      dirty.value = false
      if (change) {
        message.value = t('deviceSettings.saved')
      }
    }
  }
  catch {
    if (!controller.signal.aborted && !quiet) {
      failureStatus.value = 0
      message.value = t('deviceSettings.failed')
    }
  }
  finally {
    if (activeRequest === controller)
      saving.value = false
  }
}

watch(() => props.endpoint, () => {
  dirty.value = false
  snapshot.value = undefined
  void request()
}, { immediate: true })
// Refresh clean editors on both surfaces; stale drafts retain their revision
// and receive HTTP 409 if another operator saves before they do.
function refresh() {
  if (!dirty.value && !saving.value)
    void request(undefined, true)
}
useEventListener(window, 'focus', refresh)
useIntervalFn(refresh, 10_000)
onUnmounted(() => activeRequest?.abort())
</script>

<template>
  <section :class="['rounded-xl border p-4']">
    <h2>{{ t('deviceSettings.title') }}</h2>
    <p v-if="mode === 'local'">
      {{ t('deviceSettings.localAccess') }}
    </p>
    <p v-if="message && !snapshot" role="status">
      {{ message }}
    </p>
    <DeviceSettingsEditor v-if="snapshot" :snapshot="snapshot" :mode="mode" :saving="saving" @save="request" @reload="request()" @dirty="dirty = $event">
      <template #status>
        <p v-if="message" role="status" aria-live="polite" :class="[failureStatus !== undefined ? 'font-semibold text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300']">
          {{ message }}
        </p>
        <slot v-if="mode === 'local' && failureStatus === 401" name="reauthorize" />
        <button v-if="mode === 'admin' && (failureStatus === 401 || failureStatus === 403)" type="button" @click="triggerSignIn()">
          {{ t('deviceSettings.login') }}
        </button>
      </template>
    </DeviceSettingsEditor>
    <button v-else type="button" :disabled="saving" @click="request()">
      {{ t('deviceSettings.reload') }}
    </button>
  </section>
</template>
