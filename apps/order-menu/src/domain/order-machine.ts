import type { Composition } from '../../../order-menu-server/src/domain/composition'
import type { RecommendationSignal } from '../../../order-menu-server/src/domain/recommendation'
import type { MenuPageState } from './menuPageState'

import { orderQuantityMaximum } from '@proj-airi/stage-shared/kiosk-conversation'

import cuttlefishBallImageUrl from '../assets/cuttlefish-ball.svg'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { QuantityLimitError } from './quantityPolicy'

export { menuPageStates } from './menuPageState'
export type { MenuPageState } from './menuPageState'

export interface MenuOptionValue {
  id: string
  label: string
  priceDelta: number
}

export interface MenuOptionGroup {
  id: string
  label: string
  required: boolean
  values: MenuOptionValue[]
}

/** Describes the customer needs that the demo catalog can verify for recommendations. */
export type RecommendationTag = 'fried' | 'rice'

export interface MenuItem {
  recommendationSignals?: RecommendationSignal[]
  /** Missing facts are unknown, never proof that an ingredient is absent. */
  composition?: Composition
  /** Customer-spoken names supplied by the catalog, not inferred from categories. */
  aliases?: string[]
  /** The POS can retain an unavailable item for customer-facing explanation, but it cannot be ordered. */
  available?: boolean
  /** Page-observed state takes precedence over catalog availability in the trial UI. */
  pageState?: MenuPageState
  id: string
  name: string
  description: string
  category: string
  imageUrl: string
  /** Textual fallback supplied by a POS catalog when no product image exists. */
  symbol?: string
  price: number
  recommendationTags: RecommendationTag[]
  optionGroups: MenuOptionGroup[]
}

/** The page can look selectable before a selection is rejected. */
export function menuPageState(item: MenuItem): MenuPageState {
  return item.pageState ?? (item.available === false ? 'sold-out' : 'available')
}

/** Read-only page evidence. A selectable control is not an inventory count. */
export function itemAvailability(item: MenuItem) {
  const state = menuPageState(item)
  const status = state === 'selection-failure' ? 'available' : state
  const copy = orderingMessages['zh-Hant']
  const template = status === 'available' ? copy.available : status === 'sold-out' ? copy.soldOut : copy.availabilityUnknown
  return { id: item.id, name: item.name, status, customerMessage: template.replace('{item}', item.name) }
}

/** Known page refusal, distinct from a lost mutation receipt or payment result. */
export class ItemSelectionError extends Error {
  readonly rejection = 'item-selection'
  constructor(item: MenuItem, rejected = false) {
    super(rejected ? orderingMessages['zh-Hant'].selectionRejected.replace('{item}', item.name) : itemAvailability(item).customerMessage)
  }
}

export interface Selection {
  itemId: string
  quantity: number
  options: Record<string, string>
}

export interface CartLine extends Selection {
  id: string
  name: string
  unitPrice: number
}

/** Order-level service choice; this venue uses takeout for immediate self-pickup, not a reservation. */
export type FulfillmentMode = 'dine-in' | 'takeout'

export interface CartSnapshot {
  /** Revision received with the POS catalog that priced this cart. */
  catalogRevision?: string
  /** Undefined until the customer explicitly chooses where the order is served. */
  fulfillmentMode: FulfillmentMode | undefined
  lines: CartLine[]
  total: number
  itemCount: number
  /** POS payment transaction verified before this cart may be submitted. */
  paymentId?: string
}

/** Identifies whether a submission was intentionally made against test or live POS infrastructure. */
export type SubmissionEnvironment = 'test' | 'live'

/** States whether the POS confirmed the order, declined it, or left its result unknown. */
export type SubmissionStatus = 'accepted' | 'rejected' | 'uncertain'

/** The supplier-neutral truth returned after an order submission attempt. */
export interface SubmissionReceipt {
  customerMessage: string
  environment: SubmissionEnvironment
  posOrderId?: string
  retryable: boolean
  status: SubmissionStatus
}

/** Combines the local order snapshot with the authoritative submission receipt. */
export interface SubmittedOrder {
  id: string
  cart: CartSnapshot
  receipt: SubmissionReceipt
}

export interface PosOrderGateway {
  submit: (cart: CartSnapshot) => Promise<SubmittedOrder>
}

/** Declares the provenance and ordering boundary of the demo catalog. */
export const catalogInfo = {
  isSimulated: true,
  sourceName: '周氏蝦捲公開產品資料',
  sourceUrl: 'https://www.chous.com.tw/chous/products.html',
} as const

/**
 * Simulated, dine-in-sized menu inspired by Chou's Shrimp Rolls' public product
 * catalogue. Names follow the published catalogue where available; portions and
 * prices are deliberately local demo data, not the restaurant's official pricing.
 *
 * Sources:
 * - https://www.chous.com.tw/chous/products.html
 * - https://www.chous.com.tw/shoppingcool/m_mall_list.php?ps_ctid=01000000
 * - https://www.ubereats.com/tw/store/%E5%91%A8%E6%B0%8F%E8%9D%A6%E6%8D%B2%E5%AE%89%E5%B9%B3%E7%B8%BD%E5%BA%97/DAYskMw4VRe-vPy29-EfNQ
 */
export const menu: MenuItem[] = [
  {
    id: 'fish-floss-minced-pork-rice-set',
    name: '魚鬆肉燥飯套餐',
    description: '周氏蝦捲、魚鬆肉燥飯、燙青菜與綜合湯的單人組合',
    category: '超值套餐',
    imageUrl: 'https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=720&q=80',
    price: 380,
    recommendationTags: ['rice'],
    optionGroups: [
      {
        id: 'set-ginger',
        label: '蝦捲嫩薑',
        required: false,
        values: [
          { id: 'with-ginger', label: '附甜漬嫩薑', priceDelta: 0 },
          { id: 'without-ginger', label: '不附嫩薑', priceDelta: 0 },
        ],
      },
      {
        id: 'set-soup-cilantro',
        label: '綜合湯香菜',
        required: false,
        values: [
          { id: 'with-cilantro', label: '加香菜', priceDelta: 0 },
          { id: 'without-cilantro', label: '不要香菜', priceDelta: 0 },
        ],
      },
    ],
  },
  {
    id: 'braised-pork-set',
    name: '東坡肉套餐',
    description: '東坡肉搭配白飯、燙青菜及紅茶的飽足組合',
    category: '超值套餐',
    imageUrl: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=720&q=80',
    price: 250,
    recommendationTags: [],
    optionGroups: [
      {
        id: 'set-tea-sugar',
        label: '紅茶甜度',
        required: true,
        values: [
          { id: 'no-sugar', label: '無糖', priceDelta: 0 },
          { id: 'half-sugar', label: '半糖', priceDelta: 0 },
          { id: 'full-sugar', label: '全糖', priceDelta: 0 },
        ],
      },
      {
        id: 'set-tea-ice',
        label: '紅茶冰量',
        required: true,
        values: [
          { id: 'normal-ice', label: '正常冰', priceDelta: 0 },
          { id: 'less-ice', label: '少冰', priceDelta: 0 },
          { id: 'no-ice', label: '去冰', priceDelta: 0 },
        ],
      },
    ],
  },
  {
    id: 'chous-shrimp-roll',
    name: '周氏蝦捲',
    description: '現炸蝦捲搭配甜漬嫩薑片',
    category: '招牌小吃',
    imageUrl: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=720&q=80',
    price: 75,
    recommendationTags: ['fried'],
    optionGroups: [
      {
        id: 'ginger',
        label: '嫩薑',
        required: false,
        values: [
          { id: 'with-ginger', label: '附甜漬嫩薑', priceDelta: 0 },
          { id: 'without-ginger', label: '不附嫩薑', priceDelta: 0 },
        ],
      },
    ],
  },
  {
    id: 'tofu-skin-shrimp-roll',
    name: '豆皮鮮蝦捲',
    description: '以豆皮包裹鮮蝦餡，酥香上桌',
    category: '招牌小吃',
    imageUrl: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=720&q=80',
    price: 80,
    recommendationTags: ['fried'],
    optionGroups: [
      {
        id: 'sauce',
        label: '醬料',
        required: true,
        values: [
          { id: 'sweet-chili', label: '甜辣醬', priceDelta: 0 },
          { id: 'soy-paste', label: '醬油膏', priceDelta: 0 },
        ],
      },
    ],
  },
  {
    id: 'golden-seafood-pie',
    name: '黃金海鮮派',
    description: '酥脆金黃、海味飽滿的分享炸物',
    category: '招牌小吃',
    imageUrl: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=720&q=80',
    price: 70,
    recommendationTags: ['fried'],
    optionGroups: [
      {
        id: 'sauce',
        label: '醬料',
        required: true,
        values: [
          { id: 'sweet-chili', label: '甜辣醬', priceDelta: 0 },
          { id: 'soy-paste', label: '醬油膏', priceDelta: 0 },
        ],
      },
    ],
  },
  {
    id: 'danzai-noodles',
    name: '周氏擔仔麵',
    description: '獨家肉燥、蝦仁與香菜的台南擔仔麵',
    category: '麵飯主食',
    imageUrl: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=720&q=80',
    price: 65,
    recommendationTags: [],
    optionGroups: [
      {
        id: 'cilantro',
        label: '香菜',
        required: false,
        values: [
          { id: 'with-cilantro', label: '加香菜', priceDelta: 0 },
          { id: 'without-cilantro', label: '不要香菜', priceDelta: 0 },
        ],
      },
    ],
  },
  {
    id: 'meat-sauce-rice',
    name: '古早味肉燥飯',
    description: '瘦肉與肥肉黃金比例的手作肉燥',
    category: '麵飯主食',
    imageUrl: 'https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=720&q=80',
    price: 45,
    recommendationTags: ['rice'],
    optionGroups: [
      {
        id: 'rice-size',
        label: '份量',
        required: true,
        values: [
          { id: 'regular', label: '小碗', priceDelta: 0 },
          { id: 'large', label: '大碗', priceDelta: 20 },
        ],
      },
    ],
  },
  {
    id: 'cabbage-dumplings',
    name: '高麗菜水餃',
    description: '手工水餃，鮮甜爽口',
    category: '麵飯主食',
    imageUrl: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=720&q=80',
    price: 70,
    recommendationTags: [],
    optionGroups: [
      {
        id: 'dumpling-count',
        label: '份量',
        required: true,
        values: [
          { id: 'six', label: '6 顆', priceDelta: 0 },
          { id: 'ten', label: '10 顆', priceDelta: 40 },
        ],
      },
    ],
  },
  {
    id: 'chive-dumplings',
    name: '韭菜水餃',
    description: '手工製作，帶有韭菜清香',
    category: '麵飯主食',
    imageUrl: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=720&q=80',
    price: 70,
    recommendationTags: [],
    optionGroups: [
      {
        id: 'dumpling-count',
        label: '份量',
        required: true,
        values: [
          { id: 'six', label: '6 顆', priceDelta: 0 },
          { id: 'ten', label: '10 顆', priceDelta: 40 },
        ],
      },
    ],
  },
  {
    id: 'milkfish-ball-soup',
    name: '虱目魚丸湯',
    description: '鮮甜虱目魚丸與清湯',
    category: '湯品',
    imageUrl: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=720&q=80',
    price: 50,
    recommendationTags: [],
    optionGroups: [
      {
        id: 'cilantro',
        label: '香菜',
        required: false,
        values: [
          { id: 'with-cilantro', label: '加香菜', priceDelta: 0 },
          { id: 'without-cilantro', label: '不要香菜', priceDelta: 0 },
        ],
      },
    ],
  },
  {
    id: 'shrimp-ball-soup',
    name: '蝦丸湯',
    description: '彈牙蝦丸搭配清爽湯頭',
    category: '湯品',
    imageUrl: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=720&q=80',
    price: 55,
    recommendationTags: [],
    optionGroups: [],
  },
  {
    id: 'floating-fish-soup',
    name: '白北浮水魚羹',
    description: '府城風味魚羹，暖胃順口',
    category: '湯品',
    imageUrl: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=720&q=80',
    price: 60,
    recommendationTags: [],
    optionGroups: [
      {
        id: 'cilantro',
        label: '香菜',
        required: false,
        values: [
          { id: 'with-cilantro', label: '加香菜', priceDelta: 0 },
          { id: 'without-cilantro', label: '不要香菜', priceDelta: 0 },
        ],
      },
    ],
  },
  {
    id: 'cuttlefish-ball',
    name: '花枝丸',
    description: '手工製作，保留花枝鮮甜口感',
    category: '炸物小點',
    imageUrl: cuttlefishBallImageUrl,
    price: 65,
    recommendationTags: ['fried'],
    optionGroups: [
      {
        id: 'spice',
        label: '辣度',
        required: true,
        values: [
          { id: 'no-spice', label: '不辣', priceDelta: 0 },
          { id: 'mild', label: '小辣', priceDelta: 0 },
          { id: 'spicy', label: '大辣', priceDelta: 0 },
        ],
      },
    ],
  },
  {
    id: 'cuttlefish-shrimp-patty',
    name: '花枝蝦排',
    description: '海味十足的花枝與鮮蝦炸排',
    category: '炸物小點',
    imageUrl: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=720&q=80',
    price: 75,
    recommendationTags: ['fried'],
    optionGroups: [
      {
        id: 'sauce',
        label: '醬料',
        required: true,
        values: [
          { id: 'sweet-chili', label: '甜辣醬', priceDelta: 0 },
          { id: 'mustard', label: '芥末醬', priceDelta: 0 },
        ],
      },
    ],
  },
  {
    id: 'peanut-rice-dumpling',
    name: '南部花生肉粽',
    description: 'Q 彈糯米與花生的府城風味',
    category: '炸物小點',
    imageUrl: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=720&q=80',
    price: 60,
    recommendationTags: [],
    optionGroups: [
      {
        id: 'sauce',
        label: '醬料',
        required: true,
        values: [
          { id: 'sweet-chili', label: '甜辣醬', priceDelta: 0 },
          { id: 'soy-paste', label: '醬油膏', priceDelta: 0 },
        ],
      },
    ],
  },
  {
    id: 'almond-red-bean-tofu',
    name: '杏仁紅豆豆腐',
    description: '杏仁清香、質地細緻綿密的餐後甜品',
    category: '甜品',
    imageUrl: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=720&q=80',
    price: 55,
    recommendationTags: [],
    optionGroups: [],
  },
  {
    id: 'roselle-plum-drink',
    name: '洛神酸梅湯',
    description: '酸甜好滋味，適合搭配炸物',
    category: '飲品',
    imageUrl: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=720&q=80',
    price: 40,
    recommendationTags: [],
    optionGroups: [
      {
        id: 'sugar',
        label: '甜度',
        required: true,
        values: [
          { id: 'no-sugar', label: '無糖', priceDelta: 0 },
          { id: 'half-sugar', label: '半糖', priceDelta: 0 },
          { id: 'full-sugar', label: '全糖', priceDelta: 0 },
        ],
      },
      {
        id: 'ice',
        label: '冰量',
        required: true,
        values: [
          { id: 'normal-ice', label: '正常冰', priceDelta: 0 },
          { id: 'less-ice', label: '少冰', priceDelta: 0 },
          { id: 'no-ice', label: '去冰', priceDelta: 0 },
        ],
      },
    ],
  },
  {
    id: 'winter-melon-tea',
    name: '古早味冬瓜茶',
    description: '甜香順口的冰涼冬瓜茶',
    category: '飲品',
    imageUrl: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=720&q=80',
    price: 35,
    recommendationTags: [],
    optionGroups: [
      {
        id: 'ice',
        label: '冰量',
        required: true,
        values: [
          { id: 'normal-ice', label: '正常冰', priceDelta: 0 },
          { id: 'less-ice', label: '少冰', priceDelta: 0 },
          { id: 'no-ice', label: '去冰', priceDelta: 0 },
        ],
      },
    ],
  },
]

// Explicit simulated recipes, not conclusions inferred from dish names or tags.
const demoIngredients: Record<string, string[]> = {
  'fish-floss-minced-pork-rice-set': ['pork', 'seafood', 'rice', 'vegetables'],
  'braised-pork-set': ['pork', 'rice', 'vegetables'],
  'chous-shrimp-roll': ['seafood', 'wheat'],
  'tofu-skin-shrimp-roll': ['seafood'],
  'golden-seafood-pie': ['seafood', 'wheat'],
  'danzai-noodles': ['pork', 'seafood', 'wheat'],
  'meat-sauce-rice': ['pork', 'rice'],
  'cabbage-dumplings': ['pork', 'wheat', 'vegetables'],
  'chive-dumplings': ['pork', 'wheat', 'vegetables'],
  'milkfish-ball-soup': ['seafood'],
  'shrimp-ball-soup': ['seafood'],
  'floating-fish-soup': ['seafood'],
  'cuttlefish-ball': ['seafood'],
  'cuttlefish-shrimp-patty': ['seafood'],
  'peanut-rice-dumpling': ['pork', 'rice'],
  'almond-red-bean-tofu': ['milk'],
  'roselle-plum-drink': [],
  'winter-melon-tea': [],
}
for (const item of menu)
  item.composition = { ingredients: demoIngredients[item.id]!, complete: true, source: 'simulation', revision: 'simplified-demo-1', removals: [] }

/**
 * Returns the initial option selection for a menu item.
 *
 * Required groups remain unselected until the customer chooses. Optional
 * groups retain their declared initial value.
 */
export function defaultOptionsFor(item: MenuItem): Record<string, string> {
  return Object.fromEntries(item.optionGroups.flatMap((group) => {
    const firstValue = group.values[0]
    return !group.required && firstValue ? [[group.id, firstValue.id]] : []
  }))
}

function cloneCart(
  cart: CartLine[],
  fulfillmentMode: FulfillmentMode | undefined,
  catalogRevision: string | undefined,
  paymentId?: string,
): CartSnapshot {
  return {
    ...(catalogRevision ? { catalogRevision } : {}),
    fulfillmentMode,
    lines: cart.map(line => ({ ...line, options: { ...line.options } })),
    total: cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    itemCount: cart.reduce((sum, line) => sum + line.quantity, 0),
    ...(paymentId ? { paymentId } : {}),
  }
}

function resolveUnitPrice(item: MenuItem, options: Record<string, string>): number {
  return item.price + item.optionGroups.reduce((sum, group) => {
    const selected = group.values.find(value => value.id === options[group.id])
    return sum + (selected?.priceDelta ?? 0)
  }, 0)
}

function hasSameOptions(left: Record<string, string>, right: Record<string, string>) {
  const leftEntries = Object.entries(left)
  return leftEntries.length === Object.keys(right).length
    && leftEntries.every(([groupId, valueId]) => right[groupId] === valueId)
}

/** Owns order validation and offers a replaceable seam for a real POS gateway. */
export function createOrderMachine(options: { menu?: MenuItem[], gateway?: PosOrderGateway } = {}) {
  let catalog = [...(options.menu ?? menu)]
  let catalogRevision: string | undefined
  const cart: CartLine[] = []
  let selection: Selection | undefined
  let lastAddedLineId: string | undefined
  let fulfillmentMode: FulfillmentMode | undefined
  let paymentId: string | undefined
  let acceptedOrder: SubmittedOrder | undefined
  let uncertainOrder: SubmittedOrder | undefined
  let pendingSubmission: Promise<SubmittedOrder> | undefined
  // Each successful write advances its owning domain, even when the visible
  // snapshot later returns to an earlier value (the ABA stale-plan case).
  const revisions = { cart: 0, menu: 0, selectedItem: 0 }

  function invalidatePayment() {
    paymentId = undefined
  }

  function itemOrThrow(itemId: string) {
    const item = catalog.find(candidate => candidate.id === itemId)
    if (!item)
      throw new Error(`Unknown menu item: ${itemId}`)
    return item
  }

  function selectMenuItem(itemId: string) {
    const item = itemOrThrow(itemId)
    assertItemSelectable(itemId)
    selection = { itemId, quantity: 1, options: defaultOptionsFor(item) }
    revisions.selectedItem += 1
    return { ...selection, options: { ...selection.options } }
  }

  function selectedOrThrow() {
    if (!selection)
      throw new Error('Select a menu item before changing its options or quantity.')
    return selection
  }

  function setItemOption(groupId: string, valueId: string) {
    const current = selectedOrThrow()
    const item = itemOrThrow(current.itemId)
    const group = item.optionGroups.find(candidate => candidate.id === groupId)
    if (!group?.values.some(value => value.id === valueId))
      throw new Error(`Invalid option ${groupId}:${valueId} for ${item.name}.`)
    current.options = { ...current.options, [groupId]: valueId }
    revisions.selectedItem += 1
    return { ...current, options: { ...current.options } }
  }

  function setQuantity(quantity: number) {
    const current = selectedOrThrow()
    if (Number.isInteger(quantity) && quantity > orderQuantityMaximum)
      throw new QuantityLimitError(quantity)
    if (!Number.isInteger(quantity) || quantity < 1)
      throw new Error('Quantity must be a positive integer.')
    current.quantity = quantity
    revisions.selectedItem += 1
    return { ...current, options: { ...current.options } }
  }

  /** Commits an addition or a validated whole-line replacement without an intermediate cart. */
  function addToCart(replaceLineId?: string) {
    const original = replaceLineId === undefined ? undefined : cart.find(line => line.id === replaceLineId)
    if (replaceLineId !== undefined && !original)
      throw new Error(`Unknown cart line: ${replaceLineId}`)
    const current = selectedOrThrow()
    const item = itemOrThrow(current.itemId)
    assertItemSelectable(item.id)
    for (const group of item.optionGroups) {
      if (group.required && !group.values.some(value => value.id === current.options[group.id]))
        throw new Error(`Required option is missing: ${group.label}`)
    }
    const matchingLine = cart.find(line => line.id !== replaceLineId && line.itemId === item.id && hasSameOptions(line.options, current.options))
    const line: CartLine = {
      id: matchingLine?.id ?? `line-${crypto.randomUUID()}`,
      itemId: item.id,
      name: item.name,
      quantity: (matchingLine?.quantity ?? 0) + current.quantity,
      options: { ...current.options },
      unitPrice: resolveUnitPrice(item, current.options),
    }
    if (line.quantity > orderQuantityMaximum)
      throw new QuantityLimitError(line.quantity)
    // All validation precedes this synchronous commit. No callback can observe
    // a missing original or an extra replacement, including a merge into an
    // already-present equivalent line. Failure leaves the original cart intact.
    const nextCart = cart.filter(candidate => candidate.id !== replaceLineId).map(candidate => candidate.id === matchingLine?.id ? line : candidate)
    if (!matchingLine)
      nextCart.push(line)
    invalidatePayment()
    cart.splice(0, cart.length, ...nextCart)
    lastAddedLineId = line.id
    selection = undefined
    revisions.cart += 1
    revisions.selectedItem += 1
    return {
      line: { ...line, options: { ...line.options } },
      cart: cloneCart(cart, fulfillmentMode, catalogRevision),
      ...(original ? { replacedLine: { ...original, options: { ...original.options } } } : {}),
    }
  }

  function removeFromCart(lineId: string) {
    const index = cart.findIndex(line => line.id === lineId)
    if (index < 0)
      throw new Error(`Unknown cart line: ${lineId}`)
    invalidatePayment()
    cart.splice(index, 1)
    if (lastAddedLineId === lineId)
      lastAddedLineId = undefined
    revisions.cart += 1
    return cloneCart(cart, fulfillmentMode, catalogRevision)
  }

  function setCartLineQuantity(lineId: string, quantity: number) {
    if (Number.isInteger(quantity) && quantity > orderQuantityMaximum)
      throw new QuantityLimitError(quantity)
    if (!Number.isInteger(quantity) || quantity < 1)
      throw new Error('Cart line quantity must be a positive integer.')

    const line = cart.find(candidate => candidate.id === lineId)
    if (!line)
      throw new Error(`Unknown cart line: ${lineId}`)
    invalidatePayment()
    line.quantity = quantity
    revisions.cart += 1
    return cloneCart(cart, fulfillmentMode, catalogRevision)
  }

  /** Updates one completed cart line without asking the customer to re-add it. */
  function setCartLineOption(lineId: string, groupId: string, valueId: string) {
    const lineIndex = cart.findIndex(candidate => candidate.id === lineId)
    if (lineIndex < 0)
      throw new Error(`Unknown cart line: ${lineId}`)

    const line = cart[lineIndex]!
    const item = itemOrThrow(line.itemId)
    const group = item.optionGroups.find(candidate => candidate.id === groupId)
    if (!group?.values.some(value => value.id === valueId))
      throw new Error(`Invalid option ${groupId}:${valueId} for ${item.name}.`)

    const nextOptions = { ...line.options, [groupId]: valueId }
    const matchingLine = cart.find(candidate => candidate.id !== line.id && candidate.itemId === line.itemId && hasSameOptions(candidate.options, nextOptions))
    if (matchingLine && matchingLine.quantity + line.quantity > orderQuantityMaximum)
      throw new QuantityLimitError(matchingLine.quantity + line.quantity)
    // Validate the resulting merged count before changing options or revisions.
    invalidatePayment()
    line.options = nextOptions
    line.unitPrice = resolveUnitPrice(item, nextOptions)
    revisions.cart += 1

    // Preserve the one-line-per-identical-choice invariant after an edit.
    if (matchingLine) {
      matchingLine.quantity += line.quantity
      cart.splice(lineIndex, 1)
      if (lastAddedLineId === line.id)
        lastAddedLineId = matchingLine.id
      return { cart: cloneCart(cart, fulfillmentMode, catalogRevision), line: { ...matchingLine, options: { ...matchingLine.options } } }
    }

    return { cart: cloneCart(cart, fulfillmentMode, catalogRevision), line: { ...line, options: { ...line.options } } }
  }

  /** Discards an unsubmitted cart and its pending selection. */
  function clearCart() {
    if (acceptedOrder)
      throw new Error('Cannot clear a cart after its order was accepted.')

    if (uncertainOrder)
      throw new Error('Cannot clear a cart while its submitted order is awaiting reconciliation.')

    cart.splice(0)
    selection = undefined
    lastAddedLineId = undefined
    fulfillmentMode = undefined
    paymentId = undefined
    revisions.cart += 1
    revisions.selectedItem += 1
    return cloneCart(cart, fulfillmentMode, catalogRevision)
  }

  function setFulfillmentMode(mode: FulfillmentMode) {
    invalidatePayment()
    fulfillmentMode = mode
    revisions.cart += 1
    return cloneCart(cart, fulfillmentMode, catalogRevision)
  }

  async function confirmOrder() {
    if (acceptedOrder)
      return acceptedOrder
    // An uncertain response may represent an order already received by the POS.
    // Keep it stable until the future Bridge reconciles by idempotency key.
    if (uncertainOrder)
      return uncertainOrder
    if (pendingSubmission)
      return await pendingSubmission

    const snapshot = cloneCart(cart, fulfillmentMode, catalogRevision, paymentId)
    if (snapshot.lines.length === 0)
      throw new Error('Cart is empty.')
    if (!snapshot.fulfillmentMode)
      throw new Error('Choose dine-in or self-pickup before confirming the order.')

    pendingSubmission = options.gateway?.submit(snapshot) ?? Promise.resolve({
      id: `demo-${crypto.randomUUID()}`,
      cart: snapshot,
      receipt: {
        customerMessage: '測試訂單已確認，未送往正式 POS。',
        environment: 'test' as const,
        retryable: false,
        status: 'accepted' as const,
      },
    })
    try {
      const submittedOrder = await pendingSubmission
      if (submittedOrder.receipt.status === 'accepted')
        acceptedOrder = submittedOrder
      else if (submittedOrder.receipt.status === 'uncertain')
        uncertainOrder = submittedOrder
      return submittedOrder
    }
    finally {
      pendingSubmission = undefined
    }
  }

  /** Binds one terminal-authorized payment to the immutable order snapshot submitted next. */
  function setPaymentId(nextPaymentId: string) {
    if (!nextPaymentId.trim())
      throw new Error('Payment ID is required before submitting the order.')
    paymentId = nextPaymentId
    revisions.cart += 1
    return cloneCart(cart, fulfillmentMode, catalogRevision, paymentId)
  }

  /** Clears only the in-progress order so the host can begin a new customer session. */
  function reset() {
    cart.splice(0)
    selection = undefined
    lastAddedLineId = undefined
    acceptedOrder = undefined
    uncertainOrder = undefined
    pendingSubmission = undefined
    fulfillmentMode = undefined
    paymentId = undefined
    revisions.cart += 1
    revisions.selectedItem += 1
    return cloneCart(cart, fulfillmentMode, catalogRevision)
  }

  /**
   * Replaces the active POS catalog before a customer begins an order. Keeping
   * an active cart intact is safer than silently repricing it during refresh.
   */
  function setMenu(nextMenu: MenuItem[], revision?: string) {
    if (cart.length > 0 || selection)
      throw new Error('Cannot replace the menu while an order is in progress.')
    if (nextMenu.length === 0)
      throw new Error('The POS catalog has no available items.')
    catalog = [...nextMenu]
    catalogRevision = revision
    revisions.menu += 1
  }

  function setItemPageState(itemId: string, state: MenuPageState) {
    itemOrThrow(itemId)
    // Only operability changes. Existing cart prices and quantities are retained;
    // the menu revision invalidates plans issued before the observed change.
    catalog = catalog.map(item => item.id === itemId ? { ...item, pageState: state, available: state === 'available' || state === 'selection-failure' } : item)
    revisions.menu += 1
  }

  function assertItemSelectable(itemId: string) {
    const item = itemOrThrow(itemId)
    const state = menuPageState(item)
    if (state === 'available')
      return
    if (state === 'selection-failure') {
      setItemPageState(itemId, 'unknown')
      throw new ItemSelectionError(item, true)
    }
    throw new ItemSelectionError(item)
  }

  return {
    assertItemSelectable,
    addToCart,
    clearCart,
    confirmOrder,
    getCart: () => cloneCart(cart, fulfillmentMode, catalogRevision, paymentId),
    /** The last successfully added line, if it still exists in this cart. */
    getLastAddedLineId: () => lastAddedLineId,
    getMenu: (category?: string) => category ? catalog.filter(item => item.category === category) : [...catalog],
    /** Monotonic write revisions used to reject stale kiosk plans, including edit-then-undo. */
    getRevisions: () => ({ ...revisions }),
    getSelection: () => selection ? { ...selection, options: { ...selection.options } } : undefined,
    removeFromCart,
    reset,
    selectMenuItem,
    setCartLineQuantity,
    setCartLineOption,
    setFulfillmentMode,
    setItemOption,
    setItemPageState,
    setMenu,
    setPaymentId,
    setQuantity,
  }
}
