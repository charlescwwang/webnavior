import type { VRMCore } from '@pixiv/three-vrm-core'

import { Object3D, Vector3 } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useIdleEyeSaccades } from './animation'

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
