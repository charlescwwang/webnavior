import { expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'

import { inspectChannels } from './microphoneInput'

it.each([1, 2, 8])('observes %i actual channels without upmixing or recording the probe', async (channels) => {
  const context = new AudioContext({ sampleRate: 48000 })
  const source = context.createBufferSource()
  const buffer = context.createBuffer(channels, 48000, 48000)
  for (let channel = 0; channel < channels; channel++) {
    const samples = buffer.getChannelData(channel)
    for (let frame = 0; frame < samples.length; frame++)
      samples[frame] = 0.01 * Math.sin(2 * Math.PI * (channel + 1) * 137 * frame / 48000)
  }
  source.buffer = buffer
  source.loop = true
  source.start()
  const button = document.createElement('button')
  button.textContent = 'Enable channel detection'
  button.onclick = () => {
    void context.resume()
  }
  document.body.append(button)
  await userEvent.click(button)
  button.remove()
  try {
    expect(await inspectChannels(source, new AbortController().signal)).toBe(channels)
    expect(context.state).toBe('running')
  }
  finally {
    await context.close()
  }
}, 10000)

it('cancels an obsolete probe without closing a borrowed context', async () => {
  const context = new AudioContext({ sampleRate: 48000 })
  const source = context.createBufferSource()
  source.buffer = context.createBuffer(8, 48000, 48000)
  const controller = new AbortController()
  const result = inspectChannels(source, controller.signal)
  controller.abort(new Error('Device replaced'))
  try {
    await expect(result).rejects.toThrow('Device replaced')
    expect(context.state).not.toBe('closed')
  }
  finally {
    await context.close()
  }
})
