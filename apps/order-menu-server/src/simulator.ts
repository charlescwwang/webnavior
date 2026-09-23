import type { CatalogSnapshot, PaymentStatus, PosGateway, PosSubmission, SubmissionReceipt } from './domain/contracts'

import { createHash, randomUUID } from 'node:crypto'

import { Hono } from 'hono'
import { object, picklist, safeParse } from 'valibot'

import sourceMenu from '../../../周氏蝦捲菜單_v2.json'

export type SimulatorMode = 'accepted' | 'rejected' | 'uncertain'
export type SimulatorPaymentMode = PaymentStatus

const modeSchema = object({ mode: picklist(['accepted', 'rejected', 'uncertain']) })
const paymentModeSchema = object({ mode: picklist(['authorized', 'pending', 'rejected', 'uncertain']) })

const sourceRevision = `source-menu-v${sourceMenu.version}-${createHash('sha256')
  .update(JSON.stringify({ categories: sourceMenu.categories, items: sourceMenu.items }))
  .digest('hex')
  .slice(0, 12)}`

const presentationImages = {
  dessert: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=720&q=80',
  drink: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=720&q=80',
  fried: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=720&q=80',
  noodle: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=720&q=80',
  rice: 'https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=720&q=80',
  soup: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=720&q=80',
} as const

/**
 * The fixture remains authoritative whenever it includes an image. These are
 * development presentation defaults for its otherwise empty image fields, not
 * POS product media or a claim that the photo depicts the exact menu item.
 */
function imageUrlFor(item: typeof sourceMenu.items[number]) {
  if (item.image.trim())
    return item.image
  if (/紅茶|酸梅/.test(item.name))
    return presentationImages.drink
  if (/流沙包|杏仁/.test(item.name))
    return presentationImages.dessert
  if (/炸|蝦捲|海鮮派|排骨/.test(item.name))
    return presentationImages.fried
  if (/麵|米粉/.test(item.name))
    return presentationImages.noodle
  if (/便當|套餐|飯|粽|米糕/.test(item.name))
    return presentationImages.rice
  return presentationImages.soup
}

function recommendationTagsFor(name: string): CatalogSnapshot['items'][number]['recommendationTags'] {
  const tags: CatalogSnapshot['items'][number]['recommendationTags'] = []
  if (/炸|蝦捲/.test(name))
    tags.push('fried')
  if (/便當|飯|粽|米糕/.test(name))
    tags.push('rice')
  return tags
}

/**
 * Normalizes the restaurant-managed source fixture into the stable POS catalog
 * contract. The POS is authoritative for item availability and prices; this
 * boundary does not invent option groups or dietary claims absent from source.
 */
function catalogFromSource(): CatalogSnapshot {
  const categories = new Map(sourceMenu.categories.map(category => [category.id, category.name]))
  const items = sourceMenu.items
    .map(item => ({
      available: item.available,
      category: categories.get(item.categoryId) ?? '其他',
      description: item.description.trim() || item.name,
      id: item.id,
      imageUrl: imageUrlFor(item),
      name: item.name,
      optionGroups: [],
      price: item.price,
      recommendationTags: recommendationTagsFor(item.name),
      symbol: item.symbol.trim() || '🍽️',
    }))

  if (items.length === 0)
    throw new Error('The POS simulator catalog has no available items.')

  return {
    items,
    revision: sourceRevision,
    store: {
      name: sourceMenu.store.name,
      slogan: sourceMenu.store.slogan,
      symbol: sourceMenu.store.symbol,
    },
  }
}

const simulatorCatalog = catalogFromSource()

function receiptFor(mode: SimulatorMode): SubmissionReceipt {
  switch (mode) {
    case 'accepted':
      return {
        customerMessage: '測試 POS 已接受訂單，未送往正式 POS。',
        environment: 'test',
        posOrderId: `test-pos-${randomUUID()}`,
        retryable: false,
        status: 'accepted',
      }
    case 'rejected':
      return {
        customerMessage: '測試 POS 拒絕此訂單，請確認餐點後再試。',
        environment: 'test',
        retryable: true,
        status: 'rejected',
      }
    case 'uncertain':
      return {
        customerMessage: '測試 POS 的訂單狀態尚未確認，請勿再次送單。',
        environment: 'test',
        retryable: false,
        status: 'uncertain',
      }
  }
}

/** A loopback-only controllable upstream that emulates the future POS HTTP API. */
export function createPosSimulator(initialMode: SimulatorMode = 'accepted', initialPaymentMode: SimulatorPaymentMode = 'authorized') {
  let mode = initialMode
  let paymentMode = initialPaymentMode
  const receiptsByKey = new Map<string, SubmissionReceipt>()
  const payments = new Map<string, { amount: number, id: string, method: 'card' | 'mobile', status: SimulatorPaymentMode }>()
  const app = new Hono()

  app.get('/v1/catalog', c => c.json(simulatorCatalog))
  app.post('/v1/payments', async (c) => {
    const body = await c.req.json().catch(() => null) as { amount?: unknown, method?: unknown } | null
    if ((body?.method !== 'card' && body?.method !== 'mobile') || typeof body.amount !== 'number' || body.amount < 0)
      return c.json({ error: 'amount and method are required' }, 400)
    const payment: { amount: number, id: string, method: 'card' | 'mobile', status: SimulatorPaymentMode } = {
      amount: body.amount,
      id: `payment-${randomUUID()}`,
      method: body.method,
      status: paymentMode,
    }
    payments.set(payment.id, payment)
    return c.json({ payment }, 201)
  })
  app.get('/v1/payments/:paymentId', (c) => {
    const payment = payments.get(c.req.param('paymentId'))
    return payment ? c.json({ payment }) : c.json({ error: 'Unknown payment.' }, 404)
  })
  app.post('/v1/orders', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.idempotencyKey !== 'string')
      return c.json({ error: 'idempotencyKey is required' }, 400)

    const existing = receiptsByKey.get(body.idempotencyKey)
    const receipt = existing ?? receiptFor(mode)
    receiptsByKey.set(body.idempotencyKey, receipt)
    return c.json({ receipt })
  })
  app.post('/__simulator/mode', async (c) => {
    const result = safeParse(modeSchema, await c.req.json().catch(() => null))
    if (!result.success)
      return c.json({ error: 'mode must be accepted, rejected, or uncertain' }, 400)
    mode = result.output.mode
    return c.json({ mode })
  })
  app.post('/__simulator/payment-mode', async (c) => {
    const result = safeParse(paymentModeSchema, await c.req.json().catch(() => null))
    if (!result.success)
      return c.json({ error: 'invalid payment mode' }, 400)
    paymentMode = result.output.mode
    return c.json({ mode: paymentMode })
  })

  return { app, getMode: () => mode, getPaymentMode: () => paymentMode }
}

/** Uses the simulator in direct unit tests without opening a network port. */
export function createInMemorySimulatorGateway(
  initialMode: SimulatorMode = 'accepted',
  initialPaymentMode: SimulatorPaymentMode = 'authorized',
): PosGateway {
  const mode = initialMode
  const receiptsByKey = new Map<string, SubmissionReceipt>()
  const payments = new Map<string, { amount: number, id: string, method: 'card' | 'mobile', status: PaymentStatus }>()
  return {
    createPayment: async (amount, method) => {
      const payment = { amount, id: `payment-${randomUUID()}`, method, status: initialPaymentMode }
      payments.set(payment.id, payment)
      return payment
    },
    getPayment: async paymentId => payments.get(paymentId),
    getCatalog: async () => simulatorCatalog,
    submit: async (submission: PosSubmission) => {
      const existing = receiptsByKey.get(submission.idempotencyKey)
      if (existing)
        return existing
      const receipt = receiptFor(mode)
      receiptsByKey.set(submission.idempotencyKey, receipt)
      return receipt
    },
  }
}
