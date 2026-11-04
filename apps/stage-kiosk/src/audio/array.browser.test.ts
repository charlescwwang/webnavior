import { expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import workletUrl from './array.worklet?worker&url'

import { ArrayBeamformer, designWeights } from './lcmv'

// Synthesised eight-channel graph: checks actual browser/worklet transport, not physical UMA-8 support.
it('records an aligned15-second comparison from the actual AudioWorklet', async () => {
  const context = new AudioContext({ sampleRate: 48000 })
  try {
    await context.audioWorklet.addModule(workletUrl)
    const node = new AudioWorkletNode(context, 'kiosk-array-lcmv', { outputChannelCount: [1], channelCount: 8, channelCountMode: 'explicit', channelInterpretation: 'discrete', processorOptions: { weights: designWeights(), channelMap: [0, 1, 2, 3, 4, 5, 6] } })
    const source = context.createBufferSource()
    const buffer = context.createBuffer(8, 96000, 48000)
    for (let ch = 0; ch < 8; ch++) {
      const samples = buffer.getChannelData(ch)
      for (let i = 0; i < samples.length; i++)
        samples[i] = 0.02 * Math.sin(2 * Math.PI * (ch + 1) * 137 * i / 48000) + (i % 9000 === 123 ? 0.1 : 0)
    }
    source.buffer = buffer
    source.loop = true
    source.connect(node)
    source.start()
    const silent = context.createGain()
    silent.gain.value = 0
    node.connect(silent).connect(context.destination)
    const button = document.createElement('button')
    button.textContent = 'Start audio fixture'
    button.onclick = () => {
      void context.resume()
    }
    document.body.append(button)
    await userEvent.click(button)
    button.remove()
    await vi.waitFor(() => expect(context.state).toBe('running'), { timeout: 3000 })
    const capture = new Promise<{ raw: Float32Array, reference: Float32Array, processed: Float32Array, sampleStart: number }>((resolve, reject) => {
      node.port.onmessage = ({ data }) => data.type === 'error' ? reject(new Error(data.reason)) : data.type === 'capture' ? resolve(data) : undefined
      node.onprocessorerror = () => reject(new Error('Processor failed'))
    })
    const raw = new Float32Array(720000 * 8)
    const reference = new Float32Array(720000)
    const processed = new Float32Array(720000)
    node.port.postMessage({ type: 'capture', id: 'browser', raw, reference, processed }, [raw.buffer, reference.buffer, processed.buffer])
    const result = await capture
    expect(result.processed.length).toBe(720000)
    expect(result.raw.length).toBe(720000 * 8)
    expect(result.sampleStart).toBeGreaterThanOrEqual(0)
    expect(result.reference[4800]).toBe(result.raw[4800 * 8 + 5])
    for (let ch = 1; ch < 8; ch++) {
      const differences = Float32Array.from({ length: 128 }, (_, i) => Math.abs(result.raw[(4800 + i) * 8 + ch]! - result.raw[(4800 + i) * 8]!))
      expect(Math.max(...differences)).toBeGreaterThan(0.001)
    }
    // Reconstruct the kernel from captured raw samples. After its startup window,
    // processed audio must match at the documented1024-frame delay compensation.
    const expected = new Float32Array(9216)
    new ArrayBeamformer(designWeights(), [0, 1, 2, 3, 4, 5, 6]).process(Array.from({ length: 8 }, (_, ch) => Float32Array.from({ length: expected.length }, (_, i) => result.raw[i * 8 + ch]!)), expected)
    const difference = result.processed.subarray(2048, 8192).map((value, i) => Math.abs(value - expected[1024 + 2048 + i]!))
    expect(Math.max(...difference)).toBeLessThan(1e-6)
    expect([...result.processed.subarray(4800)].every(Number.isFinite)).toBe(true)
  }
  finally { await context.close() }
}, 30000)
