import type { FalconSettingsInput, FalconSettingsSnapshot } from '@proj-airi/stage-shared/falcon-settings'

import { errorMessageFrom } from '@moeru/std'
import { falconSettingsSnapshotSchema } from '@proj-airi/stage-shared/falcon-settings'
import { authedFetch } from '@proj-airi/stage-ui/libs/auth-fetch'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { parse } from 'valibot'
import { readonly, shallowRef } from 'vue'

/** Owns connection drafts only, never active ASR bindings or Kiosk capture. */
export function useFalconSettings() {
  const snapshot = shallowRef<FalconSettingsSnapshot>()
  const busy = shallowRef(false)
  const error = shallowRef<string>()
  const endpoint = new URL('/api/admin/falcon', SERVER_URL).toString()
  async function request(input?: FalconSettingsInput) {
    if (busy.value)
      return false
    busy.value = true
    error.value = undefined
    try {
      const response = await authedFetch(endpoint, input ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : undefined)
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.message ?? `Falcon settings request failed (${response.status}).`)
      }
      snapshot.value = parse(falconSettingsSnapshotSchema, await response.json())
      return true
    }
    catch (cause) {
      error.value = errorMessageFrom(cause) ?? 'Falcon settings request failed.'
      return false
    }
    finally {
      busy.value = false
    }
  }
  return { snapshot: readonly(snapshot), busy: readonly(busy), error: readonly(error), load: () => request(), save: (input: FalconSettingsInput) => request(input) }
}
