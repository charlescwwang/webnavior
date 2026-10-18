import type { CatalogSnapshot, PaymentIntent, PaymentStatus, PosGateway, PosSubmission, SubmissionReceipt } from './domain/contracts'
import type { TableAssignment } from './domain/seatingContracts'

import { createHash, randomUUID } from 'node:crypto'

import { Hono } from 'hono'
import { array, boolean, integer, maxValue, minValue, number, object, picklist, pipe, safeParse, string } from 'valibot'

import sourceMenu from '../../../周氏蝦捲菜單_v2.json'

import { parseComposition } from './domain/composition'
import { createSeating } from './domain/seating'

export type SimulatorMode = 'accepted' | 'rejected' | 'uncertain'
export type SimulatorPaymentMode = PaymentStatus

const modeSchema = object({ mode: picklist(['accepted', 'rejected', 'uncertain']) })
const paymentModeSchema = object({ mode: picklist(['authorized', 'pending', 'rejected', 'uncertain']) })
const holdSchema = object({ expectedRevision: pipe(number(), integer(), minValue(0)), partySize: pipe(number(), integer(), minValue(1), maxValue(20)), tableIds: array(string()), splitApproved: boolean() })

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
    .map((item) => {
      // Empty JSON arrays infer never[]; the catalog contract still supports
      // declared option groups when the store restores them in its source.
      const optionGroups: CatalogSnapshot['items'][number]['optionGroups'] = item.optionGroups
      return {
        available: item.available,
        composition: parseComposition(item.composition),
        aliases: 'aliases' in item ? item.aliases : [],
        category: categories.get(item.categoryId) ?? '其他',
        description: item.description.trim() || item.name,
        id: item.id,
        imageUrl: imageUrlFor(item),
        name: item.name,
        optionGroups: optionGroups.map(group => ({ ...group, values: group.values.map(value => ({ ...value })) })),
        price: item.price,
        recommendationTags: recommendationTagsFor(item.name),
        symbol: item.symbol.trim() || '🍽️',
      }
    })

  if (items.length === 0)
    throw new Error('The POS simulator catalog has no available items.')

  return {
    items,
    revision: sourceRevision,
    store: {
      fulfillmentModes: [{ id: 'dine-in', label: '內用' }, { id: 'takeout', label: '自取' }],
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
        customerMessage: '訂單已接受。',
        environment: 'test',
        posOrderId: `test-pos-${randomUUID()}`,
        retryable: false,
        status: 'accepted',
      }
    case 'rejected':
      return {
        customerMessage: '訂單未接受，請確認餐點後再試。',
        environment: 'test',
        retryable: true,
        status: 'rejected',
      }
    case 'uncertain':
      return {
        customerMessage: '訂單狀態尚未確認，請勿再次送單。',
        environment: 'test',
        retryable: false,
        status: 'uncertain',
      }
  }
}

/** A loopback-only controllable upstream that emulates the future POS HTTP API. */
export function createPosSimulator(initialMode: SimulatorMode = 'accepted', initialPaymentMode: SimulatorPaymentMode = 'authorized', tableAssignment: TableAssignment = 'reservation') {
  let mode = initialMode
  let paymentMode = initialPaymentMode
  const gateway = createSimulatorGateway(() => mode, () => paymentMode, Date.now, tableAssignment)
  const app = new Hono()

  app.get('/v1/catalog', c => c.json(simulatorCatalog))
  app.get('/__simulator/seating', async (c) => {
    const state = await gateway.getSeating()
    return c.html(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>模擬門市桌位</title><h1>模擬門市桌位</h1><p>僅供本機測試。離席只釋放已占用桌位；付款中與暫留桌位不可由此釋放。</p>${state.tables.map(table => `<section><h2>${table.label} · ${table.capacity} 人 · ${table.status}</h2>${table.status === 'occupied' ? `<form method="post" action="/__simulator/seating/depart"><input type="hidden" name="tableId" value="${table.id}"><input type="hidden" name="expectedRevision" value="${state.revision}"><button type="submit">模擬離席，釋放此桌</button></form>` : ''}</section>`).join('')}<a href="/__simulator/seating">重新整理</a></html>`)
  })
  app.post('/__simulator/seating/depart', async (c) => {
    const form = c.req.header('content-type')?.includes('application/x-www-form-urlencoded')
    const body = form ? await c.req.parseBody() : await c.req.json().catch(() => null)
    if (!body || typeof body.tableId !== 'string' || !Number.isInteger(Number(body.expectedRevision)))
      return c.json({ error: 'tableId and expectedRevision are required.' }, 400)
    try {
      gateway.depart(body.tableId, Number(body.expectedRevision))
      return form ? c.redirect('/__simulator/seating', 303) : c.json({ seating: await gateway.getSeating() })
    }
    catch { return c.json({ error: 'Table is not occupied or the snapshot is stale.' }, 409) }
  })
  app.get('/v1/seating', async c => c.json({ seating: await gateway.getSeating() }))
  app.post('/v1/seating/holds', async (c) => {
    const result = safeParse(holdSchema, await c.req.json().catch(() => null))
    if (!result.success)
      return c.json({ error: 'Invalid seating request.' }, 400)
    try {
      return c.json({ hold: await gateway.reserveTables(result.output) }, 201)
    }
    catch { return c.json({ error: 'Tables are unavailable or split consent is missing.' }, 409) }
  })
  app.get('/v1/seating/holds/:id', async (c) => {
    try {
      const hold = await gateway.getTableHold(c.req.param('id'))
      return hold ? c.json({ hold }) : c.json({ error: 'Unknown or expired hold.' }, 404)
    }
    catch { return c.json({ error: 'Unknown or expired hold.' }, 404) }
  })
  app.delete('/v1/seating/holds/:id', async (c) => {
    try {
      await gateway.releaseTables(c.req.param('id'))
      return c.json({ released: true })
    }
    catch { return c.json({ error: 'Payment prevents release.' }, 409) }
  })
  app.post('/v1/payments', async (c) => {
    const body = await c.req.json().catch(() => null) as { amount?: unknown, method?: unknown, tableHoldId?: unknown } | null
    if ((!body || (body.method !== 'card' && body.method !== 'mobile' && body.method !== 'linepay' && body.method !== 'jkopay')) || typeof body.amount !== 'number' || body.amount < 0)
      return c.json({ error: 'amount and method are required' }, 400)
    if (body.tableHoldId !== undefined && typeof body.tableHoldId !== 'string')
      return c.json({ error: 'Invalid hold.' }, 400)
    try {
      return c.json({ payment: await gateway.createPayment(body.amount, body.method, body.tableHoldId) }, 201)
    }
    catch { return c.json({ error: 'Expired hold or payment already started.' }, 409) }
  })
  app.get('/v1/payments/:paymentId', async (c) => {
    const payment = await gateway.getPayment(c.req.param('paymentId'))
    return payment ? c.json({ payment }) : c.json({ error: 'Unknown payment.' }, 404)
  })
  app.post('/v1/orders', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.idempotencyKey !== 'string')
      return c.json({ error: 'idempotencyKey is required' }, 400)

    const receipt = await gateway.submit(body)
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
  now: () => number = () => Date.now(),
  tableAssignment: TableAssignment = 'reservation',
): PosGateway {
  return createSimulatorGateway(() => initialMode, () => initialPaymentMode, now, tableAssignment)
}

// Both HTTP and in-process simulation use the same inventory/payment state
// machine so tests cannot pass against a seating model absent in the live API.
function createSimulatorGateway(mode: () => SimulatorMode, paymentMode: () => SimulatorPaymentMode, now: () => number = () => Date.now(), tableAssignment: TableAssignment = 'reservation'): PosGateway & { depart: (tableId: string, expectedRevision: number) => void } {
  const receiptsByKey = new Map<string, SubmissionReceipt>()
  const payments = new Map<string, PaymentIntent>()
  const seating = createSeating(now)
  return {
    depart: seating.depart,
    getSeating: async () => seating.snapshot(),
    reserveTables: async request => seating.reserve(request),
    getTableHold: async (id: string) => seating.find(id),
    releaseTables: async (id: string) => seating.release(id),
    createPayment: async (amount: number, method: PaymentIntent['method'], tableHoldId?: string) => {
      if (tableHoldId)
        seating.protect(tableHoldId)
      const payment: PaymentIntent = { amount, id: `payment-${randomUUID()}`, method, status: paymentMode(), tableHoldId }
      payments.set(payment.id, payment)
      if (tableHoldId && payment.status === 'rejected')
        seating.paymentRejected(tableHoldId)
      return payment
    },
    getPayment: async (paymentId: string) => payments.get(paymentId),
    getCatalog: async () => simulatorCatalog,
    submit: async (submission: PosSubmission) => {
      const existing = receiptsByKey.get(submission.idempotencyKey)
      if (existing)
        return existing
      const holdId = submission.cart?.tableHoldId
      if (submission.cart?.fulfillmentMode === 'takeout' && (holdId || payments.get(submission.cart.paymentId)?.tableHoldId))
        return { customerMessage: '自取訂單不可占用內用桌位。', environment: 'test', retryable: false, status: 'rejected' }
      if (submission.cart?.fulfillmentMode === 'dine-in' && tableAssignment === 'reservation') {
        const payment = payments.get(submission.cart.paymentId)
        if (!holdId || payment?.tableHoldId !== holdId || payment.status !== 'authorized' || seating.get(holdId).status !== 'locked')
          return { customerMessage: '內用桌位與付款不符，請洽門市人員。', environment: 'test', retryable: false, status: 'rejected' }
      }
      const receipt = receiptFor(mode())
      if (holdId && receipt.status === 'accepted')
        seating.occupy(holdId)
      receiptsByKey.set(submission.idempotencyKey, receipt)
      return receipt
    },
  }
}
