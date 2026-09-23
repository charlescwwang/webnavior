import type { MenuItem, RecommendationTag } from './domain/order-machine'

import { errorMessageFrom } from '@moeru/std'

export interface PosCatalog {
  items: MenuItem[]
  revision: string
  store: {
    name: string
    slogan: string
    symbol: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`POS catalog item has an invalid ${field}.`)
  return value
}

function stringValue(value: unknown, field: string) {
  if (typeof value !== 'string')
    throw new Error(`POS catalog has an invalid ${field}.`)
  return value
}

function requiredNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error(`POS catalog item has an invalid ${field}.`)
  return value
}

function optionGroups(value: unknown): MenuItem['optionGroups'] {
  if (!Array.isArray(value))
    throw new Error('POS catalog item has invalid optionGroups.')

  return value.map((group) => {
    if (!isRecord(group) || !Array.isArray(group.values))
      throw new Error('POS catalog item has an invalid option group.')

    return {
      id: requiredString(group.id, 'option group id'),
      label: requiredString(group.label, 'option group label'),
      required: group.required === true,
      values: group.values.map((option) => {
        if (!isRecord(option))
          throw new Error('POS catalog item has an invalid option value.')
        return {
          id: requiredString(option.id, 'option value id'),
          label: requiredString(option.label, 'option value label'),
          priceDelta: requiredNumber(option.priceDelta, 'option value priceDelta'),
        }
      }),
    }
  })
}

function recommendationTags(value: unknown): RecommendationTag[] {
  const validTags: RecommendationTag[] = ['fried', 'pork-free', 'rice']
  if (!Array.isArray(value) || !value.every(tag => typeof tag === 'string' && validTags.includes(tag as RecommendationTag)))
    throw new Error('POS catalog item has invalid recommendationTags.')
  return value as RecommendationTag[]
}

function parseCatalog(value: unknown): PosCatalog {
  if (!isRecord(value) || !isRecord(value.catalog))
    throw new Error('POS Bridge returned an invalid catalog response.')

  const { catalog } = value
  const rawItems = catalog.items
  const store = catalog.store
  if (!Array.isArray(rawItems) || !isRecord(store))
    throw new Error('POS Bridge returned an invalid catalog response.')

  const items = rawItems.map((item) => {
    if (!isRecord(item) || typeof item.available !== 'boolean')
      throw new Error('POS catalog contains an invalid availability state.')

    return {
      available: item.available,
      category: requiredString(item.category, 'category'),
      description: requiredString(item.description, 'description'),
      id: requiredString(item.id, 'id'),
      imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl : '',
      name: requiredString(item.name, 'name'),
      optionGroups: optionGroups(item.optionGroups),
      price: requiredNumber(item.price, 'price'),
      recommendationTags: recommendationTags(item.recommendationTags),
      symbol: typeof item.symbol === 'string' ? item.symbol : undefined,
    }
  })
  if (!items.some(item => item.available))
    throw new Error('POS catalog has no available items.')

  return {
    items,
    revision: requiredString(catalog.revision, 'revision'),
    store: {
      name: requiredString(store.name, 'store name'),
      slogan: stringValue(store.slogan, 'store slogan'),
      symbol: requiredString(store.symbol, 'store symbol'),
    },
  }
}

/** Fetches and validates the only catalog the browser is allowed to present. */
export async function fetchPosCatalog(serverUrl: string | undefined): Promise<PosCatalog> {
  if (!serverUrl)
    throw new Error('未設定 VITE_ORDER_MENU_SERVER_URL，無法載入 POS 菜單。')

  try {
    const response = await fetch(new URL('/v1/catalog', serverUrl))
    if (!response.ok)
      throw new Error(`POS Bridge 回傳 HTTP ${response.status}。`)
    return parseCatalog(await response.json())
  }
  catch (error) {
    const message = errorMessageFrom(error) ?? '未知錯誤'
    throw new Error(`無法載入 POS 菜單：${message}`)
  }
}
