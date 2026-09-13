<script setup lang="ts">
import type { DeviceSettingKey, DeviceSettingsSnapshot, DeviceSettingsValues } from '@proj-airi/kiosk-proactive'

import { onUnmounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import DeviceSettingsEditor from './deviceSettingsEditor.vue'

import { getAuthToken } from '../../../libs/auth'

const props = defineProps<{ endpoint: string, mode: 'admin' | 'local' }>()
const { t } = useI18n()
const snapshot = shallowRef<DeviceSettingsSnapshot>()
const message = shallowRef('')
const saving = shallowRef(false)
let activeRequest: AbortController | undefined

async function request(change?: { version: number, overrides: Partial<DeviceSettingsValues>, localControls: DeviceSettingKey[], clearLocalOverrides: DeviceSettingKey[] }) {
  activeRequest?.abort()
  const controller = new AbortController()
  activeRequest = controller
  saving.value = true
  message.value = ''
  try {
    const token = getAuthToken()
    // Local writes require both identities: the HttpOnly device cookie scopes
    // the target, while the account session/Bearer identifies the operator.
    const response = await fetch(props.endpoint, {
      method: change ? 'PUT' : 'GET',
      credentials: 'include',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: change ? JSON.stringify(props.mode === 'admin' ? change : { version: change.version, overrides: change.overrides }) : undefined,
    })
    if (controller.signal.aborted)
      return
    if (!response.ok) {
      message.value = t(response.status === 409 ? 'deviceSettings.conflict' : response.status === 401 ? 'deviceSettings.loginRequired' : 'deviceSettings.failed')
      return
    }
    const next = await response.json() as DeviceSettingsSnapshot
    if (!controller.signal.aborted) {
      snapshot.value = next
      if (change)
        message.value = t('deviceSettings.saved')
    }
  }
  catch {
    if (!controller.signal.aborted)
      message.value = t('deviceSettings.failed')
  }
  finally {
    if (activeRequest === controller)
      saving.value = false
  }
}

watch(() => props.endpoint, () => {
  snapshot.value = undefined
  void request()
}, { immediate: true })
onUnmounted(() => activeRequest?.abort())
</script>

<template>
  <section :class="['rounded-xl border p-4']">
    <h2>{{ t('deviceSettings.title') }}</h2>
    <p v-if="mode === 'local'">
      {{ t('deviceSettings.loginRequired') }}
      <a href="/login" target="_blank" rel="noopener">{{ t('deviceSettings.login') }}</a>
    </p>
    <p v-if="message" role="status">
      {{ message }}
    </p>
    <DeviceSettingsEditor v-if="snapshot" :snapshot="snapshot" :mode="mode" :saving="saving" @save="request" @reload="request()" />
    <button v-else type="button" :disabled="saving" @click="request()">
      {{ t('deviceSettings.reload') }}
    </button>
  </section>
</template>
