import type { ConversationContext } from '@proj-airi/stage-shared/kiosk-conversation'

import type { MenuItem } from '../domain/order-machine'
import type { MatrixStep } from './conversationMatrix'

/** Assesses frozen turn gold against authoritative Menu snapshots; no model judges gold. */
export function assessScriptTurn(step: MatrixStep, observed: { before: ConversationContext, after: ConversationContext, menu: MenuItem[], answer: string, shownHistory: Set<string>, checkoutStarts: number }) {
  const { before, after, menu, answer, shownHistory, checkoutStarts } = observed
  const errors: string[] = []
  // Snapshots expose options as IDs, independent from private cart-line IDs.
  const rows = (context: ConversationContext) => context.cart.lines.map(line => ({ itemId: line.itemId, quantity: line.quantity, options: Object.fromEntries(line.options.map(option => [option.groupId, option.valueId])) })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const actual = rows(after)
  const expected = step.cart?.map(line => ({ ...line, options: line.options ?? {} })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  if (expected && JSON.stringify(actual) !== JSON.stringify(expected))
    errors.push(`Cart mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  if (step.sameCart && JSON.stringify(rows(before)) !== JSON.stringify(actual))
    errors.push('Read-only turn changed cart lines')
  if (step.sameCart && !step.fulfillment && before.cart.fulfillmentMode !== after.cart.fulfillmentMode)
    errors.push('Read-only turn changed fulfillment')
  if (step.fulfillment && after.cart.fulfillmentMode !== step.fulfillment)
    errors.push(`Expected fulfillment ${step.fulfillment}`)
  if (step.ready !== undefined && after.entryComplete !== step.ready)
    errors.push(`Expected entryComplete ${step.ready}`)
  if (step.screen && after.screen !== step.screen)
    errors.push(`Expected screen ${step.screen}, received ${after.screen}`)
  if (step.phase && after.phase !== step.phase)
    errors.push(`Expected phase ${step.phase}, received ${after.phase}`)
  if (step.purpose && after.waitingFor?.purpose !== step.purpose)
    errors.push(`Expected question purpose ${step.purpose}, received ${after.waitingFor?.purpose}`)
  if (step.checkoutStarts !== undefined && checkoutStarts !== step.checkoutStarts)
    errors.push(`Expected checkout starts ${step.checkoutStarts}, received ${checkoutStarts}`)
  if (step.silentOnly && answer.trim())
    errors.push('Background/idle turn produced a customer reply')
  if (!step.silentOnly && !step.silentAllowed && !step.allowFailure && !step.fault && !answer.trim())
    errors.push('Missing customer reply')
  if (step.reply && !new RegExp(step.reply, 'u').test(answer))
    errors.push(`Reply does not satisfy ${step.reply}`)
  if (step.forbidden && new RegExp(step.forbidden, 'u').test(answer))
    errors.push(`Reply contains forbidden claim ${step.forbidden}`)
  if (!step.allowFailure && !step.fault && /需求尚未完成|系統未接受這次操作|請確認畫面後再繼續|連線失敗/u.test(answer))
    errors.push('Technical failure shown during semantic acceptance')
  const shown = after.presentation?.itemIds ?? []
  const sameIds = (left: string[], right: string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
  if (step.shown === 'all' && !sameIds(shown, menu.map(item => item.id)))
    errors.push('Full catalog was not presented')
  if (step.shown === 'empty' && shown.length)
    errors.push('Absent query presented unrelated items')
  if (step.shownIds && !sameIds(shown, step.shownIds))
    errors.push(`Expected shown IDs ${step.shownIds.join(',')}, received ${shown.join(',')}`)
  if (step.nonempty && !shown.length)
    errors.push('Expected nonempty presentation')
  for (const id of shown) {
    const item = menu.find(item => item.id === id)
    if (!item) {
      errors.push(`Unknown shown ID ${id}`)
      continue
    }
    if (step.maxPrice !== undefined && item.price > step.maxPrice)
      errors.push(`Over budget ${id}: ${item.price} > ${step.maxPrice}`)
    if (step.minPrice !== undefined && item.price < step.minPrice)
      errors.push(`Below price interval ${id}`)
    if (step.category && item.category !== step.category)
      errors.push(`Wrong category ${id}`)
    if (step.excludedIngredients?.some(ingredient => item.composition?.ingredients.includes(ingredient)))
      errors.push(`Forbidden ingredient in ${id}`)
    if (step.notSpicy && /辣/u.test(item.name))
      errors.push(`Spicy item shown ${id}`)
    // An unchanged previous view with an explicit exhaustion reply is not a new
    // recommendation. A changed presentation must never recycle an earlier ID.
    const unchanged = after.revisions.recommendation === before.revisions.recommendation
    const exhausted = unchanged && sameIds(shown, before.presentation?.itemIds ?? [])
    if (step.novel && shownHistory.has(id) && !exhausted)
      errors.push(`Repeated alternative ${id}`)
  }
  return errors
}
