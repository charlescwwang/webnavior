import type { CatalogSnapshot, PaymentIntent, PosGateway, SubmissionReceipt } from '../domain/contracts'
import type { SeatingSnapshot, TableHold } from '../domain/seatingContracts'

function endpoint(baseUrl: string, path: string) {
  return new URL(path, `${baseUrl.replace(/\/$/, '')}/`).toString()
}

/** Calls an OpenAPI-like POS endpoint while keeping its payload behind the bridge port. */
export function createHttpPosGateway(options: { baseUrl: string, timeoutMs: number, tableOrdersSupported?: boolean }): PosGateway {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(endpoint(options.baseUrl, path), {
      ...init,
      signal: AbortSignal.timeout(options.timeoutMs),
    })
    if (!response.ok)
      throw new Error(`POS request failed with HTTP ${response.status}.`)
    return await response.json() as T
  }

  return {
    ...(options.tableOrdersSupported
      ? { submitTableOrder: async (submission: Parameters<NonNullable<PosGateway['submitTableOrder']>>[0]) => {
          const response = await request<{ receipt: SubmissionReceipt }>('v1/table-orders', { body: JSON.stringify(submission), headers: { 'Content-Type': 'application/json' }, method: 'POST' })
          return response.receipt
        } }
      : {}),
    getSeating: async () => (await request<{ seating: SeatingSnapshot }>('v1/seating')).seating,
    reserveTables: async body => (await request<{ hold: TableHold }>('v1/seating/holds', { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, method: 'POST' })).hold,
    getTableHold: async (id) => {
      const response = await fetch(endpoint(options.baseUrl, `v1/seating/holds/${encodeURIComponent(id)}`), { signal: AbortSignal.timeout(options.timeoutMs) })
      if (response.status === 404)
        return undefined
      if (!response.ok)
        throw new Error('POS could not confirm the current table hold.')
      return (await response.json() as { hold: TableHold }).hold
    },
    releaseTables: async (id) => { await request(`v1/seating/holds/${encodeURIComponent(id)}`, { method: 'DELETE' }) },
    createPayment: async (amount, method, tableHoldId) => (await request<{ payment: PaymentIntent }>('v1/payments', { body: JSON.stringify({ amount, method, tableHoldId }), headers: { 'Content-Type': 'application/json' }, method: 'POST' })).payment,
    getPayment: async (paymentId) => {
      try {
        return (await request<{ payment: PaymentIntent }>(`v1/payments/${paymentId}`)).payment
      }
      catch {
        return undefined
      }
    },
    getCatalog: async () => await request<CatalogSnapshot>('v1/catalog'),
    submit: async (submission) => {
      try {
        const response = await request<{ receipt: SubmissionReceipt }>('v1/orders', {
          body: JSON.stringify(submission),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        })
        return response.receipt
      }
      catch {
        return {
          customerMessage: 'POS 連線逾時或中斷，訂單狀態尚未確認，請勿再次送單。',
          environment: 'test',
          retryable: false,
          status: 'uncertain',
        }
      }
    },
  }
}
