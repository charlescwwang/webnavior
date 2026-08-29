import type { Ref } from 'vue'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

let persistedValue: Ref<string>

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()

  return {
    ...actual,
    useLocalStorage: () => persistedValue,
  }
})

describe('useLocalStorageManualReset', () => {
  beforeEach(() => {
    persistedValue = ref('previous-user-setting')
  })

  // ROOT CAUSE:
  //
  // The helper used the persisted ref as refManualReset's initial value.
  // Calling reset therefore restored the prior user setting instead of the
  // default supplied by the owning settings store.
  //
  // We preserve the persisted value as the active value, while registering
  // the supplied default as the reset baseline.
  it('restores the declared default after loading a persisted value', async () => {
    const state = useLocalStorageManualReset('settings/example', 'default-setting')

    expect(state.value).toBe('previous-user-setting')

    state.reset()
    await nextTick()

    expect(state.value).toBe('default-setting')
    expect(persistedValue.value).toBe('default-setting')
  })
})
