import type { CatalogLabel } from '@proj-airi/stage-shared/ordering-sites'

import type { kioskInteractionEntries } from '../../../schemas/kiosk'
import type { BrowserPlan } from './contracts'

import { normalizeSlotNumbers } from '@proj-airi/stage-shared/ordering-slots'
import { nativeOrderingToolName } from '@proj-airi/stage-shared/ordering-tools'
import { parsePbDumplingServings, pbDumplingExtraCount, pbProductName } from '@proj-airi/stage-shared/pb-menu-presentation'

import { normalizeTranscript } from '../kiosk-interaction-decision/context'

/** Object key order is transport formatting; array order and all values remain significant. */
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(',')}}`
  return JSON.stringify(value)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Matches business arguments to Host-resolved labels, not opaque IDs or model-supplied prices. */
function publicPlanSlot(name: string, input: unknown, plan: BrowserPlan, args: Record<string, unknown>, labels: readonly CatalogLabel[]): string | undefined {
  if (!record(input) || nativeOrderingToolName(name) !== plan.toolName)
    return
  // Public calls may use an immutable merchant alias; the Host resolves it to
  // today's formal product. Never let a shared alias grant an arbitrary target.
  const matchesName = (requested: string, actual: string) => {
    if (pbProductName(requested) === pbProductName(actual))
      return true
    const names = new Set(labels.filter(label => pbProductName(label.name) === pbProductName(requested) || label.aliases.some(alias => pbProductName(alias) === pbProductName(requested))).map(label => pbProductName(label.name)))
    return names.size === 1 && names.has(pbProductName(actual))
  }
  const target = (value: unknown) => record(value) && plan.effect.cartTarget
    && typeof value.name === 'string' && matchesName(value.name, plan.effect.cartTarget.selected.name)
    && (value.note === undefined || value.note === (plan.effect.cartTarget.selected.note ?? ''))
    && (value.configuration === undefined || value.configuration === plan.effect.cartTarget.selected.configuration)
  const meal = (value: unknown, count: unknown) => {
    const serving = plan.effect.serving
    if (!record(value) || !serving || typeof value.name !== 'string' || !matchesName(value.name, serving.productName) || (value.variant ?? '') !== serving.variantName || count !== args.quantity)
      return false
    const source = value.copyFrom !== undefined
      ? plan.effect.copySource
      : plan.effect.action === 'replace' && serving.productName === plan.effect.cartTarget?.selected.name ? plan.effect.cartTarget.selected : undefined
    if (value.copyFrom !== undefined && (!record(value.copyFrom) || !source || typeof args.copySourceRef !== 'string'
      || typeof value.copyFrom.name !== 'string' || !matchesName(value.copyFrom.name, source.name) || !matchesName(value.name, source.name)
      || (value.copyFrom.configuration !== undefined && value.copyFrom.configuration !== source.configuration)
      || (value.copyFrom.note !== undefined && value.copyFrom.note !== source.note))) {
      return false
    }
    if ((source && source.options === undefined) || (value.note ?? source?.note ?? '') !== plan.effect.note)
      return false
    const options = value.options ?? []
    if (!Array.isArray(options) || options.some(option => !record(option) || typeof option.name !== 'string' || !Number.isInteger(option.quantity) || Number(option.quantity) < 0))
      return false
    const expected = new Map((source?.options ?? []).map(option => [option.name, option.quantity]))
    if (new Set(options.map(option => option.name)).size !== options.length)
      return false
    for (const option of options) {
      if (option.quantity)
        expected.set(option.name, option.quantity)
      else
        expected.delete(option.name)
    }
    if (value.piecesPerServing !== undefined) {
      if (typeof value.piecesPerServing !== 'number')
        return false
      const extra = pbDumplingExtraCount(serving.productName, value.piecesPerServing)
      if (options.some(option => option.name === '水餃' && option.quantity !== extra))
        return false
      if (extra)
        expected.set('水餃', extra)
      else
        expected.delete('水餃')
    }
    const expectedOptions = [...expected].map(([name, quantity]) => ({ name, quantity })).sort((a, b) => a.name.localeCompare(b.name))
    return canonical(expectedOptions) === canonical([...serving.options].sort((a, b) => a.name.localeCompare(b.name)))
      && plan.effect.deltas.some(delta => delta.kind === 'product' && delta.name === serving.productName && delta.quantity === count)
  }
  if (name === 'add_items_to_cart' && Array.isArray(input.items)) {
    const matches = input.items.flatMap((item, index) => record(item) && meal(item, item.quantity) ? [index] : [])
    return matches.length === 1 ? `item:${matches[0]}` : undefined
  }
  if (name === 'set_cart_item_quantity' && target(input.target) && input.quantity === args.quantity
    && plan.effect.deltas.length === 1 && plan.effect.deltas[0].mode === 'set' && plan.effect.deltas[0].quantity === input.quantity) {
    return 'quantity'
  }
  if (name === 'remove_items_from_cart' && Array.isArray(input.targets)) {
    const matches = input.targets.flatMap((item, index) => target(item) ? [index] : [])
    return matches.length === 1 ? `target:${matches[0]}` : undefined
  }
  if (name === 'replace_item_in_cart' && target(input.target) && meal(input.replacement, input.replaceQuantity)
    && plan.effect.cartTarget && typeof input.replaceQuantity === 'number'
    && args.retainQuantity === plan.effect.cartTarget.selected.quantity - input.replaceQuantity) {
    return 'replace'
  }
}

/** A finite operation is still compiled independently from the original whole utterance. */
function finitePlanSlot(actionId: unknown, plan: BrowserPlan, args: Record<string, unknown>, transcript: string, labels: readonly CatalogLabel[]): string | undefined {
  const products = plan.effect.deltas.filter(delta => delta.kind === 'product')
  if (actionId === 'intent:add-item' || actionId === 'intent:add-items') {
    if (plan.toolName !== 'browser_cart_add' || products.length !== 1 || plan.effect.note || args.note !== '')
      return
    const product = products[0]
    const clauses = actionId === 'intent:add-items' ? transcript.split(/[，,、和]|還要|以及|加上/).map(clause => clause.trim()).filter(Boolean) : [transcript]
    const aliases = labels.find(label => label.name === product.name)?.aliases.filter(alias => labels.filter(label => label.aliases.includes(alias)).length === 1) ?? []
    const label = [product.name, ...aliases].find(name => transcript.includes(name))
    if (!label || (actionId === 'intent:add-items' && (clauses.length < 2 || clauses.length > 3)) || transcript.split(label).length !== 2)
      return
    const clause = clauses.find(value => value.includes(label))
    const dumplings = actionId === 'intent:add-item' ? parsePbDumplingServings(transcript, product.name, label) : undefined
    if (dumplings) {
      const options = plan.effect.serving?.options
      const selection = args.selection
      if (args.quantity !== dumplings.quantity || product.quantity !== dumplings.quantity || !record(selection) || selection.variantRef !== '' || !Array.isArray(selection.choices)
        || !options || canonical(options) !== canonical(dumplings.extra ? [{ name: '水餃', quantity: dumplings.extra }] : [])
        || selection.choices.length !== (dumplings.extra ? 1 : 0) || selection.choices.some(choice => !record(choice) || choice.quantity !== dumplings.extra)
        || plan.effect.deltas.some(delta => delta.kind !== 'product' && (delta.kind !== 'option' || delta.name !== '水餃' || (delta.quantity !== 0 && delta.quantity !== dumplings.extra * dumplings.quantity)))) {
        return
      }
      return `${product.name}:${dumplings.quantity}:${dumplings.piecesPerServing}`
    }
    if (plan.effect.deltas.some(delta => delta.kind !== 'product' && (delta.kind !== 'option' || delta.quantity !== 0)))
      return
    const remainder = clause && normalizeSlotNumbers(clause.replace(label, '')).replaceAll(/[\s，。！!、]/g, '')
    const count = remainder?.match(/^(?:請幫我|請給我|幫我|給我|我要|我想要|再加|再來|[請要加來再多])?(?:要|加)?([1-9]\d?)份(?:謝謝)?$/)?.[1]
    if (!count || Number(count) !== args.quantity || product.quantity !== args.quantity)
      return
    const selection = args.selection
    if (!record(selection) || selection.variantRef !== '' || !Array.isArray(selection.choices) || selection.choices.length)
      return
    return `${product.name}:${count}`
  }
  const target = plan.effect.cartTarget?.selected
  if (!target || products.length || plan.effect.deltas.length !== 1 || transcript.split(target.name).length !== 2)
    return
  const remainder = normalizeSlotNumbers(transcript.replace(target.name, '')).replaceAll(/[\s，,。！!？?]/g, '')
  const delta = plan.effect.deltas[0]
  if (actionId === 'intent:set-quantity' && plan.toolName === 'browser_cart_quantity') {
    const match = remainder.match(/^(?:[請把將]|請幫我|幫我)?(改成|改為|只留|只要|總共|少|減少|減掉|減)([1-9]\d?)份$/)
    const count = match && (/少|減/.test(match[1]) ? target.quantity - Number(match[2]) : Number(match[2]))
    if (count && count > 0 && count === args.quantity && delta.mode === 'set' && delta.quantity === count)
      return `${target.name}:quantity`
  }
  if (actionId === 'intent:remove-item' && plan.toolName === 'browser_cart_remove'
    && /^(?:[請把將]|幫我)?(?:全部不要|刪掉|刪除|整項不要)了?$/.test(remainder) && delta.mode === 'remove' && delta.quantity === target.quantity) {
    return `${target.name}:remove`
  }
}

/**
 * Matches server-issued Main calls or a bounded Jev intent to the current demand.
 * Does not interpret language again. Fresh vendor identity/version/selection and
 * full-cart verification remain mandatory in the document executor.
 * The caller consumes the returned key atomically under the visitor row lock.
 */
export function resolvePlan(entries: (typeof kioskInteractionEntries.$inferSelect)[], plan: BrowserPlan, labels: readonly CatalogLabel[] = []) {
  const user = entries.findLast(entry => entry.kind === 'user_text')
  if (!user || user.content.trim() !== plan.effect.transcript.trim())
    return
  let args: Record<string, unknown>
  try {
    args = JSON.parse(plan.arguments)
  }
  catch { return }
  if (!args || Array.isArray(args) || typeof args !== 'object')
    return
  const expectedAction = { browser_cart_add: 'add', browser_cart_quantity: 'quantity', browser_cart_remove: 'remove', browser_cart_replace: 'replace' }[plan.toolName]
  if (plan.effect.action !== expectedAction)
    return
  for (const entry of [...entries].reverse()) {
    const authority = entry.metadata.browserAuthority
    if (!authority || typeof authority !== 'object' || !('source' in authority) || authority.source !== plan.source)
      continue
    if (plan.source === 'main') {
      if (!('userEntryId' in authority) || authority.userEntryId !== user.id || !('readOnly' in authority) || authority.readOnly !== false || !Array.isArray(entry.metadata.toolCalls))
        continue
      for (const call of entry.metadata.toolCalls) {
        if (!call || typeof call !== 'object' || typeof call.id !== 'string' || !call.function || typeof call.function.arguments !== 'string')
          continue
        try {
          const issued = JSON.parse(call.function.arguments)
          const slot = publicPlanSlot(call.function.name, issued, plan, args, labels)
          if (slot || (call.function.name === plan.toolName && canonical(issued) === canonical(args)))
            return { key: `main:${entry.id}:${call.id}${slot ? `:${slot}` : ''}`, provider: 'main' as const, userEntryId: user.id }
        }
        catch { /* A malformed issued call cannot authorize an executable plan. */ }
      }
    }
    else {
      if (!('transcript' in authority) || authority.transcript !== normalizeTranscript(user.content).normalized || !('utteranceId' in authority) || authority.utteranceId !== user.metadata.utteranceId || authority.utteranceId === undefined || !('actionId' in authority) || Date.now() - entry.createdAt.getTime() > 120_000)
        continue
      const slot = finitePlanSlot(authority.actionId, plan, args, user.content, labels)
      if (slot)
        return { key: `system-one:${entry.id}:${slot}`, provider: 'system-one' as const, userEntryId: user.id }
    }
  }
}
