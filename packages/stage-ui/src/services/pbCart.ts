import type { ProductSelection } from '@proj-airi/stage-shared/product-configuration'

import { errorMessageFrom } from '@moeru/std'
import { describePbMeal } from '@proj-airi/stage-shared/pb-menu-presentation'
import { array, looseObject, nullable, number, parse, string, unknown } from 'valibot'

import { cartConfiguration } from './pbProduct'

/** PB observations retain vendor line identity; subtotal excludes checkout-only charges. */
export interface CartLine {
  ref: string
  productRef: string
  name: string
  quantity: number
  unitPrice: number
  configuration: string
  /** Vendor-rendered option labels for the customer; identity remains configuration. */
  description?: string
  /** Structured observed option labels; omitted when a gateway cannot prove them. */
  options?: { name: string, quantity: number }[]
  /** Vendor-confirmed note; retained separately from the canonical configuration. */
  note?: string
}

export interface CartSnapshot {
  lines: CartLine[]
  subtotal: number
  /** Vendor order/pickup context and trusted manual-interaction generation. */
  context: { orderRef?: string, date: string, time: string, manualRevision: number, tableName?: string }
}

/** Parses PB's active order, including the explicit state before its first item. */
export function readCartPage(value: unknown, pickup: { date: string, time: string }, manualRevision: number): CartSnapshot {
  const page = parse(looseObject({ subtotal: number(), order: unknown() }), value)
  const tableContext = typeof page.diningTable === 'string' && page.diningTable.trim() ? { tableName: page.diningTable.trim() } : {}
  if (page.order === null) {
    // No order is different from an unreadable order. Contradictory totals/rows
    // must fail closed instead of permitting a new customer to adopt an old cart.
    if (page.subtotal !== 0 || (page.details !== undefined && page.details !== null && (!Array.isArray(page.details) || page.details.length)))
      throw new Error('PB 空訂單的明細與小計不一致。')
    return { lines: [], subtotal: 0, context: { ...pickup, manualRevision, ...tableContext } }
  }
  const cart = parse(looseObject({ subtotal: number(), order: looseObject({ hash: nullable(string()), pick_up_date: nullable(string()), pick_up_time: nullable(string()) }), details: array(looseObject({ id: number(), amount: number(), unit_price: number(), note: unknown(), item_type: string(), item: looseObject({ id: number(), name: string() }), product_prices: array(looseObject({ parent_id: unknown(), product_attrs: array(looseObject({ amount: number(), attr: looseObject({ name: string() }) })) })) })) }), value)
  // PB can create the empty draft before assigning its hash during the first
  // add. Returning explicit emptiness lets the existing readback poll wait for
  // the accepted add; a populated or nonzero anonymous cart is never trusted.
  if (cart.order.hash === null && (cart.details.length || cart.subtotal !== 0))
    throw new Error('PB 購物車已有內容但訂單編號尚未確認。')
  // PB Create-CjexdErb.js leaves draft pickup fields null until checkout.
  // Resolve only explicit nulls against a fresh menu context, as for the empty
  // cart; persisted strings remain authoritative and malformed fields reject.
  return { context: { ...(cart.order.hash === null ? {} : { orderRef: cart.order.hash }), date: cart.order.pick_up_date ?? pickup.date, time: cart.order.pick_up_time ?? pickup.time, manualRevision, ...tableContext }, subtotal: cart.subtotal, lines: cart.details.map(line => ({ ref: String(line.id), productRef: `${line.item_type === 'product' ? 'p' : 'pg'}-${line.item.id}`, name: line.item.name, options: line.product_prices.flatMap(price => price.product_attrs.map(choice => ({ name: choice.attr.name, quantity: choice.amount }))), description: line.product_prices.flatMap(price => price.product_attrs.map(choice => `${choice.attr.name} ×${choice.amount}`)).join('、'), quantity: line.amount, unitPrice: line.unit_price, note: typeof line.note === 'string' ? line.note : '', configuration: cartConfiguration(typeof line.note === 'string' ? line.note : '', line.product_prices) })) }
}

/** Formats vendor-confirmed rows for both read-back and write receipts without merging configurations. */
export function describeCartLines(lines: readonly Pick<CartLine, 'name' | 'quantity' | 'unitPrice' | 'description' | 'note' | 'options'>[]) {
  return lines.length
    ? lines.map(line => describePbMeal(line)).join('、')
    : '沒有餐點'
}

/** An add is prepared without writing; only commit may change the vendor cart. */
export interface PreparedItem extends Omit<CartLine, 'ref' | 'quantity'> {
  /** Rechecks vendor product/option facts after asynchronous UI preparation. */
  revalidate?: () => Promise<void>
  /** Returns the fresh cart observation that settled this one native click. */
  commit: (onDispatch: () => void) => Promise<CartSnapshot>
}

/** IO belongs to the PB browser adapter; reconciliation and retry policy live here. */
export interface CartGateway {
  read: () => Promise<CartSnapshot>
  /** Clear all unsubmitted rows through the native control, bound to this fresh snapshot. */
  clear: (before: CartSnapshot, onDispatch: () => void) => Promise<CartSnapshot | void>
  /** Proves that the native adapter can distinguish this observed row before merging an add. */
  canEdit: (cart: CartSnapshot, lineRef: string) => boolean
  prepare: (input: { productRef: string, quantity: number, note: string, selection: ProductSelection }) => Promise<PreparedItem>
  setQuantity: (ref: string, quantity: number, onDispatch: () => void, equivalentRefs?: readonly string[]) => Promise<CartSnapshot | void>
  remove: (ref: string, onDispatch: () => void, equivalentRefs?: readonly string[]) => Promise<CartSnapshot | void>
}

function fingerprint(cart: CartSnapshot) {
  return JSON.stringify({ context: [cart.context.orderRef, cart.context.date, cart.context.time, cart.context.manualRevision, cart.context.tableName], subtotal: cart.subtotal, lines: [...cart.lines].sort((a, b) => a.ref.localeCompare(b.ref)) })
}

/**
 * Verifies one native row edit. Indistinguishable rows may exchange identities
 * only inside the explicitly admitted group; every other field must stay exact.
 */
export function verifyCartRowEdit(before: CartSnapshot, after: CartSnapshot, ref: string, quantity: number, equivalentRefs: readonly string[] = []) {
  const target = before.lines.find(line => line.ref === ref)
  if (!target)
    return false
  return before.lines.some((candidate) => {
    if (candidate.ref !== ref && (!equivalentRefs.includes(candidate.ref) || !equivalentRefs.includes(ref)
      || JSON.stringify({ ...candidate, ref: '' }) !== JSON.stringify({ ...target, ref: '' }))) {
      return false
    }
    const lines = quantity ? before.lines.map(line => line.ref === candidate.ref ? { ...line, quantity } : line) : before.lines.filter(line => line.ref !== candidate.ref)
    const subtotal = (Math.round(before.subtotal * 100) + Math.round(candidate.unitPrice * 100) * (quantity - candidate.quantity)) / 100
    return fingerprint(after) === fingerprint({ context: before.context, lines, subtotal })
  })
}

/** Verifies the complete result of one add, including first-order creation and unrelated rows. */
function verifyAddition(before: CartSnapshot, after: CartSnapshot, selection: PreparedItem, quantity: number) {
  const expectedContext = !before.lines.length && !before.context.orderRef
    ? { ...before.context, orderRef: after.context.orderRef }
    : before.context
  if (after.context.orderRef !== expectedContext.orderRef || after.context.date !== expectedContext.date || after.context.time !== expectedContext.time || after.context.tableName !== expectedContext.tableName || after.context.manualRevision !== expectedContext.manualRevision)
    return false
  const matches = (line: CartLine) => line.productRef === selection.productRef && line.configuration === selection.configuration && line.unitPrice === selection.unitPrice
  const count = (cart: CartSnapshot) => cart.lines.filter(matches).reduce((sum, line) => sum + line.quantity, 0)
  const allowed = new Set(before.lines.map(line => line.ref))
  // Compare currency in hundredths so valid decimal prices do not fail on float drift.
  const expectedMinor = Math.round(before.subtotal * 100) + Math.round(selection.unitPrice * 100) * quantity
  return count(after) - count(before) === quantity
    && Math.round(after.subtotal * 100) === expectedMinor
    && before.lines.filter(line => !matches(line)).every(line => after.lines.some(current => JSON.stringify(current) === JSON.stringify(line)))
    && after.lines.every(line => allowed.has(line.ref) || matches(line))
    && before.lines.filter(matches).every(line => after.lines.some(current => current.ref === line.ref && matches(current) && current.quantity >= line.quantity))
}

/**
 * Admits one write against a fresh observed cart and verifies its entire effect.
 * Unknown effects revoke further writes. Operation IDs are deduplicated by the
 * owning document's Eventa journal; this module never retries a vendor write.
 */
export function createCartOperations(gateway: CartGateway) {
  let advertised: { key: string, version: string } | undefined
  let busy = false
  let uncertain = false
  // A lost readback retains only a verifier for a single admitted mutation.
  // Recovery can prove its exact effect from fresh data; it never dispatches.
  // Multi-step replacement/group edits and clears retain their existing barrier.
  let pendingVerification: ((cart: CartSnapshot) => boolean) | undefined

  function publish(cart: CartSnapshot) {
    const key = fingerprint(cart)
    if (advertised?.key !== key)
      advertised = { key, version: crypto.randomUUID() }
    return { ...cart, version: advertised.version }
  }

  return {
    publish,
    canRecover: () => !busy && !uncertain,
    /** Clears an unknown single-cart effect only against a fresh gateway observation. No writes are replayed. */
    verifyPending(cart: CartSnapshot) {
      if (busy || !uncertain || !pendingVerification?.(cart))
        return false
      uncertain = false
      pendingVerification = undefined
      publish(cart)
      return true
    },
    async observe() {
      return publish(await gateway.read())
    },
    /** Customer-session end policy: one native clear, then prove both rows and subtotal are empty. */
    async clear() {
      if (busy || uncertain)
        return { ok: false, status: uncertain ? 'unknown' : 'rejected', customerMessage: '先前操作尚未確認，尚不能清空購物車。' }
      busy = true
      let dispatched = false
      try {
        const before = await gateway.read()
        const after = before.lines.length
          ? await gateway.clear(before, () => { dispatched = true }) ?? await gateway.read()
          : before
        if (after.lines.length || after.subtotal !== 0)
          throw new Error('購物車明細或小計尚未清空。')
        return { ok: true, status: 'verified', cart: publish(after), customerMessage: '未結帳餐點已清空，可以開始新的點餐。' }
      }
      catch (error) {
        // An accepted clear can finish after a lost response. Keep the same
        // unknown-write barrier as ordinary cart edits; never replay it blindly.
        if (dispatched)
          uncertain = true
        return { ok: false, status: dispatched ? 'unknown' : 'rejected', error: errorMessageFrom(error), customerMessage: dispatched ? '清空結果尚未確認，已暫停開始下一位接待；請查看購物車。' : '購物車尚未清空，請確認畫面後再重新開始。' }
      }
      finally { busy = false }
    },
    async execute(input: { action: 'add' | 'quantity' | 'remove' | 'replace', version: string, productRef?: string, lineRef?: string, lineRefs?: string[], quantity: number, note: string, unitPrice?: number, selection?: ProductSelection, retainQuantity?: number }, observed?: CartSnapshot) {
      if (busy || uncertain)
        return { ok: false, status: uncertain ? 'unknown' : 'rejected', effect: uncertain ? 'unknown' : 'none', customerMessage: '先前操作尚未確認，請先確認購物車，暫停新的代操作。' }
      busy = true
      let dispatched = false
      let verifiedAddition: CartSnapshot | undefined
      try {
        if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 99)
          throw new Error('數量必須介於 1 到 99。')
        const before = observed ?? await gateway.read()
        if (!advertised || advertised.version !== input.version || advertised.key !== fingerprint(before)) {
          // A changed pickup/table/manual generation is stale admission, not
          // an unknown merchant effect. The Host must refresh and revalidate
          // the same request; this coordinator never retries it automatically.
          return { ok: false, status: 'rejected', effect: 'none', reason: 'stale-cart', customerMessage: '購物車資料已更新，這次尚未變更餐點。' }
        }
        const requestedLine = before.lines.find(line => line.ref === input.lineRef)
        let target = requestedLine
        // A partial replacement keeps this many servings in the original
        // configuration. It is validated before preparation or any dispatch.
        const retainQuantity = input.retainQuantity ?? 0
        let refs = input.lineRefs ?? (target ? [target.ref] : [])
        let group = before.lines.filter(line => refs.includes(line.ref))
        if (input.lineRefs && (!['quantity', 'remove', 'replace'].includes(input.action) || !refs.length || new Set(refs).size !== refs.length || group.length !== refs.length || !requestedLine || !refs.includes(requestedLine.ref) || group.some(line => line.productRef !== requestedLine.productRef || line.configuration !== requestedLine.configuration || line.unitPrice !== requestedLine.unitPrice)))
          throw new Error('合計調整只能包含已核對且商品、配置與單價相同的現有行。')
        const sourceQuantity = group.reduce((sum, line) => sum + line.quantity, 0)
        if (!Number.isInteger(retainQuantity) || retainQuantity < 0 || (input.action !== 'replace' && retainQuantity !== 0) || (input.action === 'replace' && target && retainQuantity >= sourceQuantity))
          throw new Error('保留份數必須少於原配置合計份數，且只用於替換餐點。')
        let operation = input.action
        let quantity = input.quantity
        let prepared: PreparedItem | undefined
        if (input.action === 'replace' && !target)
          throw new Error('指定要替換的購物車行已不存在。')
        if (input.action === 'add' || input.action === 'replace') {
          if (!input.productRef || !input.selection)
            throw new Error('請先選擇實際商品及當前規格。')
          prepared = await gateway.prepare({ productRef: input.productRef, quantity: input.quantity, note: input.note, selection: input.selection })
          if (prepared.unitPrice !== input.unitPrice) {
            // Preparation has not committed anything. Report the unit mismatch
            // separately so an adapter may request a bounded new proposal;
            // this never permits replay of a dispatched/uncertain operation.
            return { ok: false, status: 'rejected', effect: 'none', reason: 'unit-price-mismatch', expectedUnitPrice: prepared.unitPrice, error: '商品價格已變更，請重新確認售價。', customerMessage: '單份含加購售價與提案不符，尚未變更購物車。' }
          }
          if (input.action === 'add') {
            const matching = before.lines.filter(line => line.productRef === prepared!.productRef && line.configuration === prepared!.configuration && line.unitPrice === prepared!.unitPrice)
            // Repeated additions should not create indistinguishable rows that
            // cannot be edited later. Merge only one exact serving at the same
            // price, with native row-identity proof. Otherwise preserve ordinary
            // add behavior, including totals beyond one row's 99-serving cap.
            if (matching.length === 1 && matching[0].quantity + input.quantity <= 99 && gateway.canEdit(before, matching[0].ref)) {
              target = matching[0]
              refs = [target.ref]
              group = [target]
              quantity = target.quantity + input.quantity
              operation = 'quantity'
            }
          }
          if (input.action === 'replace' && prepared.productRef === target!.productRef && prepared.configuration === target!.configuration) {
            // Removing a portion and adding the same configuration is exactly
            // one count change. Never add then remove, which could duplicate
            // meals or leave a partial replacement on a lost response.
            //
            // This equivalence is only proven for a unique configuration row
            // at the same price. Another matching row may mean the customer is
            // asking for an aggregate total; that needs explicit group admission.
            if (before.lines.some(line => !refs.includes(line.ref) && line.productRef === target!.productRef && line.configuration === target!.configuration))
              throw new Error('同配置仍有其他分列，請使用明確的分組改量，不推測合計份數。')
            if (prepared.unitPrice !== target!.unitPrice)
              throw new Error('原餐與目前配置的單價不同，請先核對價格再改量。')
            quantity = retainQuantity + input.quantity
            if (quantity > 99)
              throw new Error('同配置合計超過單列可調整份數，請先確認分組方式。')
            operation = 'quantity'
          }
          // Preparation can take time while the customer or another executor
          // changes the cart. Revalidate immediately before the single commit.
          await prepared.revalidate?.()
          if (fingerprint(await gateway.read()) !== fingerprint(before))
            throw new Error('選餐期間購物車已變更，請重新確認。')
          if (operation === 'quantity')
            prepared = undefined
        }
        else if (!target) {
          throw new Error('指定購物車行已不存在，請重新讀取。')
        }
        pendingVerification = undefined
        if (prepared && operation === 'add') {
          const selection = prepared
          pendingVerification = cart => verifyAddition(before, cart, selection, quantity)
        }
        else if (!prepared && group.length === 1) {
          const ref = target!.ref
          pendingVerification = cart => verifyCartRowEdit(before, cart, ref, operation === 'quantity' ? quantity : 0)
        }
        const onDispatch = () => {
          dispatched = true
        }
        let committedCart: CartSnapshot | undefined
        if (prepared) {
          committedCart = await prepared.commit(onDispatch)
        }
        else if (group.length > 1) {
          // Equivalent rows are fungible only within this admitted group. Remove
          // redundant rows and keep the requested total on the surviving row.
          // Remove the redundant rows before setting the final count, so that
          // the new count cannot create an indistinguishable name/price/quantity
          // pair for a subsequent native deletion.
          //
          // Verify every intermediate full snapshot, so a touch/context change
          // stops the sequence rather than silently rebasing the remaining IO.
          let stage = before
          let rows = stage.lines.filter(line => refs.includes(line.ref))
          while (rows.length > (operation === 'quantity' ? 1 : 0)) {
            if (fingerprint(await gateway.read()) !== fingerprint(stage))
              throw new Error('合計調整期間購物車已變更。')
            const row = rows.at(-1)!
            const next = await gateway.remove(row.ref, onDispatch, refs) ?? await gateway.read()
            if (!verifyCartRowEdit(stage, next, row.ref, 0, refs))
              throw new Error('合計調整的中途結果尚未確認。')
            stage = next
            committedCart = next
            rows = stage.lines.filter(line => refs.includes(line.ref))
          }
          if (operation === 'quantity') {
            target = rows[0]
            if (fingerprint(await gateway.read()) !== fingerprint(stage))
              throw new Error('合計調整期間購物車已變更。')
            committedCart = await gateway.setQuantity(target.ref, quantity, onDispatch) ?? await gateway.read()
            if (!verifyCartRowEdit(stage, committedCart, target.ref, quantity))
              throw new Error('合計調整的最後份數尚未確認。')
          }
        }
        else if (operation === 'quantity') {
          committedCart = await gateway.setQuantity(target!.ref, quantity, onDispatch) ?? undefined
        }
        else {
          committedCart = await gateway.remove(target!.ref, onDispatch) ?? undefined
        }

        // Native controls return the full observation that verified their last click.
        let after = committedCart ?? await gateway.read()
        // The first add legitimately creates an order identity. This exception
        // applies only to an empty, identity-free cart; pickup/manual generation
        // and the entire requested effect are still verified below.
        const expectedContext = prepared && !before.lines.length && !before.context.orderRef
          ? { ...before.context, orderRef: after.context.orderRef }
          : before.context
        if (after.context.orderRef !== expectedContext.orderRef || after.context.date !== expectedContext.date || after.context.time !== expectedContext.time || after.context.tableName !== expectedContext.tableName || after.context.manualRevision !== expectedContext.manualRevision)
          throw new Error('購物車取餐情境或人工操作已變更。')
        if (prepared) {
          if (!verifyAddition(before, after, prepared, quantity))
            throw new Error('PB 加購後的內容與預期不一致。')
          if (operation === 'replace') {
            const added = after
            verifiedAddition = added
            // Source rows are equivalent only within this admitted group. Keep
            // earlier rows intact where possible, removing servings from the end;
            // this preserves per-serving extras/notes and avoids a >99 anchor.
            let remaining = sourceQuantity - retainQuantity
            let stage = added
            while (remaining) {
              const line = stage.lines.filter(line => refs.includes(line.ref)).at(-1)!
              if (fingerprint(await gateway.read()) !== fingerprint(stage))
                throw new Error('替換中途購物車已變更。')
              const removed = Math.min(remaining, line.quantity)
              const kept = line.quantity - removed
              const edited = kept
                ? await gateway.setQuantity(line.ref, kept, onDispatch, refs)
                : await gateway.remove(line.ref, onDispatch, refs)
              after = edited ?? await gateway.read()
              if (!verifyCartRowEdit(stage, after, line.ref, kept, refs))
                throw new Error('新餐已加入，但原餐調整結果尚未確認。')
              stage = after
              remaining -= removed
            }
          }
        }
        else {
          const expected = before.lines.flatMap(line => !refs.includes(line.ref)
            ? [line]
            : operation === 'quantity' && line.ref === target!.ref ? [{ ...line, quantity }] : [])
          const originalQuantity = group.reduce((sum, line) => sum + line.quantity, 0)
          const subtotal = (Math.round(before.subtotal * 100) + Math.round(target!.unitPrice * 100) * ((operation === 'remove' ? 0 : quantity) - originalQuantity)) / 100
          if (fingerprint(after) !== fingerprint({ context: before.context, lines: expected, subtotal }))
            throw new Error('PB 修改後的內容與預期不一致。')
        }
        pendingVerification = undefined
        const cart = publish(after)
        const summary = describeCartLines(cart.lines)
        const addedLine = prepared && after.lines.find(line => line.productRef === prepared.productRef && line.configuration === prepared.configuration && line.unitPrice === prepared.unitPrice)
        if (prepared && !addedLine)
          throw new Error('尚無法讀回新配置明細。')
        let addedDescription = addedLine ? describeCartLines([{ ...addedLine, quantity }]) : ''
        if (input.action === 'add' && operation === 'quantity')
          addedDescription = describeCartLines([{ ...target!, quantity: input.quantity }])
        const targetDescription = target ? describeCartLines([{ ...target, quantity: operation === 'quantity' ? quantity : group.reduce((sum, line) => sum + line.quantity, 0) }]) : ''
        let effectMessage: string
        if (operation === 'replace')
          effectMessage = `已將${describeCartLines([{ ...target!, quantity: sourceQuantity - retainQuantity }])}替換為${addedDescription}${retainQuantity ? `，原配置保留 ${retainQuantity} 份` : ''}。`
        else if (prepared || input.action === 'add')
          // A merged add still means only the incoming servings were added;
          // downstream completion accounting must not count the row's full total.
          effectMessage = `已加入${addedDescription}。`
        else if (operation === 'quantity')
          effectMessage = `已調整為${targetDescription}${group.length > 1 ? '（同配置分列合計）' : ''}。`
        else
          effectMessage = `已移除${targetDescription}。`
        const customerMessage = `${effectMessage}目前購物車：${summary}。小計 ${cart.subtotal} 元。`
        return { ok: true, status: 'verified', cart, customerMessage, effectMessage }
      }
      catch (error) {
        if (dispatched)
          uncertain = true
        // Before dispatch nothing was committed. After dispatch even a failed
        // follow-up read may conceal success; never authorize a blind replay.
        const customerMessage = verifiedAddition
          ? '新餐已確認加入，但原餐調整尚未完成查證；請確認購物車，系統已暫停新的代操作。'
          : dispatched
            ? '這次購物車操作的結果尚未確認，請查看購物車；系統已暫停新的代操作。'
            : `這次沒有變更購物車：${errorMessageFrom(error) ?? '請重新確認目前餐點與購物車。'}`
        return { ok: false, status: dispatched ? 'unknown' : 'rejected', effect: dispatched ? 'unknown' : 'none', error: errorMessageFrom(error) ?? 'PB operation failed.', ...(verifiedAddition ? { partial: true, verifiedAddition } : {}), customerMessage }
      }
      finally { busy = false }
    },
  }
}
