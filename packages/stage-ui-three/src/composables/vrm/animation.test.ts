import type { VRMCore } from '@pixiv/three-vrm-core'

import { AnimationClip, AnimationMixer, Object3D, Vector3 } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, shallowRef } from 'vue'

import { useIdleEyeSaccades, useMotionPlayback } from './animation'

describe('useIdleEyeSaccades', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('scales the gaze offset to the focus distance', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1)

    const head = new Object3D()
    const lookAt = {
      target: undefined as Object3D | undefined,
      update: vi.fn(),
    }

    // NOTICE:
    // The saccade policy only consumes the humanoid head, expression manager,
    // and look-at controller; loading a complete VRM asset would obscure this
    // behavior behind the GLTF loader.
    // This fixture mirrors that narrow runtime contract.
    // Replace it when three-vrm offers a lightweight VRMCore fixture.
    const vrm = {
      expressionManager: {},
      humanoid: { getNormalizedBoneNode: () => head },
      lookAt,
    } as unknown as VRMCore

    useIdleEyeSaccades().update(vrm, ref(new Vector3(0, 0, -100)), 0.016)

    const expectedOffset = Math.tan(Math.PI / 120) * 100
    expect(lookAt.target?.position.x).toBeCloseTo(expectedOffset)
    expect(lookAt.target?.position.y).toBeCloseTo(expectedOffset)
    expect(lookAt.target?.position.z).toBe(-100)
    expect(lookAt.update).toHaveBeenCalledWith(0.016)
  })
})

describe('motion playback ownership', () => {
  it('keeps idle active when an older thinking asset finishes loading later', async () => {
    const scope = effectScope()
    const source = ref('idle')
    const mixer = shallowRef(new AnimationMixer(new Object3D()))
    const action = shallowRef(mixer.value.clipAction(new AnimationClip('initial', 1, [])))
    const pending = new Map<string, (clip: AnimationClip) => void>()
    const onError = vi.fn()
    scope.run(() => useMotionPlayback({
      source,
      loop: ref(true),
      mixer,
      action,
      onError,
      loadClip: url => new Promise(resolve => pending.set(url, resolve)),
    }))
    try {
      source.value = 'thinking'
      await nextTick()
      source.value = 'idle'
      await nextTick()
      pending.get('idle')!(new AnimationClip('idle', 1, []))
      await nextTick()
      expect(action.value.getClip().name).toBe('idle')
      pending.get('thinking')!(new AnimationClip('thinking', 1, []))
      await nextTick()
      expect(action.value.getClip().name).toBe('idle')
      expect(onError).not.toHaveBeenCalled()
    }
    finally {
      scope.stop()
    }
  })

  it('discards pending motion after the model mixer is replaced or scope is disposed', async () => {
    const scope = effectScope()
    const source = ref('idle')
    const mixer = shallowRef(new AnimationMixer(new Object3D()))
    const initialAction = mixer.value.clipAction(new AnimationClip('initial', 1, []))
    const action = shallowRef(initialAction)
    const pending = new Map<string, (clip: AnimationClip) => void>()
    scope.run(() => useMotionPlayback({
      source,
      loop: ref(true),
      mixer,
      action,
      onError: vi.fn(),
      loadClip: url => new Promise(resolve => pending.set(url, resolve)),
    }))
    source.value = 'thinking'
    await nextTick()
    mixer.value = new AnimationMixer(new Object3D())
    pending.get('thinking')!(new AnimationClip('old-model', 1, []))
    await nextTick()
    expect(action.value).toBe(initialAction)
    source.value = 'idle'
    await nextTick()
    scope.stop()
    pending.get('idle')!(new AnimationClip('disposed', 1, []))
    await nextTick()
    expect(action.value).toBe(initialAction)
  })

  it('clears the old pose when the selected asset fails and ignores a stale failure', async () => {
    const scope = effectScope()
    const source = ref('initial')
    const mixer = shallowRef(new AnimationMixer(new Object3D()))
    const initialAction = mixer.value.clipAction(new AnimationClip('thinking', 1, [])).play()
    const action = shallowRef<typeof initialAction | undefined>(initialAction)
    const pending = new Map<string, (error: Error) => void>()
    const onError = vi.fn()
    scope.run(() => useMotionPlayback({
      source,
      loop: ref(true),
      mixer,
      action,
      onError,
      loadClip: url => new Promise((_resolve, reject) => pending.set(url, reject)),
    }))
    try {
      source.value = 'thinking'
      await nextTick()
      source.value = 'idle'
      await nextTick()
      pending.get('thinking')!(new Error('old request failed'))
      await nextTick()
      expect(action.value).toBe(initialAction)
      expect(onError).not.toHaveBeenCalled()
      const failure = new Error('idle asset unavailable')
      pending.get('idle')!(failure)
      await nextTick()
      expect(action.value).toBeUndefined()
      expect(initialAction.isRunning()).toBe(false)
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure)
    }
    finally {
      scope.stop()
    }
  })
})
