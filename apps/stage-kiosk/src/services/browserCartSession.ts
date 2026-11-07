import { array, looseObject, minLength, object, parse, pipe, safeParse, string, unknown } from 'valibot'
import { readonly, shallowRef } from 'vue'

const ownerSchema = object({ owner: pipe(string(), minLength(1)) })
const snapshotSchema = looseObject({ cart: looseObject({ version: pipe(string(), minLength(1)), lines: array(unknown()) }) })

/** Owns local cart admission across visitor sessions; it never changes a vendor cart or login. */
export function createBrowserCartSession(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const blocked = shallowRef(false)

  function key(serviceUrl: string) {
    const url = new URL(serviceUrl)
    // Pickup queries can change while the remote cart is still the same cart.
    // Scope ownership to the approved service origin/path, never to the query.
    return `webnavior:browser-cart-owner:${url.origin}${url.pathname}`
  }

  function savedOwner(serviceUrl: string) {
    try {
      const value = storage.getItem(key(serviceUrl))
      if (!value)
        return
      const parsed = safeParse(ownerSchema, JSON.parse(value))
      return parsed.success ? parsed.output.owner : undefined
    }
    catch { return undefined /* Corrupt/unavailable storage cannot establish ownership. */ }
  }

  function claim(owner: string, serviceUrl: string) {
    const value = parse(ownerSchema, { owner })
    storage.setItem(key(serviceUrl), JSON.stringify(value))
    blocked.value = false
  }

  return {
    blocked: readonly(blocked),
    /** A fresh empty cart can transfer automatically; a nonempty unowned cart requires review. */
    check(owner: string, serviceUrl: string, raw: unknown) {
      parse(ownerSchema, { owner })
      const snapshot = parse(snapshotSchema, raw)
      if (savedOwner(serviceUrl) === owner) {
        blocked.value = false
        return true
      }
      if (!snapshot.cart.lines.length) {
        claim(owner, serviceUrl)
        return true
      }
      blocked.value = true
      return false
    },
    /** Rechecks the exact staff-reviewed snapshot before resuming the same in-progress cart. */
    resume(owner: string, serviceUrl: string, reviewedVersion: string, fresh: unknown) {
      const snapshot = parse(snapshotSchema, fresh)
      if (snapshot.cart.version !== reviewedVersion)
        throw new Error('CART_REVIEW_CHANGED')
      claim(owner, serviceUrl)
    },
    owns: (owner: string, serviceUrl: string) => savedOwner(serviceUrl) === owner,
    // Clearing the screen must not erase persisted ownership of an unfinished cart.
    resetView: () => { blocked.value = false },
  }
}
