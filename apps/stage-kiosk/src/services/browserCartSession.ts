import { readPbJourney } from '@proj-airi/stage-shared/pb-journey'
import { array, literal, looseObject, minLength, object, optional, parse, pipe, safeParse, string, unknown } from 'valibot'
import { readonly, shallowRef } from 'vue'

const ownerSchema = object({ owner: pipe(string(), minLength(1)) })
const snapshotSchema = looseObject({ cart: looseObject({ version: pipe(string(), minLength(1)), lines: array(unknown()) }) })

/** Owns local cart admission across visitor sessions; it never changes a vendor cart or login. */
export function createBrowserCartSession(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const blocked = shallowRef(false)
  // Persistence restores admission after reload; the admitted in-memory owner
  // remains authoritative during this reception even if storage is evicted.
  // A different visitor still needs an empty or explicitly reviewed cart.
  const admittedOwners = new Map<string, string>()

  function key(serviceUrl: string) {
    const url = new URL(serviceUrl)
    // PB's table/menu/cart pages share one vendor journey. Other services keep
    // their configured path boundary; query changes never transfer ownership.
    const journey = readPbJourney(serviceUrl)
    return `webnavior:browser-cart-owner:${url.origin}${journey?.menuPath ?? url.pathname}`
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
    admittedOwners.set(key(serviceUrl), owner)
    blocked.value = false
  }

  function check(owner: string, serviceUrl: string, raw: unknown) {
    parse(ownerSchema, { owner })
    const snapshot = parse(snapshotSchema, raw)
    if (admittedOwners.get(key(serviceUrl)) === owner || savedOwner(serviceUrl) === owner) {
      admittedOwners.set(key(serviceUrl), owner)
      blocked.value = false
      return true
    }
    if (!snapshot.cart.lines.length) {
      claim(owner, serviceUrl)
      return true
    }
    blocked.value = true
    return false
  }

  return {
    blocked: readonly(blocked),
    /** A fresh empty cart can transfer automatically; a nonempty unowned cart requires review. */
    check,
    /** Reads the covered document before exposing controls; only the table page needs private cart access. */
    async prepare(owner: string, serviceUrl: string, read: (input: { includeCatalog: false, forAdmission?: true }) => Promise<unknown>, isCurrent: () => boolean): Promise<'ready' | 'blocked' | 'stale' | 'table-only'> {
      // Menu forAdmission also dismisses PB's announcement through a visible
      // control. Admission owns the native cover, so that action would reject
      // its own hidden document forever. Read facts first, without UI actions.
      let raw = await read({ includeCatalog: false })
      if (!isCurrent())
        return 'stale'
      const journey = readPbJourney(serviceUrl)
      const table = safeParse(looseObject({ ok: literal(true), page: literal('table'), code: literal('table-selection-required') }), raw)
      if (journey?.tablePath === new URL(serviceUrl).pathname && table.success) {
        // Ordinary table context intentionally withholds the previous cart.
        // Only this observed table document gets the Host-only read; unlike
        // the menu path, it performs no announcement/control dispatch.
        raw = await read({ includeCatalog: false, forAdmission: true })
        if (!isCurrent())
          return 'stale'
      }
      const rejected = safeParse(looseObject({ ok: literal(false), error: optional(string()) }), raw)
      if (rejected.success)
        throw new Error(rejected.output.error ?? 'PB 購物車資料讀取未完成。')
      parse(looseObject({ ok: literal(true) }), raw)
      const deferred = safeParse(looseObject({ ok: literal(true), page: literal('table'), cartAdmission: literal('after-table-entry') }), raw)
      if (deferred.success && !('cart' in deferred.output)) {
        // PB cannot inspect a first-time guest's cart before Start. Table tools
        // remain available, but ownership is not granted; menu admission retries.
        if (journey?.tablePath === new URL(serviceUrl).pathname)
          return blocked.value ? 'blocked' : 'table-only'
      }
      return check(owner, serviceUrl, raw) ? 'ready' : 'blocked'
    },

    /** Rechecks the exact staff-reviewed snapshot before resuming the same in-progress cart. */
    resume(owner: string, serviceUrl: string, reviewedVersion: string, fresh: unknown) {
      const snapshot = parse(snapshotSchema, fresh)
      if (snapshot.cart.version !== reviewedVersion)
        throw new Error('CART_REVIEW_CHANGED')
      claim(owner, serviceUrl)
    },
    owns: (owner: string, serviceUrl: string) => admittedOwners.get(key(serviceUrl)) === owner || savedOwner(serviceUrl) === owner,
    // Clearing the screen must not erase persisted ownership of an unfinished cart.
    resetView: () => { blocked.value = false },
  }
}
