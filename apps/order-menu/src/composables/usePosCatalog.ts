import type { PosCatalog } from '../pos-catalog'

import { errorMessageFrom } from '@moeru/std'
import { shallowRef } from 'vue'

import { fetchPosCatalog } from '../pos-catalog'

export type CatalogLoadState = 'error' | 'idle' | 'loading' | 'ready'

/** Owns the browser's POS-catalog loading state without providing a local fallback. */
export function usePosCatalog(serverUrl: string | undefined) {
  const catalog = shallowRef<PosCatalog>()
  const error = shallowRef<string>()
  const state = shallowRef<CatalogLoadState>('idle')

  async function load() {
    state.value = 'loading'
    error.value = undefined
    try {
      const nextCatalog = await fetchPosCatalog(serverUrl)
      catalog.value = nextCatalog
      state.value = 'ready'
      return nextCatalog
    }
    catch (loadError) {
      state.value = 'error'
      error.value = errorMessageFrom(loadError) ?? '無法載入 POS 菜單。'
      return undefined
    }
  }

  return { catalog, error, load, state }
}
