import cuttlefishBallImageUrl from '../assets/cuttlefish-ball.svg'

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

export interface MenuItem {
  id: string
  name: string
  description: string
  category: string
  imageUrl: string
  price: number
  optionGroups: MenuOptionGroup[]
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

export interface CartSnapshot {
  lines: CartLine[]
  total: number
  itemCount: number
}

export interface SubmittedOrder {
  id: string
  cart: CartSnapshot
  status: 'simulated'
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
 */
export const menu: MenuItem[] = [
  {
    id: 'chous-shrimp-roll',
    name: '周氏蝦捲',
    description: '現炸蝦捲搭配甜漬嫩薑片',
    category: '招牌小吃',
    imageUrl: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=720&q=80',
    price: 75,
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
    optionGroups: [],
  },
  {
    id: 'floating-fish-soup',
    name: '白北浮水魚羹',
    description: '府城風味魚羹，暖胃順口',
    category: '湯品',
    imageUrl: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=720&q=80',
    price: 60,
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
    optionGroups: [],
  },
  {
    id: 'roselle-plum-drink',
    name: '洛神酸梅湯',
    description: '酸甜好滋味，適合搭配炸物',
    category: '飲品',
    imageUrl: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=720&q=80',
    price: 40,
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

/**
 * Returns the initial option selection for a menu item.
 *
 * Each option group defaults to its first declared value so a customer can add
 * an item immediately while still changing any available customization first.
 */
export function defaultOptionsFor(item: MenuItem): Record<string, string> {
  return Object.fromEntries(item.optionGroups.flatMap((group) => {
    const firstValue = group.values[0]
    return firstValue ? [[group.id, firstValue.id]] : []
  }))
}

function cloneCart(cart: CartLine[]): CartSnapshot {
  return {
    lines: cart.map(line => ({ ...line, options: { ...line.options } })),
    total: cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    itemCount: cart.reduce((sum, line) => sum + line.quantity, 0),
  }
}

function resolveUnitPrice(item: MenuItem, options: Record<string, string>): number {
  return item.price + item.optionGroups.reduce((sum, group) => {
    const selected = group.values.find(value => value.id === options[group.id])
    return sum + (selected?.priceDelta ?? 0)
  }, 0)
}

/** Owns order validation and offers a replaceable seam for a real POS gateway. */
export function createOrderMachine(options: { menu?: MenuItem[], gateway?: PosOrderGateway } = {}) {
  const catalog = options.menu ?? menu
  const cart: CartLine[] = []
  let selection: Selection | undefined

  function itemOrThrow(itemId: string) {
    const item = catalog.find(candidate => candidate.id === itemId)
    if (!item)
      throw new Error(`Unknown menu item: ${itemId}`)
    return item
  }

  function selectMenuItem(itemId: string) {
    const item = itemOrThrow(itemId)
    selection = { itemId, quantity: 1, options: defaultOptionsFor(item) }
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
    return { ...current, options: { ...current.options } }
  }

  function setQuantity(quantity: number) {
    const current = selectedOrThrow()
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20)
      throw new Error('Quantity must be an integer from 1 to 20.')
    current.quantity = quantity
    return { ...current, options: { ...current.options } }
  }

  function addToCart() {
    const current = selectedOrThrow()
    const item = itemOrThrow(current.itemId)
    const line: CartLine = {
      id: `line-${crypto.randomUUID()}`,
      itemId: item.id,
      name: item.name,
      quantity: current.quantity,
      options: { ...current.options },
      unitPrice: resolveUnitPrice(item, current.options),
    }
    cart.push(line)
    selection = undefined
    return { line: { ...line, options: { ...line.options } }, cart: cloneCart(cart) }
  }

  function removeFromCart(lineId: string) {
    const index = cart.findIndex(line => line.id === lineId)
    if (index < 0)
      throw new Error(`Unknown cart line: ${lineId}`)
    cart.splice(index, 1)
    return cloneCart(cart)
  }

  async function confirmOrder() {
    const snapshot = cloneCart(cart)
    if (snapshot.lines.length === 0)
      throw new Error('Cart is empty.')
    return await (options.gateway?.submit(snapshot) ?? Promise.resolve({
      id: `demo-${crypto.randomUUID()}`,
      cart: snapshot,
      status: 'simulated' as const,
    }))
  }

  return {
    addToCart,
    confirmOrder,
    getCart: () => cloneCart(cart),
    getMenu: (category?: string) => category ? catalog.filter(item => item.category === category) : [...catalog],
    getSelection: () => selection ? { ...selection, options: { ...selection.options } } : undefined,
    removeFromCart,
    selectMenuItem,
    setItemOption,
    setQuantity,
  }
}
