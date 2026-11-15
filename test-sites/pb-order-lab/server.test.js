import { expect, it } from 'vitest'

import { basePath, revision, tables } from './catalog.js'

// Opt-in integration tests exercise only the exact local fixture, never a PB host.
const origin = process.env.PB_LAB_URL
if (origin && origin !== 'http://127.0.0.1:5188')
  throw new Error('PB_LAB_URL must point to the reviewed loopback simulator.')
const test = it.skipIf(!origin)
const fresh = () => ({ schemaVersion: 1, tables, table: 'A1 桌', cart: [], orders: [], invoice: { type: 'none', code: '', phone: '', email: '' }, checkoutKey: crypto.randomUUID() })

test('isolates browser cookies and rejects stale tab writes', async () => {
  const first = await fetch(`${origin}/__lab/state`)
  const second = await fetch(`${origin}/__lab/state`)
  const cookie = first.headers.get('set-cookie').split(';')[0]
  const otherCookie = second.headers.get('set-cookie').split(';')[0]
  expect(cookie).not.toBe(otherCookie)
  const input = { revision: 0, state: fresh() }
  const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }
  const saved = await fetch(`${origin}/__lab/state`, { method: 'PUT', headers, body: JSON.stringify(input) })
  expect(saved.status).toBe(200)
  const stale = await fetch(`${origin}/__lab/state`, { method: 'PUT', headers, body: JSON.stringify(input) })
  expect(stale.status).toBe(409)
  const untouched = await fetch(`${origin}/__lab/state`, { headers: { Cookie: otherCookie } }).then(response => response.json())
  expect(untouched.state).toBeNull()
})

test('provides Inertia reads and rejects incompatible asset versions', async () => {
  const initial = await fetch(`${origin}/__lab/state`)
  const cookie = initial.headers.get('set-cookie').split(';')[0]
  const saved = await fetch(`${origin}/__lab/state`, { method: 'PUT', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0, state: fresh() }) })
  expect(saved.status).toBe(200)
  const headers = { Cookie: cookie, 'X-Inertia': 'true', 'X-Inertia-Version': revision }
  const response = await fetch(`${origin}${basePath}/orders/create`, { headers })
  expect(response.headers.get('x-inertia')).toBe('true')
  const page = await response.json()
  expect(page.component).toBe('Order/Create')
  expect(page.props.subtotal).toBe(0)
  expect(page.props.diningTable).toBe('A1 桌')
  const changed = await fetch(`${origin}${basePath}/orders/create`, { headers: { ...headers, 'X-Inertia-Version': 'stale-version' } })
  expect(changed.status).toBe(409)
})

test('rejects foreign-origin session writes and merchant write endpoints', async () => {
  const initial = await fetch(`${origin}/__lab/state`)
  const cookie = initial.headers.get('set-cookie').split(';')[0]
  const foreign = await fetch(`${origin}/__lab/state`, { method: 'PUT', headers: { Cookie: cookie, Origin: 'https://unrelated.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0, state: fresh() }) })
  expect(foreign.status).toBe(403)
  const vendor = await fetch(`${origin}${basePath}/orders/create`, { method: 'POST', headers: { Cookie: cookie, 'X-Inertia': 'true' } })
  expect(vendor.status).toBe(405)
})
