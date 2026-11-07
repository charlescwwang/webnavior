import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings/audio-device'
import { createPinia, storeToRefs } from 'pinia'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, ref, watch } from 'vue'
import { createI18n } from 'vue-i18n'

import { prepareKioskMicrophonePermission } from '../services/kiosk-startup-permission-gate'
import { useArrayMicrophone } from './useArrayMicrophone'
import { useKioskTextOnlyMode } from './useKioskTextOnlyMode'

// Report: this chat,2026-11-06 — automatic and operator microphone startup appeared inactive.
it.each([true, false])('acquires a real browser stream after reload with persisted enabled=%s', async (persisted) => {
  localStorage.setItem('settings/audio/input/enabled', JSON.stringify(persisted))
  let device!: ReturnType<typeof useSettingsAudioDevice>
  let microphone!: ReturnType<typeof useArrayMicrophone>
  const view = render(defineComponent({ setup() {
    device = useSettingsAudioDevice()
    const { stream, enabled } = storeToRefs(device)
    microphone = useArrayMicrophone(stream, enabled)
    return () => h('div', microphone.status.value)
  } }), { global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] } })
  try {
    await prepareKioskMicrophonePermission({ hasSelectedMicrophone: true, requestDevices: async () => {}, voiceConversationOnly: true, signal: new AbortController().signal, startStream: () => device.startStream(), setAudioInputEnabled: value => device.enabled = value })
    expect(device.enabled).toBe(true)
    await expect.poll(() => microphone.stream.value?.getAudioTracks()[0]?.readyState).toBe('live')
    expect(device.stream?.getAudioTracks()[0]?.readyState).toBe('live')
  }
  finally {
    device.enabled = false
    device.stopStream()
    view.unmount()
    localStorage.removeItem('settings/audio/input/enabled')
  }
}, 20000)

// Report: this chat,2026-11-06 — changing pure text mode must restore actual capture.
it('stops capture for device text mode and reacquires it when the Server mode is turned off', async () => {
  localStorage.setItem('kiosk/conversation/text-only', 'true')
  const deviceTextOnly = ref(false)
  let device!: ReturnType<typeof useSettingsAudioDevice>
  let microphone!: ReturnType<typeof useArrayMicrophone>
  const view = render(defineComponent({ setup() {
    device = useSettingsAudioDevice()
    const { stream, enabled } = storeToRefs(device)
    const text = useKioskTextOnlyMode(deviceTextOnly)
    microphone = useArrayMicrophone(stream, enabled)
    watch(text, (isText, _previous, cleanup) => {
      const controller = new AbortController()
      cleanup(() => controller.abort())
      if (isText) {
        device.enabled = false
        return
      }
      void prepareKioskMicrophonePermission({ hasSelectedMicrophone: true, requestDevices: async () => {}, voiceConversationOnly: true, signal: controller.signal, startStream: () => device.startStream(), setAudioInputEnabled: value => device.enabled = value }).catch((error) => {
        if (!controller.signal.aborted)
          throw error
      })
    }, { immediate: true })
    return () => h('button', { onClick: () => deviceTextOnly.value = !deviceTextOnly.value }, 'Toggle text')
  } }), { global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] } })
  try {
    await expect.poll(() => microphone.stream.value?.getAudioTracks()[0]?.readyState).toBe('live')
    const oldTrack = device.stream!.getAudioTracks()[0]
    await view.getByRole('button', { name: 'Toggle text' }).click()
    await expect.poll(() => device.enabled).toBe(false)
    await expect.poll(() => oldTrack.readyState).toBe('ended')
    expect(microphone.stream.value).toBeUndefined()
    await view.getByRole('button', { name: 'Toggle text' }).click()
    await expect.poll(() => microphone.stream.value?.getAudioTracks()[0]?.readyState).toBe('live')
    expect(device.enabled).toBe(true)
    expect(device.stream!.getAudioTracks()[0]).not.toBe(oldTrack)
  }
  finally {
    device.enabled = false
    device.stopStream()
    view.unmount()
    localStorage.removeItem('kiosk/conversation/text-only')
  }
}, 20000)
