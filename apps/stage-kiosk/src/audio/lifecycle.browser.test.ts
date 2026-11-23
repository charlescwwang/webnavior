import { expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { effectScope, ref } from 'vue'

import { useArrayMicrophone } from '../composables/useArrayMicrophone'

it('redetects ordinary input after restart or replacement without owning device selection', async () => {
  localStorage.setItem('kiosk/audio/array-mode', 'lcmv')
  const context = new AudioContext()
  const destination = context.createMediaStreamDestination()
  const replacement = context.createMediaStreamDestination()
  const oscillator = context.createOscillator()
  oscillator.connect(destination)
  oscillator.connect(replacement)
  oscillator.start()
  const raw = destination.stream
  const other = replacement.stream
  // NOTICE: Web Audio destination tracks have no microphone echo/noise controls.
  // Keep their real stream/Worklet transport, controlling only this hardware IO.
  vi.spyOn(raw.getAudioTracks()[0]!, 'applyConstraints').mockResolvedValue()
  vi.spyOn(other.getAudioTracks()[0]!, 'applyConstraints').mockResolvedValue()
  const button = document.createElement('button')
  button.textContent = 'Start lifecycle fixture'
  button.onclick = () => {
    void context.resume()
  }
  document.body.append(button)
  await userEvent.click(button)
  button.remove()
  const input = ref<MediaStream | undefined>(raw)
  const enabled = ref(true)
  const scope = effectScope()
  const audio = scope.run(() => useArrayMicrophone(input, enabled))!
  try {
    await vi.waitFor(() => expect({ status: audio.status.value, error: audio.error.value }).toEqual({ status: 'standard', error: '' }), { timeout: 7000 })
    expect(audio.stream.value).toBe(raw)
    expect(audio.mode.value).toBe('standard')
    expect(audio.error.value).toBe('')
    enabled.value = false
    await vi.waitFor(() => expect(audio.stream.value).toBeUndefined())
    enabled.value = true
    await vi.waitFor(() => expect(audio.stream.value).toBe(raw), { timeout: 7000 })
    input.value = other
    await vi.waitFor(() => expect(audio.stream.value).toBe(other), { timeout: 7000 })
    expect(audio.pcmSource.value).toBeUndefined()
    expect(raw.getAudioTracks()[0]!.readyState).toBe('live')
  }
  finally {
    scope.stop()
    expect(other.getAudioTracks()[0]!.readyState).toBe('live')
    raw.getTracks().forEach(track => track.stop())
    other.getTracks().forEach(track => track.stop())
    await context.close()
    vi.restoreAllMocks()
    localStorage.removeItem('kiosk/audio/array-mode')
  }
}, 20000)
