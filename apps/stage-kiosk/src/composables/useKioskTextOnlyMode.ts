import type { MaybeRefOrGetter } from 'vue'

import { computed, toValue } from 'vue'

/** Reads Server-owned mode without changing browser preferences from other releases. */
export function useKioskTextOnlyMode(centralTextOnlyMode: MaybeRefOrGetter<boolean> = false) {
  // Old browser preferences do not grant policy authority. Leave them intact
  // so opening this version does not erase another release's local settings.
  return computed(() => toValue(centralTextOnlyMode))
}
