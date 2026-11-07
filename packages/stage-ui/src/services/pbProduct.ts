import { array, boolean, integer, looseObject, maxLength, maxValue, minValue, nullable, number, optional, parse, pipe, record, string } from 'valibot'

/** Explicit customer choices bound to one observed product configuration. */
export interface ProductSelection {
  version: string
  variantRef: string
  /** Quantities apply to one serving; the cart operation owns the number of meals. */
  choices: { ref: string, quantity: number }[]
}

/** Vendor option limits are per serving, not multiplied by the cart quantity. */
export interface ProductConfiguration {
  version: string
  variantRef: string
  name: string
  unitPrice: number
  groups: {
    ref: string
    name: string
    required: boolean
    maximum: number
    choices: { ref: string, name: string, unitPrice: number, maximum: number }[]
  }[]
}

/** Validates a configuration read across the browser/Host boundary. */
export const productConfigurationSchema = looseObject({
  version: string(),
  variantRef: string(),
  name: string(),
  unitPrice: pipe(number(), minValue(0)),
  groups: array(looseObject({ ref: string(), name: string(), required: boolean(), maximum: pipe(number(), integer(), minValue(1)), choices: array(looseObject({ ref: string(), name: string(), unitPrice: pipe(number(), minValue(0)), maximum: pipe(number(), integer(), minValue(1)) })) })),
})

const positiveId = pipe(number(), integer(), minValue(1))
const money = pipe(number(), minValue(0))
const attribute = looseObject({ id: positiveId, name: string(), attr_group: looseObject({ id: positiveId, required: boolean(), amount: positiveId }), attr_item: nullable(looseObject({ price: money })), pivot: looseObject({ amount: optional(nullable(positiveId)) }) })

/**
 * Discards administrative fields and binds the complete selectable schema to
 * the product/pickup scope. This is a local observation digest, not a PB revision.
 */
export async function describeConfiguration(input: { productRef: string, variantRef: string, name: string, unitPrice: number, scope: string }, attributes: unknown): Promise<ProductConfiguration> {
  const raw = parse(record(string(), array(attribute)), attributes)
  const groups = Object.entries(raw).map(([name, choices]) => {
    if (!choices.length)
      throw new Error('PB 選項群組沒有可驗證的選項。')
    const group = choices[0].attr_group
    if (choices.some(choice => JSON.stringify(choice.attr_group) !== JSON.stringify(group)))
      throw new Error('PB 規格群組資料不一致。')
    return { ref: `g-${group.id}`, name, required: group.required, maximum: group.amount, choices: choices.map(choice => ({ ref: `a-${choice.id}`, name: choice.name, unitPrice: choice.attr_item?.price ?? 0, maximum: Math.min(choice.pivot.amount ?? group.amount, group.amount) })).sort((a, b) => a.ref.localeCompare(b.ref)) }
  }).sort((a, b) => a.ref.localeCompare(b.ref))
  const refs = groups.flatMap(group => group.choices.map(choice => choice.ref))
  if (new Set(groups.map(group => group.ref)).size !== groups.length || new Set(refs).size !== refs.length)
    throw new Error('PB 規格識別重複，無法安全選餐。')
  const data = { ...input, groups }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)))
  const version = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return { version, variantRef: input.variantRef, name: input.name, unitPrice: parse(money, input.unitPrice), groups }
}

/** Validates all mandatory groups, option identity, limits and the observed price. */
export function resolveSelection(configuration: ProductConfiguration, selection: ProductSelection, note: string) {
  if (selection.version !== configuration.version || selection.variantRef !== configuration.variantRef)
    throw new Error('餐點規格、價格或取餐時段已變更，請重新選擇。')
  if (new Set(selection.choices.map(choice => choice.ref)).size !== selection.choices.length)
    throw new Error('同一規格不能重複傳入。')
  const choices = selection.choices.map((selection) => {
    const choice = configuration.groups.flatMap(group => group.choices).find(choice => choice.ref === selection.ref)
    if (!choice || !Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > choice.maximum)
      throw new Error('所選規格不存在或數量超過限制。')
    return { ref: choice.ref, quantity: selection.quantity, unitPrice: choice.unitPrice }
  }).sort((a, b) => a.ref.localeCompare(b.ref))
  for (const group of configuration.groups) {
    const amount = choices.filter(choice => group.choices.some(option => option.ref === choice.ref)).reduce((sum, choice) => sum + choice.quantity, 0)
    if (amount > group.maximum || (group.required && amount !== group.maximum))
      throw new Error(`請確認「${group.name}」：${group.required ? '必選' : '最多'} ${group.maximum} 個。`)
  }
  const minor = Math.round(configuration.unitPrice * 100) + choices.reduce((sum, choice) => sum + Math.round(choice.unitPrice * 100) * choice.quantity, 0)
  return { unitPrice: minor / 100, configuration: JSON.stringify({ note, variantRef: selection.variantRef, choices }), choices }
}

/**
 * Builds PB's observed native fixed-product form from a fresh validated schema.
 * Base price and per-serving attributes stay separate, as in ProductDialog;
 * the configured price returned here is only for cart-effect verification.
 */
export function prepareAddition(configuration: ProductConfiguration, selection: ProductSelection, input: { productId: number, quantity: number, note: string }) {
  parse(looseObject({ productId: positiveId, quantity: pipe(number(), integer(), minValue(1), maxValue(99)), note: pipe(string(), maxLength(200)) }), input)
  if (configuration.variantRef)
    throw new Error('價格規格商品需要獨立驗證的表單，尚未開放此寫入。')
  const selected = resolveSelection(configuration, selection, input.note)
  const attrs: Record<string, number | Record<string, number>> = {}
  for (const group of configuration.groups) {
    // Refs encode PB IDs when describeConfiguration creates the observation.
    // No model-supplied ID is decoded until it matches that validated schema.
    if (!/^g-\d+$/.test(group.ref) || group.choices.some(choice => !/^a-\d+$/.test(choice.ref)))
      throw new Error('PB 規格識別格式已變更，尚未建立寫入表單。')
    const quantities = Object.fromEntries(group.choices.map(choice => [choice.ref.slice(2), selection.choices.find(selected => selected.ref === choice.ref)?.quantity ?? 0]))
    if (group.required && group.maximum === 1) {
      attrs[group.ref.slice(2)] = Number(Object.entries(quantities).find(([, quantity]) => quantity === 1)![0])
    }
    else {
      attrs[group.ref.slice(2)] = quantities
    }
  }
  return { ...selected, form: { productGroupId: null, productId: input.productId, priceId: null, attrs, subProductPrices: [], amount: input.quantity, unit_price: configuration.unitPrice, note: input.note } }
}

/** Canonical receipt uses stable option IDs; vendor row IDs/timestamps are not selections. */
export function cartConfiguration(note: string, prices: unknown) {
  const rows = parse(array(looseObject({ item_type: string(), item_id: number(), parent_id: nullable(number()), product_attrs: array(looseObject({ attr_id: number(), amount: number(), unit_price: number() })) })), prices)
  const roots = rows.filter(row => row.parent_id === null)
  // Nested product groups have a distinct configuration. Never collapse them
  // into a basic product and accidentally merge or verify a partial selection.
  if (roots.length !== 1 || rows.length !== 1)
    return JSON.stringify({ note, productPrices: rows })
  const root = roots[0]
  return JSON.stringify({ note, variantRef: root.item_type === 'product_price' ? `v-${root.item_id}` : '', choices: root.product_attrs.map(choice => ({ ref: `a-${choice.attr_id}`, quantity: choice.amount, unitPrice: choice.unit_price })).sort((a, b) => a.ref.localeCompare(b.ref)) })
}
