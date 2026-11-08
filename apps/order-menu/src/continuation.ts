import type { ContinuationAccess, ContinuationSnapshot } from '../../order-menu-server/src/domain/continuationContracts'

export type { ContinuationAccess, ContinuationSnapshot } from '../../order-menu-server/src/domain/continuationContracts'

/** Stores only the pending bearer token and expiry across native-camera browser tabs. */
export const pendingOrderKey = 'webnavior-pending-order'

/** Resolves a continuation only from this merchant's URL or its own unexpired table-scan capability. */
export function continuationToken(query: URLSearchParams, storage: Pick<Storage, 'getItem'>, key = pendingOrderKey): string {
  if (query.has('continuation'))
    return query.get('continuation') ?? ''
  if (!query.has('table'))
    return ''
  try {
    const pending: Partial<ContinuationAccess> | null = JSON.parse(storage.getItem(key) ?? 'null')
    return typeof pending?.token === 'string' && typeof pending.expiresAt === 'number' && pending.expiresAt > Date.now() ? pending.token : ''
  }
  catch {
    // Corrupt or unavailable storage never grants another merchant's order capability.
    return ''
  }
}

/** Uses the configured customer-facing menu origin; local links remain clickable on desktop. */
export function continuationUrl(access: ContinuationAccess, pageUrl: string) {
  const url = new URL(pageUrl)
  url.search = ''
  url.hash = ''
  url.searchParams.set('continuation', access.token)
  return url.toString()
}

async function requestContinuation(baseUrl: string, path: string, request?: RequestInit): Promise<ContinuationSnapshot> {
  const response = await fetch(new URL(path, `${baseUrl.replace(/\/$/, '')}/`), {
    cache: 'no-store',
    ...request,
  })
  const body = await response.json()
  if (!response.ok)
    throw new Error(body.error ?? '無法讀取訂單接續資料。')
  return body
}

/** Reads or confirms a scanned table against the bridge, never a browser-local fake order. */
export async function readContinuation(baseUrl: string, token: string, tableCode?: string): Promise<ContinuationSnapshot> {
  return await requestContinuation(baseUrl, `v1/continuations/${encodeURIComponent(token)}${tableCode ? '/table' : ''}`, tableCode ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tableCode }) } : undefined)
}

/** Confirms a test-only pickup change; never submits another order or payment. */
export async function changeToTakeout(baseUrl: string, token: string): Promise<ContinuationSnapshot> {
  return await requestContinuation(baseUrl, `v1/continuations/${encodeURIComponent(token)}/takeout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) })
}
