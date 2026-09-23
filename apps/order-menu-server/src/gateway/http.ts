import type { CatalogSnapshot, PaymentIntent, PosGateway, SubmissionReceipt } from '../domain/contracts'

function endpoint(baseUrl: string, path: string) {
  return new URL(path, `${baseUrl.replace(/\/$/, '')}/`).toString()
}

/** Calls an OpenAPI-like POS endpoint while keeping its payload behind the bridge port. */
export function createHttpPosGateway(options: { baseUrl: string, timeoutMs: number }): PosGateway {
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
    createPayment: async (amount, method) => (await request<{ payment: PaymentIntent }>('v1/payments', { body: JSON.stringify({ amount, method }), headers: { 'Content-Type': 'application/json' }, method: 'POST' })).payment,
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
