import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings/audio-device'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { useKioskMicrophoneSelection } from './useKioskMicrophoneSelection'

const storageKeys = ['kiosk/audio/input-device', 'kiosk/audio/automatic-device', 'settings/audio/input', 'settings/audio/input/enabled']
afterEach(() => {
  vi.restoreAllMocks()
  for (const key of storageKeys)
    localStorage.removeItem(key)
})
function setup() {
  let selection!: ReturnType<typeof useKioskMicrophoneSelection>
  let device!: ReturnType<typeof useSettingsAudioDevice>
  const pinia = createPinia()
  const view = render(defineComponent({ setup() {
    device = useSettingsAudioDevice()
    selection = useKioskMicrophoneSelection()
    return () => h('div', selection.message.value)
  } }), { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] } })
  return { view, selection, device, close() {
    view.unmount()
    // NOTICE: Pinia stores own effects outside component scopes. Dispose them
    // between cases so late storage/device watchers cannot acquire another case's
    // synthetic microphone after its component has already unmounted.
    disposePinia(pinia)
  } }
}
// Report: this chat,2026-11-07 — ideal8CH repeatedly selected the speakerphone.
// Real browser media/store APIs run here; only unavailable/wrong-device IO is
// controlled where necessary. No physical device or ASR acceptance is claimed.
it('ignores old automatic/default preferences and waits for an explicit operator choice', async () => {
  localStorage.setItem('kiosk/audio/automatic-device', 'true')
  localStorage.setItem('settings/audio/input', 'default')
  localStorage.setItem('settings/audio/input/enabled', 'true')
  const media = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
  const f = setup()
  try {
    await nextTick()
    expect(f.selection.microphone.value).toBe('')
    expect(f.selection.hasSelection.value).toBe(false)
    expect(f.device.enabled).toBe(false)
    await expect(f.selection.start()).rejects.toThrow('尚未選擇麥克風')
    expect(media).not.toHaveBeenCalled()
    expect(f.device.deviceConstraints.audio).toMatchObject({ deviceId: { exact: '__kiosk_microphone_selection_required__' } })
  }
  finally { f.close() }
})
it('pins a real chosen device through restart, browser-default changes and a new owner', async () => {
  const media = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
  const f = setup()
  let id = ''
  try {
    await f.selection.requestDevices()
    await vi.waitFor(() => expect(f.selection.devices.value.some(input => input.deviceId && !['default', 'communications'].includes(input.deviceId))).toBe(true), { timeout: 3000 })
    expect(f.device.enabled).toBe(false)
    id = f.selection.devices.value.find(input => input.deviceId && !['default', 'communications'].includes(input.deviceId))!.deviceId
    expect(id).toBeTruthy()
    f.selection.microphone.value = id
    await f.selection.start()
    expect(f.device.stream?.getAudioTracks()[0].getSettings().deviceId).toBe(id)
    expect(f.device.stream?.getAudioTracks()[0].readyState).toBe('live')
    f.device.stopStream()
    f.device.selectedAudioInput = 'default'
    await nextTick()
    expect(f.device.deviceConstraints.audio).toMatchObject({ deviceId: { exact: id }, channelCount: { ideal: 8 } })
    media.mockClear()
    await f.selection.start()
    expect(media).toHaveBeenCalled()
    for (const [constraints] of media.mock.calls)
      expect(constraints?.audio).toMatchObject({ deviceId: { exact: id } })
  }
  finally { f.close() }
  const reloaded = setup()
  try {
    expect(reloaded.selection.microphone.value).toBe(id)
    await reloaded.selection.start()
    expect(reloaded.device.stream?.getAudioTracks()[0].getSettings().deviceId).toBe(id)
  }
  finally { reloaded.close() }
}, 15000)
it('keeps a missing chosen identity pinned instead of retrying the conference/default microphone', async () => {
  const id = 'disconnected-uma8'
  localStorage.setItem('kiosk/audio/input-device', id)
  // NOTICE: Missing hardware cannot be simulated with Firefox's single fake
  // microphone. Fail only the real media-acquisition boundary and inspect every
  // retry issued by the unchanged shared device store.
  const media = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(new DOMException('Requested device not found', 'OverconstrainedError'))
  const f = setup()
  try {
    await expect(f.selection.start()).rejects.toThrow()
    expect(media).toHaveBeenCalled()
    for (const [constraints] of media.mock.calls)
      expect(constraints?.audio).toMatchObject({ deviceId: { exact: id } })
    expect(f.selection.microphone.value).toBe(id)
    expect(f.device.enabled).toBe(false)
    expect(f.device.stream).toBeUndefined()
  }
  finally { f.close() }
})
it('stops a mismatched returned stream before it can be admitted to VAD or ASR', async () => {
  const wrong = await navigator.mediaDevices.getUserMedia({ audio: true })
  localStorage.setItem('kiosk/audio/input-device', 'chosen-uma8')
  // NOTICE: Return a real browser track with a different device ID to reproduce
  // unexpected acquisition. The identity check and cleanup remain production code.
  vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(wrong)
  const f = setup()
  try {
    await expect(f.selection.start()).rejects.toThrow('未取得指定麥克風')
    expect(wrong.getAudioTracks()[0].readyState).toBe('ended')
    expect(f.device.enabled).toBe(false)
    expect(f.selection.microphone.value).toBe('chosen-uma8')
  }
  finally { f.close() }
})

it('keeps a device change as a draft until Apply and preserves the last successful saved device on failure', async () => {
  const f = setup()
  try {
    await f.selection.requestDevices()
    await vi.waitFor(() => expect(f.selection.devices.value.some(input => input.deviceId && !['default', 'communications'].includes(input.deviceId))).toBe(true))
    const id = f.selection.devices.value.find(input => input.deviceId && !['default', 'communications'].includes(input.deviceId))!.deviceId
    f.selection.microphone.value = id
    await f.selection.start()
    const previous = f.device.stream!.getAudioTracks()[0]
    f.device.enabled = true
    await nextTick()
    f.selection.microphone.value = 'missing-new-uma8'
    expect(previous.readyState).toBe('live')
    expect(f.selection.activeMicrophone.value).toBe(id)
    expect(f.selection.savedMicrophone.value).toBe(id)
    // NOTICE: Only missing-device acquisition is controlled. The old real
    // browser track, store, queue, identity checks and persistence stay live.
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(new DOMException('Device missing', 'NotFoundError'))
    await expect(f.selection.start()).rejects.toThrow('找不到指定麥克風')
    expect(previous.readyState).toBe('ended')
    expect(f.selection.savedMicrophone.value).toBe(id)
    expect(f.selection.activeMicrophone.value).toBe('')
  }
  finally { f.close() }
})
it('retires a pending old device before acquiring the newer choice', async () => {
  const context = new AudioContext()
  const old = context.createMediaStreamDestination().stream
  const next = context.createMediaStreamDestination().stream
  // NOTICE: Simulate two physical device identities only at browser IO boundaries.
  vi.spyOn(old.getAudioTracks()[0], 'getSettings').mockReturnValue({ deviceId: 'conference' })
  vi.spyOn(next.getAudioTracks()[0], 'getSettings').mockReturnValue({ deviceId: 'uma8' })
  const pending = Promise.withResolvers<MediaStream>()
  const media = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockReturnValueOnce(pending.promise).mockResolvedValue(next)
  const f = setup()
  try {
    f.selection.microphone.value = 'conference'
    const first = f.selection.start()
    const retired = expect(first).rejects.toThrow('retired')
    await vi.waitFor(() => expect(media).toHaveBeenCalledOnce())
    f.selection.microphone.value = 'uma8'
    const second = f.selection.start()
    await nextTick()
    expect(media).toHaveBeenCalledOnce()
    pending.resolve(old)
    await retired
    await second
    expect(old.getAudioTracks()[0].readyState).toBe('ended')
    expect(next.getAudioTracks()[0].readyState).toBe('live')
    expect(f.selection.activeMicrophone.value).toBe('uma8')
    expect(f.selection.savedMicrophone.value).toBe('uma8')
    expect(media.mock.calls.at(-1)?.[0]?.audio).toMatchObject({ deviceId: { exact: 'uma8' } })
  }
  finally {
    pending.resolve(old)
    f.close()
    await context.close()
  }
})
it('rejects a denied authorization retry rather than treating a prior device list as consent', async () => {
  const f = setup()
  // NOTICE: Permission outcome is the external browser/service boundary. The
  // production selection owner must reject it even if device labels are listed.
  vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))
  try {
    await expect(f.selection.requestDevices()).rejects.toThrow('尚未取得麥克風授權')
    expect(f.device.enabled).toBe(false)
    expect(f.device.stream).toBeUndefined()
  }
  finally { f.close() }
})

it('requests fresh native authorization after an earlier grant and never sends the discovery stream to capture', async () => {
  const f = setup()
  const media = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
  try {
    await f.selection.requestDevices()
    expect(f.selection.permissionState.value).toBe('granted')
    expect(f.device.stream).toBeUndefined()
    expect(f.device.enabled).toBe(false)
    const consent = await media.mock.results[0].value
    expect(consent.getAudioTracks()[0].readyState).toBe('ended')
    media.mockRejectedValue(new DOMException('Revoked', 'NotAllowedError'))
    await expect(f.selection.requestDevices()).rejects.toThrow('尚未取得麥克風授權')
    expect(media).toHaveBeenCalledTimes(2)
    expect(f.selection.permissionState.value).toBe('denied')
    expect(f.selection.savedMicrophone.value).toBe('')
  }
  finally { f.close() }
})
