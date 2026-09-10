import { createBadGatewayError, createGatewayTimeoutError, createServiceUnavailableError } from '../../../../../utils/error'

/** The transient credentials and endpoint used to discover an upstream catalog. */
export interface ModelDiscoveryInput {
  baseURL: string
  plaintextKey?: string
}

/** Minimal provider-neutral shape returned to the management UI. */
export interface DiscoveredModel {
  id: string
}

/**
 * Reads the OpenAI-compatible `/models` catalog without persisting credentials.
 *
 * The Server makes this request so a browser never needs cross-origin access to
 * an upstream provider. `plaintextKey` is used only for this request and is not
 * logged, returned, or written to configuration.
 */
export async function discoverModels(
  input: ModelDiscoveryInput,
  fetchImpl: typeof fetch,
): Promise<DiscoveredModel[]> {
  const endpoint = `${input.baseURL.replace(/\/+$/u, '')}/models`
  let response: Response

  try {
    response = await fetchImpl(endpoint, {
      headers: input.plaintextKey
        ? { Authorization: `Bearer ${input.plaintextKey}` }
        : undefined,
      signal: AbortSignal.timeout(10_000),
    })
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError')
      throw createGatewayTimeoutError('模型服務連線逾時，請確認服務位址與網路。')

    throw createServiceUnavailableError('無法連線至模型服務，請確認服務位址、網路與 API Key。', 'MODEL_DISCOVERY_UNAVAILABLE')
  }

  if (!response.ok) {
    throw createBadGatewayError('模型服務拒絕讀取模型清單，請確認 API Key 與服務位址。', {
      upstreamStatus: response.status,
    })
  }

  const payload: unknown = await response.json().catch(() => null)
  const entries = payload && typeof payload === 'object'
    ? ('data' in payload ? (payload as { data?: unknown }).data : ('models' in payload ? (payload as { models?: unknown }).models : null))
    : null

  if (!Array.isArray(entries))
    throw createBadGatewayError('模型服務回傳的模型清單格式無法辨識。')

  return entries
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || !('id' in entry))
        return []
      const id = (entry as { id?: unknown }).id
      return typeof id === 'string' && id.trim() ? [{ id: id.trim() }] : []
    })
    .sort((left, right) => left.id.localeCompare(right.id))
}
