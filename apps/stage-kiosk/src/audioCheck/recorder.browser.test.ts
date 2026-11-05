import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { userEvent } from 'vitest/browser'
import { effectScope } from 'vue'

import App from './app.vue'

import { useRecorder } from './useRecorder'

const button = (label: string) => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === label)!

it('shows denied permission and rejects an invalid mapping before opening hardware', async () => {
  const permission = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))
  const view = render(App)
  try {
    await userEvent.click(button('允許麥克風並列出裝置'))
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('Permission denied'))
    expect(permission).toHaveBeenCalledTimes(1)
    const scope = effectScope()
    const audio = scope.run(useRecorder)!
    audio.selected.value = 'synthetic'
    audio.mapping.value = '0,0,2,3,4,5,6'
    await audio.connect()
    expect(audio.error.value).toContain('七個不同')
    expect(permission).toHaveBeenCalledTimes(1)
    audio.mapping.value = ',1,2,3,4,5,6'
    await audio.connect()
    expect(audio.error.value).toContain('七個不同')
    expect(permission).toHaveBeenCalledTimes(1)
    permission.mockRejectedValue(new DOMException('No eight-channel input', 'OverconstrainedError'))
    audio.mapping.value = '0,1,2,3,4,5,6'
    await audio.connect()
    expect(audio.error.value).toContain('裝置未提供八聲道')
    expect(permission).toHaveBeenCalledTimes(2)
    scope.stop()
  }
  finally {
    view.unmount()
    vi.restoreAllMocks()
  }
})

it('records a local synthetic eight-channel clip, cancels safely and offers valid playback/downloads', async () => {
  const contexts: AudioContext[] = []
  const tracks: MediaStreamTrack[] = []
  const device: MediaDeviceInfo = { deviceId: 'synthetic-array', groupId: 'fixture', kind: 'audioinput', label: 'UMA-8 synthetic fixture', toJSON: () => ({}) }
  vi.spyOn(navigator.mediaDevices, 'enumerateDevices').mockResolvedValue([device])
  // Only the hardware IO boundary is replaced. Real Web Audio, Worklet, WAV encoding and UI run.
  const permission = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(async () => {
    const context = new AudioContext({ sampleRate: 48000 })
    contexts.push(context)
    const destination = context.createMediaStreamDestination()
    destination.channelCount = 8
    const merger = context.createChannelMerger(8)
    for (let ch = 0; ch < 8; ch++) {
      const source = context.createConstantSource()
      source.offset.value = (ch + 1) / 100
      source.connect(merger, 0, ch)
      source.start()
    }
    merger.connect(destination)
    await context.resume()
    const track = destination.stream.getAudioTracks()[0]!
    tracks.push(track)
    vi.spyOn(track, 'getSettings').mockReturnValue({ channelCount: 8, sampleRate: 48000 })
    return destination.stream
  })
  const view = render(App)
  try {
    expect(permission).not.toHaveBeenCalled()
    await userEvent.click(button('允許麥克風並列出裝置'))
    await vi.waitFor(() => expect(button('開啟八聲道收音').disabled).toBe(false))
    expect(tracks[0]!.readyState).toBe('ended')
    await userEvent.click(button('開啟八聲道收音'))
    await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain('已就緒'))
    await userEvent.click(button('錄製 15 秒比較'))
    await userEvent.click(button('取消這次錄音'))
    expect(document.querySelectorAll('audio')).toHaveLength(0)
    await userEvent.click(button('錄製 15 秒比較'))
    await vi.waitFor(() => expect(document.querySelectorAll('audio')).toHaveLength(2), { timeout: 20000 })
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a[download]')]
    expect(links).toHaveLength(4)
    const raw = links.find(link => link.download.endsWith('-raw.wav'))!
    const bytes = new DataView(await (await fetch(raw.href)).arrayBuffer())
    expect(bytes.getUint16(22, true)).toBe(8)
    expect(bytes.getUint32(24, true)).toBe(48000)
    expect(bytes.byteLength).toBe(23040044)
    const details = links.find(link => link.download.endsWith('-details.json'))!
    const info = await (await fetch(details.href)).json()
    expect(info.frameCount).toBe(720000)
    expect(info.position).toBe('front')
    expect(info.mappingVerified).toBe(false)
    expect(info.channelMap).toEqual([0, 1, 2, 3, 4, 5, 6])
    for (const player of document.querySelectorAll('audio')) {
      await vi.waitFor(() => expect(player.readyState).toBeGreaterThanOrEqual(1))
      expect(player.error).toBeNull()
      expect(player.duration).toBeCloseTo(15, 3)
    }
    await userEvent.click(button('停止收音'))
    expect(tracks.at(-1)!.readyState).toBe('ended')
    expect(document.querySelectorAll('audio')).toHaveLength(2)
  }
  finally {
    view.unmount()
    for (const context of contexts) await context.close()
    vi.restoreAllMocks()
  }
}, 30000)
