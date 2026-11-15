import { useExternalSpeechSource } from '@proj-airi/stage-ui/composables/audio/useExternalSpeechSource'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, effectScope, h, shallowRef } from 'vue'

// Real Web Audio nodes verify that visual cleanup cannot disconnect playback.
it('attaches and removes a lip-sync branch while preserving the speaker branch', async () => {
  const context = new AudioContext()
  const screen = render(defineComponent({ setup: () => () => h('button', { onClick: () => context.resume() }, 'Start synthetic audio') }))
  const scope = effectScope()
  const node = context.createConstantSource()
  const playback = context.createAnalyser()
  const mouth = context.createAnalyser()
  const silence = context.createGain()
  silence.gain.value = 0
  playback.connect(silence)
  mouth.connect(silence)
  silence.connect(context.destination)
  node.offset.value = 0.25
  node.connect(playback)
  node.start()
  const source = shallowRef<AudioNode | undefined>(node)
  const enabled = shallowRef(true)
  const active = scope.run(() => useExternalSpeechSource(source, enabled, async () => mouth))!
  const peak = (analyser: AnalyserNode) => {
    const samples = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(samples)
    return Math.max(...samples.map(Math.abs))
  }
  try {
    await screen.getByRole('button', { name: 'Start synthetic audio' }).click()
    await expect.poll(() => active.value).toBe(true)
    await expect.poll(() => peak(mouth)).toBeGreaterThan(0.2)
    enabled.value = false
    await expect.poll(() => active.value).toBe(false)
    await expect.poll(() => peak(mouth)).toBeLessThan(0.01)
    expect(peak(playback)).toBeGreaterThan(0.2)
    enabled.value = true
    await expect.poll(() => active.value).toBe(true)
    source.value = undefined
    await expect.poll(() => active.value).toBe(false)
    expect(peak(playback)).toBeGreaterThan(0.2)
  }
  finally {
    scope.stop()
    node.stop()
    screen.unmount()
    await context.close()
  }
})

it('does not connect a retired speech node after asynchronous lip-sync setup finishes', async () => {
  const context = new AudioContext()
  const scope = effectScope()
  const old = context.createGain()
  const current = context.createGain()
  const target = context.createAnalyser()
  const gate = Promise.withResolvers<AudioNode | undefined>()
  const source = shallowRef<AudioNode | undefined>(old)
  const active = scope.run(() => useExternalSpeechSource(source, true, () => gate.promise))!
  try {
    source.value = current
    await Promise.resolve()
    scope.stop()
    gate.resolve(target)
    await Promise.resolve()
    expect(active.value).toBe(false)
    // Neither stale setup continuation may claim the stopped component's graph.
    expect(() => old.disconnect(target)).toThrow()
    expect(() => current.disconnect(target)).toThrow()
  }
  finally {
    scope.stop()
    gate.resolve(target)
    await context.close()
  }
})
