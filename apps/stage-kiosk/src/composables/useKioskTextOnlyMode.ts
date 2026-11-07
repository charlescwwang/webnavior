import type { MaybeRefOrGetter } from 'vue'

import { StorageSerializers, useLocalStorage } from '@vueuse/core'
import { computed, toValue } from 'vue'

/** Resolves Server-owned mode without restoring the removed browser override. */
export function useKioskTextOnlyMode(centralTextOnlyMode: MaybeRefOrGetter<boolean> = false) {
  // Retire only the old browser preference. Never copy it into device policy;
  // an old tab may still write the key, but it no longer controls this mode.
  const retiredOverride = useLocalStorage<boolean | null>('kiosk/conversation/text-only', null, { serializer: StorageSerializers.boolean })
  retiredOverride.value = null
  return computed(() => toValue(centralTextOnlyMode))
}
